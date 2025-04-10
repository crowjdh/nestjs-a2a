import { Inject, Injectable, Logger, Scope, Type } from '@nestjs/common';
import { ContextIdFactory, ModuleRef, REQUEST } from '@nestjs/core';
import { Response } from 'express';
import { Request } from 'express';
import { A2A_OPTIONS_TOKEN } from '../constant';
import { A2AException } from '../interfaces/a2a.exception';
import { AgentToAgentModuleOptions } from '../interfaces/a2a.options';
import {
  InMemoryTaskStore,
  TaskAndHistory,
  TaskStore,
} from '../interfaces/a2a.store';
import {
  Artifact,
  CancelTaskRequest,
  GetTaskPushNotificationRequest,
  GetTaskRequest,
  JSONRPCResponse,
  Message,
  MessageRole,
  SendTaskRequest,
  SendTaskStreamingRequest,
  Task,
  TaskContext,
  TaskHandler,
  TaskResubscriptionRequest,
  TaskSendParams,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  TaskYieldUpdate,
} from '../interfaces/a2a.types';
import { A2ARegistry } from './a2a.registry';
/**
 * Implements the A2A executor for handling A2A protocol requests in NestJS.
 */
@Injectable({ scope: Scope.REQUEST })
export class A2AExecutor {
  private readonly logger = new Logger(A2AExecutor.name);
  private readonly taskStore: TaskStore;
  private readonly activeCancellations: Set<string> = new Set();

  constructor(
    @Inject(A2A_OPTIONS_TOKEN)
    private readonly options: AgentToAgentModuleOptions,
    @Inject(REQUEST)
    private readonly request: Request,
    private readonly registry: A2ARegistry,
    public readonly moduleRef: ModuleRef,
  ) {
    // Initialize the task store from options or use in-memory store as fallback
    this.taskStore = this.options.taskStore ?? new InMemoryTaskStore();
  }

  /**
   * Handles a task send request (non-streaming).
   */
  public async handleTaskSend(body: SendTaskRequest): Promise<JSONRPCResponse> {
    try {
      this.validateTaskSendParams(body.params);
      const { id: taskId, message, sessionId, metadata } = body.params;

      // Load or create task AND history
      let currentData = await this.loadOrCreateTaskAndHistory(
        taskId,
        message,
        sessionId,
        metadata,
      );

      // Find the appropriate handler for this task
      const handler = await this.findHandlerForTask(currentData.task, message);
      if (!handler) {
        throw A2AException.unsupportedOperation(
          `No handler found for task ${taskId}`,
        );
      }

      // Create context and run handler
      const context = this.createTaskContext(
        currentData.task,
        message,
        currentData.history,
      );
      const generator = handler(context);

      // Process generator yields
      try {
        for await (const yieldValue of generator) {
          // Apply update immutably
          currentData = this.applyUpdateToTaskAndHistory(
            currentData,
            yieldValue,
          );
          // Save the updated state
          await this.taskStore.save(currentData);
          // Update context snapshot for next iteration
          context.task = currentData.task;
        }
      } catch (handlerError) {
        // If handler throws, apply 'failed' status, save, and rethrow
        const failureStatusUpdate: Omit<TaskStatus, 'timestamp'> = {
          state: TaskState.FAILED,
          message: {
            role: MessageRole.AGENT,
            parts: [
              {
                text: `Handler failed: ${
                  handlerError instanceof Error
                    ? handlerError.message
                    : String(handlerError)
                }`,
              },
            ],
          },
        };
        currentData = this.applyUpdateToTaskAndHistory(
          currentData,
          failureStatusUpdate,
        );
        try {
          await this.taskStore.save(currentData);
        } catch (saveError) {
          this.logger.debug(
            `Failed to save task ${taskId} after handler error:`,
            saveError,
          );
          throw A2AException.internalError((handlerError as Error).message, {
            stack: (handlerError as Error).stack,
          });
        }
        throw A2AException.internalError((handlerError as Error).message, {
          stack: (handlerError as Error).stack,
        });
      }

      // The loop finished, return the final task state
      return JSONRPCResponse.success(currentData.task);
    } catch (error) {
      return this.handleError(error as Error, body.id);
    }
  }

