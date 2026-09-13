export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'INSUFFICIENT_STOCK'
  | 'IDEMPOTENCY_KEY_REUSED';

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, any>;
};

export type ApiResponse<T> =
  | { success: true; data: T; serverTimestamp: number; operationId: string; version: number }
  | { success: false; error: ApiError };

export const createSuccessResponse = <T>(
  data: T,
  operationId: string,
  version: number
): ApiResponse<T> => ({
  success: true,
  data,
  serverTimestamp: Date.now(),
  operationId,
  version,
});

export const createErrorResponse = (
  code: ApiErrorCode,
  message: string,
  details?: Record<string, any>
): ApiResponse<never> => ({
  success: false,
  error: { code, message, details },
});
