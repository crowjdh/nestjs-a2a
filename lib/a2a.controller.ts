import {
  Get,
  Post,
  Inject,
  UseGuards,
  CanActivate,
  Body,
  Logger,
  Res,
  Req,
} from '@nestjs/common';

import { Controller } from '@nestjs/common';
import { Request, Response } from 'express';
import { A2A_OPTIONS_TOKEN, DEFAULT_A2A_BASE_PATH } from './constant';
import { A2AException } from './interfaces/a2a.exception';
import { AgentToAgentModuleOptions } from './interfaces/a2a.options';
import {
  AgentCard,
  CancelTaskRequest,
  GetTaskPushNotificationRequest,
  GetTaskRequest,
  JSONRPCRequest,
  JSONRPCResponse,
  SendTaskRequest,
  SendTaskStreamingRequest,
  TaskMethod,
  TaskResubscriptionRequest,
} from './interfaces/a2a.types';
import { A2AExecutor } from './services/a2a.executor';
import { A2ARegistry } from './services/a2a.registry';
function isValidJsonRpcRequest(body: JSONRPCRequest): body is JSONRPCRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    body.jsonrpc === '2.0' &&
    typeof body.method === 'string' &&
    (body.id === null ||
      typeof body.id === 'string' ||
      typeof body.id === 'number') &&
    (body.params === undefined ||
      typeof body.params === 'object' ||
      Array.isArray(body.params))
  );
}

export function createA2AController(basePath?: string, guards?: CanActivate[]) {
  @Controller()
  class A2AController {
    public readonly logger = new Logger(A2AController.name);
    constructor(
      @Inject(A2A_OPTIONS_TOKEN)
      public readonly a2aOptions: AgentToAgentModuleOptions,
      public readonly a2aRegistry: A2ARegistry,
      public readonly a2aExecutor: A2AExecutor,
    ) {}

    @Get('/.well-known/agent.json')
    public getAgentCard(@Req() request: Request): AgentCard {
      return {
        ...this.a2aOptions.card,
        url: this.a2aOptions.card.url ?? this.getServerUrl(request),
        skills: this.a2aRegistry
          .getAvailableSkills()
          .map((skill) => skill.skill),
      };
    }

    public getServerUrl(request: Request): string {
      if (
        request.headers['x-forwarded-proto'] &&
        request.headers['x-forwarded-host']
      ) {
        return (
          request.headers['x-forwarded-proto'] +
          '://' +
          request.headers['x-forwarded-host']
        );
      }
      return request.protocol + '://' + request.get('host');
    }

    @UseGuards(...(guards ?? []))
    @Post(basePath ?? DEFAULT_A2A_BASE_PATH)
    public async agentHandler(
      @Body() body: JSONRPCRequest,
      @Res({ passthrough: true }) response: Response,
    ): Promise<JSONRPCResponse | null> {
      try {
        if (!isValidJsonRpcRequest(body)) {
          throw A2AException.invalidRequest(
            'Invalid JSON-RPC request structure.',
          );
        }

        switch (body.method) {
          case TaskMethod.SEND:
            return await this.a2aExecutor.handleTaskSend(
              body as SendTaskRequest,
            );
          case TaskMethod.SEND_SUBSCRIBE:
            if (this.a2aOptions?.card?.capabilities?.streaming) {
              await this.a2aExecutor.handleTaskSendSubscribe(
                body as SendTaskStreamingRequest,
                response,
              );
              return Promise.resolve(null);
            } else {
              throw A2AException.unsupportedOperation(
                TaskMethod.SEND_SUBSCRIBE,
              );
            }
          case TaskMethod.GET:
            return await this.a2aExecutor.handleTaskGet(body as GetTaskRequest);
          case TaskMethod.CANCEL:
            return await this.a2aExecutor.handleTaskCancel(
              body as CancelTaskRequest,
            );
          case TaskMethod.GET_PUSH_NOTIFICATION:
            if (this.a2aOptions?.card?.capabilities?.pushNotifications) {
              return await this.a2aExecutor.handleTaskGetPushNotification(
                body as GetTaskPushNotificationRequest,
              );
            } else {
              throw A2AException.unsupportedOperation(
                TaskMethod.GET_PUSH_NOTIFICATION,
              );
            }
          case TaskMethod.RESUBSCRIBE:
            if (this.a2aOptions?.card?.capabilities?.streaming) {
              return await this.a2aExecutor.handleTaskResubscribe(
                body as TaskResubscriptionRequest,
              );
            } else {
              throw A2AException.unsupportedOperation(TaskMethod.RESUBSCRIBE);
            }
          default:
            throw A2AException.methodNotFound(body.method);
        }
      } catch (error) {
        if (!(error instanceof A2AException)) {
          error = A2AException.internalError(
            (error as Error).message ?? 'Unknown error',
          );
        }
        return JSONRPCResponse.error((error as A2AException).toJSONRPCError());
      }
    }
  }

  return A2AController;
}
