export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'INSUFFICIENT_STOCK'
  | 'UNKNOWN_PRODUCT'
  | 'UNKNOWN_FARMER'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'OFFLINE';

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

/** HTTP status implied by each contract error code. */
export const statusForErrorCode = (code: ApiErrorCode): number => {
  switch (code) {
    case 'AUTH_FAILED': return 401;
    case 'FORBIDDEN': return 403;
    case 'NOT_FOUND': return 404;
    case 'CONFLICT': return 409;
    case 'IDEMPOTENCY_KEY_REUSED': return 409;
    case 'RATE_LIMITED': return 429;
    case 'VALIDATION_FAILED': return 422;
    case 'INSUFFICIENT_STOCK': return 422;
    case 'UNKNOWN_PRODUCT': return 422;
    case 'UNKNOWN_FARMER': return 422;
    default: return 500;
  }
};

/**
 * Convert any thrown error into a contract-safe response.
 * Never leaks raw SQL / driver messages to the client.
 */
export const toApiError = (error: any): { status: number; body: ApiResponse<never> } => {
  // Explicit contract error raised by the service layer
  if (error && typeof error.code === 'string' && statusForErrorCode(error.code) !== 500) {
    const code = error.code as ApiErrorCode;
    const details = error.authoritativeRecord ? { authoritativeRecord: error.authoritativeRecord } : error.details;
    return { status: error.status || statusForErrorCode(code), body: createErrorResponse(code, error.message, details) };
  }

  // Zod validation
  if (error && Array.isArray(error.issues) && error.name === 'ZodError') {
    return {
      status: 422,
      body: createErrorResponse('VALIDATION_FAILED', 'اطلاعات ارسالی نامعتبر است.', { errors: error.issues }),
    };
  }

  // PostgreSQL driver errors - map the important ones, never echo the SQL
  const pgCode = error?.code;
  if (pgCode === '23503') {
    return { status: 422, body: createErrorResponse('VALIDATION_FAILED', 'رکورد مرتبط (محصول/مرغدار/فرمول) در سرور یافت نشد. لطفاً ابتدا آن را ذخیره کنید.') };
  }
  if (pgCode === '23505') {
    return { status: 409, body: createErrorResponse('CONFLICT', 'رکوردی با همین شناسه/مقدار یکتا از قبل وجود دارد.') };
  }
  if (pgCode === '23502') {
    return { status: 422, body: createErrorResponse('VALIDATION_FAILED', 'یکی از فیلدهای الزامی ارسال نشده است.') };
  }

  console.error('[NIR] unhandled API error:', error);
  return { status: 500, body: createErrorResponse('SERVER_ERROR', 'خطای داخلی سرور.') };
};