  /**
   * Handles a task send request with streaming response.
   */
  public async handleTaskSendSubscribe(
    body: SendTaskStreamingRequest,
    response: Response,
  ): Promise<void> {
    try {
      this.validateTaskSendParams(body.params);
      const { id: taskId, message, sessionId, metadata } = body.params;

      // Load or create task AND history
      let currentData = await this.loadOrCreateTaskAndHistory(
        taskId,
        message,
        sessionId,
        metadata,
      );

      // Find the appropriate handler for this task
      const handler = await this.findHandlerForTask(currentData.task, message);
      if (!handler) {
        throw A2AException.unsupportedOperation(
          `No handler found for task ${taskId}`,
        );
      }

      // Create context and run handler
      const context = this.createTaskContext(
        currentData.task,
        message,
        currentData.history,
      );
      const generator = handler(context);

      // --- Setup SSE ---
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');

      // Function to send SSE data
      const sendEvent = (eventData: JSONRPCResponse) => {
        response.write(`data: ${JSON.stringify(eventData)}\n\n`);
      };

      let lastEventWasFinal = false; // Track if the last sent event was marked final

      try {
        // Process generator yields
        for await (const yieldValue of generator) {
          // Apply update immutably
          currentData = this.applyUpdateToTaskAndHistory(
            currentData,
            yieldValue,
          );
          // Save the updated state
          await this.taskStore.save(currentData);
          // Update context snapshot
          context.task = currentData.task;

          let event: TaskStatusUpdateEvent;
          let isFinal = false;

          // Determine event type and check for final state based on the *updated* task
          if (this.isTaskStatusUpdate(yieldValue)) {
            const terminalStates: TaskState[] = [
              TaskState.COMPLETED,
              TaskState.FAILED,
              TaskState.CANCELED,
              TaskState.INPUT_REQUIRED, // Treat input-required as potentially final for streaming?
            ];
            isFinal = terminalStates.includes(
              currentData.task.status.state as TaskState,
            );
            event = this.createTaskStatusEvent(
              taskId,
              currentData.task.status,
              isFinal,
            );
            if (isFinal) {
              this.logger.debug(
                `[SSE ${taskId}] Yielded terminal state ${currentData.task.status.state}, marking event as final.`,
              );
            }
          } else {
            // It's an artifact update
            // Find the updated artifact in the new task object
            // Commented out to avoid unused variable warning
            // const updatedArtifact =
            //   currentData.task.artifacts?.find(
            //     (a) =>
            //       (a.index !== undefined && a.index === (yieldValue as Artifact).index) ||
            //       (a.name && a.name === (yieldValue as Artifact).name),
            //   ) ?? (yieldValue as Artifact); // Fallback

            // For now, we'll just send status updates, not artifact updates
            // This could be enhanced to support artifact streaming in the future
            event = this.createTaskStatusEvent(
              taskId,
              currentData.task.status,
              false,
            );
          }

          sendEvent(JSONRPCResponse.success(event));
          lastEventWasFinal = isFinal;

          // If the status update resulted in a final state, stop processing
          if (isFinal) break;
        }

        // Loop finished. Check if a final event was already sent.
        if (!lastEventWasFinal) {
          this.logger.debug(
            `[SSE ${taskId}] Handler finished without yielding terminal state. Sending final state: ${currentData.task.status.state}`,
          );
          // Ensure the task is actually in a recognized final state before sending.
          const finalStates: TaskState[] = [
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELED,
            TaskState.INPUT_REQUIRED, // Consider input-required final for SSE end?
          ];
          if (
            !finalStates.includes(currentData.task.status.state as TaskState)
          ) {
            this.logger.warn(
              `[SSE ${taskId}] Task ended non-terminally (${currentData.task.status.state}). Forcing 'completed'.`,
            );
            // Apply 'completed' state update
            currentData = this.applyUpdateToTaskAndHistory(currentData, {
              state: TaskState.COMPLETED,
            });
            // Save the forced final state
            await this.taskStore.save(currentData);
          }
          // Send the final status event
          const finalEvent = this.createTaskStatusEvent(
            taskId,
            currentData.task.status,
            true, // Mark as final
          );
          sendEvent(JSONRPCResponse.success(finalEvent));
        }
      } catch (handlerError) {
        // Handler threw an error
        this.logger.debug(
          `[SSE ${taskId}] Handler error during streaming:`,
          handlerError,
        );
        // Apply 'failed' status update
        const failureUpdate: Omit<TaskStatus, 'timestamp'> = {
          state: TaskState.FAILED,
          message: {
            role: MessageRole.AGENT,
            parts: [
              {
                text: `Handler failed: ${
                  handlerError instanceof Error
                    ? handlerError.message
                    : String(handlerError)
                }`,
              },
            ],
          },
        };
        currentData = this.applyUpdateToTaskAndHistory(
          currentData,
          failureUpdate,
        );

        try {
          // Save the failed state
          await this.taskStore.save(currentData);
        } catch (saveError) {
          this.logger.debug(
            `[SSE ${taskId}] Failed to save task after handler error:`,
            saveError,
          );
        }

        // Send final error status event via SSE
        const errorEvent = this.createTaskStatusEvent(
          taskId,
          currentData.task.status, // Use the updated status
          true, // Mark as final
        );
        sendEvent(JSONRPCResponse.success(errorEvent));
      } finally {
        // End the SSE stream if it hasn't already been closed by sending a final event
        if (!response.writableEnded) {
          response.end();
        }
      }
    } catch (error) {
      // Handle initial setup errors (before streaming starts)
      const errorResponse = this.handleError(error as Error, body.id);
      response.status(200).json(errorResponse);
    }
  }

