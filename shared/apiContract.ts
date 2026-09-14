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
  | 'IDEMPOTENCY_KEY_REUSE'
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
    case 'IDEMPOTENCY_KEY_REUSE': return 409;
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
const CONTRACT_CODES: ApiErrorCode[] = [
  'VALIDATION_FAILED', 'AUTH_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
  'RATE_LIMITED', 'SERVER_ERROR', 'INSUFFICIENT_STOCK', 'UNKNOWN_PRODUCT',
  'UNKNOWN_FARMER', 'IDEMPOTENCY_KEY_REUSE', 'OFFLINE',
];

/**
 * Drizzle/`pg` wrap driver failures, so the meaningful `code` can sit several
 * `cause` levels deep (e.g. `_DrizzleQueryError -> error: duplicate key ... 23505`).
 * Walk the chain instead of inspecting only the outermost error.
 */
const errorChain = (error: any): any[] => {
  const chain: any[] = [];
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    chain.push(current);
    if (!current.cause || current.cause === current) break;
    current = current.cause;
  }
  return chain;
};

export const toApiError = (error: any): { status: number; body: ApiResponse<never> } => {
  const chain = errorChain(error);

  // 1) Explicit contract error raised by the service layer (typed codes win).
  const contract = chain.find((e) => e && typeof e.code === 'string' && CONTRACT_CODES.includes(e.code));
  if (contract) {
    const code = contract.code as ApiErrorCode;
    const details = contract.authoritativeRecord ? { authoritativeRecord: contract.authoritativeRecord } : contract.details;
    return { status: contract.status || statusForErrorCode(code), body: createErrorResponse(code, contract.message, details) };
  }

  // 2) Zod validation
  const zod = chain.find((e) => e && Array.isArray(e.issues));
  if (zod) {
    return { status: 422, body: createErrorResponse('VALIDATION_FAILED', 'اطلاعات ارسالی نامعتبر است.', { errors: zod.issues }) };
  }

  // 3) PostgreSQL driver errors - mapped precisely, never echoing the SQL
  const pgCode = chain.map((e) => e && e.code).find((c) => typeof c === 'string' && !!c);
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
