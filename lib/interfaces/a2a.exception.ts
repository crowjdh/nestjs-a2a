import {
  ErrorCodeInternalError,
  ErrorCodeInvalidParams,
  ErrorCodeInvalidRequest,
  ErrorCodeMethodNotFound,
  ErrorCodeParseError,
  ErrorCodePushNotificationNotSupported,
  ErrorCodeTaskNotCancelable,
  ErrorCodeTaskNotFound,
  ErrorCodeUnsupportedOperation,
  JSONRPCError,
  KnownErrorCode,
} from './a2a.types';

/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export class A2AException extends Error {
  public code: KnownErrorCode | number;
  public data?: unknown;
  public taskId?: string; // Optional task ID context

  constructor(
    code: KnownErrorCode | number,
    message: string,
    data?: unknown,
    taskId?: string,
  ) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.data = data;
    this.taskId = taskId; // Store associated task ID if provided
  }

  /**
   * Formats the error into a standard JSON-RPC error object structure.
   */
  toJSONRPCError(): JSONRPCError<unknown> {
    const errorObject: JSONRPCError<unknown> = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) {
      errorObject.data = this.data;
    }
    return errorObject;
  }

  // Static factory methods for common errors

  static parseError(message: string, data?: unknown): A2AException {
    return new A2AException(ErrorCodeParseError, message, data);
  }

  static invalidRequest(message: string, data?: unknown): A2AException {
    return new A2AException(ErrorCodeInvalidRequest, message, data);
  }

  static methodNotFound(method: string): A2AException {
    return new A2AException(
      ErrorCodeMethodNotFound,
      `Method not found: ${method}`,
    );
  }

  static invalidParams(message: string, data?: unknown): A2AException {
    return new A2AException(ErrorCodeInvalidParams, message, data);
  }

  static internalError(message: string, data?: unknown): A2AException {
    return new A2AException(ErrorCodeInternalError, message, data);
  }

  static taskNotFound(taskId: string): A2AException {
    return new A2AException(
      ErrorCodeTaskNotFound,
      `Task not found: ${taskId}`,
      undefined,
      taskId,
    );
  }

  static taskNotCancelable(taskId: string): A2AException {
    return new A2AException(
      ErrorCodeTaskNotCancelable,
      `Task not cancelable: ${taskId}`,
      undefined,
      taskId,
    );
  }

  static pushNotificationNotSupported(): A2AException {
    return new A2AException(
      ErrorCodePushNotificationNotSupported,
      'Push Notification is not supported',
    );
  }

  static unsupportedOperation(operation: string): A2AException {
    return new A2AException(
      ErrorCodeUnsupportedOperation,
      `Unsupported operation: ${operation}`,
    );
  }
}