  /**
   * Handles a task get request.
   */
  public async handleTaskGet(body: GetTaskRequest): Promise<JSONRPCResponse> {
    try {
      const { id: taskId } = body.params;
      if (!taskId) throw A2AException.invalidParams('Missing task ID.');

      // Load both task and history
      const data = await this.taskStore.load(taskId);
      if (!data) {
        throw A2AException.taskNotFound(taskId);
      }
      // Return only the task object as per spec
      return JSONRPCResponse.success(data.task);
    } catch (error) {
      return this.handleError(error as Error, body.id);
    }
  }

  /**
   * Handles a task cancel request.
   */
  public async handleTaskCancel(
    body: CancelTaskRequest,
  ): Promise<JSONRPCResponse> {
    try {
      const { id: taskId } = body.params;
      if (!taskId) throw A2AException.invalidParams('Missing task ID.');

      // Load task and history
      let data = await this.taskStore.load(taskId);
      if (!data) {
        throw A2AException.taskNotFound(taskId);
      }

      // Check if cancelable (not already in a final state)
      const finalStates: TaskState[] = [
        TaskState.COMPLETED,
        TaskState.FAILED,
        TaskState.CANCELED,
      ];
      if (finalStates.includes(data.task.status.state as TaskState)) {
        this.logger.debug(
          `Task ${taskId} already in final state ${data.task.status.state}, cannot cancel.`,
        );
        return JSONRPCResponse.success(data.task); // Return current state
      }

      // Signal cancellation
      this.activeCancellations.add(taskId);

      // Apply 'canceled' state update
      const cancelUpdate: Omit<TaskStatus, 'timestamp'> = {
        state: TaskState.CANCELED,
        message: {
          role: MessageRole.AGENT,
          parts: [{ text: 'Task cancelled by request.' }],
        },
      };
      data = this.applyUpdateToTaskAndHistory(data, cancelUpdate);

      // Save the updated state
      await this.taskStore.save(data);

      // Remove from active cancellations *after* saving
      this.activeCancellations.delete(taskId);

      // Return the updated task object
      return JSONRPCResponse.success(data.task);
    } catch (error) {
      return this.handleError(error as Error, body.id);
    }
  }

  /**
   * Handles a task resubscribe request.
   * Not fully implemented yet - returns unsupported operation error.
   */
  public async handleTaskResubscribe(
    _body: TaskResubscriptionRequest,
  ): Promise<JSONRPCResponse> {
    return JSONRPCResponse.error(
      A2AException.unsupportedOperation(
        'Task resubscription not supported',
      ).toJSONRPCError(),
    );
  }

  /**
   * Handles a task get push notification request.
   * Not fully implemented yet - returns unsupported operation error.
   */
  public async handleTaskGetPushNotification(
    _body: GetTaskPushNotificationRequest,
  ): Promise<JSONRPCResponse> {
    return JSONRPCResponse.error(
      A2AException.pushNotificationNotSupported().toJSONRPCError(),
    );
  }

  // --- Helper Methods ---

  /**
   * Loads an existing task or creates a new one with the given message.
   */
  private async loadOrCreateTaskAndHistory(
    taskId: string,
    initialMessage: Message,
    sessionId?: string | null, // Allow null
    metadata?: Record<string, unknown> | null, // Allow null
  ): Promise<TaskAndHistory> {
    let data = await this.taskStore.load(taskId);
    let needsSave = false;

    if (!data) {
      // Create new task and history
      const initialTask: Task = {
        id: taskId,
        sessionId: sessionId ?? undefined, // Store undefined if null
        status: {
          state: TaskState.SUBMITTED, // Start as submitted
          timestamp: this.getCurrentTimestamp(),
          message: null, // Initial user message goes only to history for now
        },
        artifacts: [],
        metadata: metadata ?? undefined, // Store undefined if null
      };
      const initialHistory: Message[] = [initialMessage]; // History starts with user message
      data = { task: initialTask, history: initialHistory };
      needsSave = true; // Mark for saving
      this.logger.debug(`[Task ${taskId}] Created new task and history.`);
    } else {
      this.logger.debug(`[Task ${taskId}] Loaded existing task and history.`);
      // Add current user message to history
      // Make a copy before potentially modifying
      data = { task: data.task, history: [...data.history, initialMessage] };
      needsSave = true; // History updated, mark for saving

      // Handle state transitions for existing tasks
      const finalStates: TaskState[] = [
        TaskState.COMPLETED,
        TaskState.FAILED,
        TaskState.CANCELED,
      ];
      if (finalStates.includes(data.task.status.state as TaskState)) {
        this.logger.warn(
          `[Task ${taskId}] Received message for task already in final state ${data.task.status.state}. Handling as new submission (keeping history).`,
        );
        // Option 1: Reset state to 'submitted' (keeps history, effectively restarts)
        const resetUpdate: Omit<TaskStatus, 'timestamp'> = {
          state: TaskState.SUBMITTED,
          message: null, // Clear old agent message
        };
        data = this.applyUpdateToTaskAndHistory(data, resetUpdate);
        // needsSave is already true
      } else if (data.task.status.state === TaskState.INPUT_REQUIRED) {
        this.logger.debug(
          `[Task ${taskId}] Received message while 'input-required', changing state to 'working'.`,
        );
        // If it was waiting for input, update state to 'working'
        const workingUpdate: Omit<TaskStatus, 'timestamp'> = {
          state: TaskState.WORKING,
        };
        data = this.applyUpdateToTaskAndHistory(data, workingUpdate);
        // needsSave is already true
      } else if (data.task.status.state === TaskState.WORKING) {
        // If already working, maybe warn but allow? Or force back to submitted?
        this.logger.warn(
          `[Task ${taskId}] Received message while already 'working'. Proceeding.`,
        );
        // No state change needed, but history was updated, so needsSave is true.
      }
      // If 'submitted', receiving another message might be odd, but proceed.
    }

    // Save if created or modified before returning
    if (needsSave) {
      await this.taskStore.save(data);
    }

    // Return copies to prevent mutation by caller before handler runs
    return { task: { ...data.task }, history: [...data.history] };
  }

  /**
   * Creates a task context object for the handler.
   */
  private createTaskContext(
    task: Task,
    userMessage: Message,
    history: Message[], // Add history parameter
  ): TaskContext {
    return {
      task: { ...task }, // Pass a copy
      userMessage: userMessage,
      history: [...history], // Pass a copy of the history
      isCancelled: () => this.activeCancellations.has(task.id),
    };
  }

  /**
   * Finds an appropriate handler for the given task and message.
   * Currently just returns a default handler, but could be enhanced to select
   * based on task type, message content, etc.
   */
  private async findHandlerForTask(
    task: Task,
    _message: Message,
  ): Promise<TaskHandler> {
    try {
      const preferredSkill: string =
        (task.metadata?.preferredSkill as string | undefined) ??
        (await this.options.selectSkill?.(task)) ??
        '';
      /**
       * Get the skill from the registry.
       * If no preferred skill is set, use the fallback skill.
       * If no fallback skill is set, use the first skill in the registry.
       */
      const skill =
        this.registry.getSkill(preferredSkill) ??
        this.registry.getFallbackSkill();
      if (!skill) {
        this.logger.warn(
          `Skill ${preferredSkill} not found in the A2A registry`,
        );
        throw A2AException.unsupportedOperation(
          `Skill ${preferredSkill} not found in the A2A registry`,
        );
      }
      const contextId = ContextIdFactory.getByRequest(this.request);
      this.moduleRef.registerRequestByContextId(this.request, contextId);

      const instance = await this.moduleRef.resolve(
        skill.providerClass as Type,
        contextId,
        { strict: false },
      );
      return instance[skill.methodName] as TaskHandler;
    } catch (error) {
      this.logger.debug('Error finding handler for task:', error);
      throw A2AException.unsupportedOperation(
        `Error finding handler for task: ${error}`,
      );
    }
  }

  /**
   * Validates the parameters for a task send request.
   */
  private validateTaskSendParams(
    params: TaskSendParams,
  ): asserts params is TaskSendParams {
    if (!params || typeof params !== 'object') {
      throw A2AException.invalidParams('Missing or invalid params object.');
    }
    if (typeof params.id !== 'string' || params.id === '') {
      throw A2AException.invalidParams(
        'Invalid or missing task ID (params.id).',
      );
    }
    if (
      !params.message ||
      typeof params.message !== 'object' ||
      !Array.isArray(params.message.parts)
    ) {
      throw A2AException.invalidParams(
        'Invalid or missing message object (params.message).',
      );
    }
    // Add more checks for message structure, sessionID, metadata, etc. if needed
  }

  /**
   * Helper to apply updates (status or artifact) immutably to a task and history.
   */
  private applyUpdateToTaskAndHistory(
    current: TaskAndHistory,
    update: TaskYieldUpdate,
  ): TaskAndHistory {
    const newTask = { ...current.task }; // Shallow copy task
    const newHistory = [...current.history]; // Shallow copy history

    if (this.isTaskStatusUpdate(update)) {
      // Merge status update
      newTask.status = {
        ...newTask.status, // Keep existing properties if not overwritten
        ...update, // Apply updates
        timestamp: this.getCurrentTimestamp(), // Always update timestamp
      };
      // If the update includes an agent message, add it to history
      if (update.message?.role === MessageRole.AGENT) {
        newHistory.push(update.message as Message);
      }
    } else {
      // Handle artifact update
      const artifact = update as Artifact;
      if (!newTask.artifacts) {
        newTask.artifacts = [];
      } else {
        // Ensure we're working with a copy of the artifacts array
        newTask.artifacts = [...newTask.artifacts];
      }

      const existingIndex = artifact.index ?? -1; // Use index if provided
      let replaced = false;

      if (existingIndex >= 0 && existingIndex < newTask.artifacts.length) {
        const existingArtifact = newTask.artifacts[existingIndex];
        if (artifact.append) {
          // Create a deep copy for modification to avoid mutating original
          const appendedArtifact = JSON.parse(JSON.stringify(existingArtifact));
          appendedArtifact.parts.push(...artifact.parts);
          if (artifact.metadata) {
            appendedArtifact.metadata = {
              ...(appendedArtifact.metadata || {}),
              ...artifact.metadata,
            };
          }
          if (artifact.lastChunk !== undefined)
            appendedArtifact.lastChunk = artifact.lastChunk;
          if (artifact.description)
            appendedArtifact.description = artifact.description;
          newTask.artifacts[existingIndex] = appendedArtifact; // Replace with appended version
          replaced = true;
        } else {
          // Overwrite artifact at index (with a copy of the update)
          newTask.artifacts[existingIndex] = { ...artifact };
          replaced = true;
        }
      } else if (artifact.name) {
        const namedIndex = newTask.artifacts.findIndex(
          (a) => a.name === artifact.name,
        );
        if (namedIndex >= 0) {
          newTask.artifacts[namedIndex] = { ...artifact }; // Replace by name (with copy)
          replaced = true;
        }
      }

      if (!replaced) {
        newTask.artifacts.push({ ...artifact }); // Add as a new artifact (copy)
        // Sort if indices are present
        if (newTask.artifacts.some((a) => a.index !== undefined)) {
          newTask.artifacts.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        }
      }
    }

    return { task: newTask, history: newHistory };
  }

  /**
   * Type guard to check if an update is a task status update.
   */
  private isTaskStatusUpdate(
    update: TaskYieldUpdate,
  ): update is Omit<TaskStatus, 'timestamp'> {
    return 'state' in update;
  }

  /**
   * Creates a TaskStatusUpdateEvent object.
   */
  private createTaskStatusEvent(
    taskId: string,
    status: TaskStatus,
    final: boolean,
  ): TaskStatusUpdateEvent {
    return {
      id: taskId,
      status: status, // Assumes status already has timestamp from applyUpdate
      final: final,
    };
  }

  /**
   * Gets the current timestamp in ISO format.
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Handles errors by converting them to appropriate JSON-RPC responses.
   */
  private handleError(
    error: Error,
    _reqId: number | string | null | undefined,
  ): JSONRPCResponse {
    if (!(error instanceof A2AException)) {
      error = A2AException.internalError(
        (error as Error).message ?? 'Unknown error',
      );
    }
    return JSONRPCResponse.error((error as A2AException).toJSONRPCError());
  }
}
