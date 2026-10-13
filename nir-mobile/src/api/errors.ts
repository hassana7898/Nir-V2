/**
 * Uniform error extraction for the mobile client.
 *
 * The server answers with `{ error: '...' }` (most routes) or `{ message: '...' }` (auth routes),
 * while axios throws `{ response: { data }, message }`. Screens used to read only
 * `err.response.data.message`, so every real server rejection was rendered as a generic
 * "wrong username or password"-style fallback. Everything user-facing must go through here.
 */

export interface ApiErrorShape {
  response?: {
    status?: number;
    data?: { error?: string; message?: string } | string;
  };
  message?: string;
  code?: string;
}

/** True when the request never reached an HTTP response (offline, DNS, timeout, server down). */
export const isNetworkError = (err: unknown): boolean => {
  const e = err as ApiErrorShape | null;
  if (!e) return false;
  if (e.response) return false;
  const code = String(e.code || '');
  const message = String(e.message || '');
  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    /network error/i.test(message) ||
    /timeout/i.test(message)
  );
};

/** Status code if the server answered, otherwise undefined. */
export const getErrorStatus = (err: unknown): number | undefined =>
  (err as ApiErrorShape | null)?.response?.status;

/**
 * Extract the most specific message the server sent, falling back to a caller-supplied text and
 * finally to the raw axios message. Never returns an empty string.
 */
export const extractApiErrorMessage = (err: unknown, fallback: string): string => {
  const e = err as ApiErrorShape | null;
  const data = e?.response?.data;

  if (typeof data === 'string' && data.trim()) return data.trim();

  const serverError = typeof data === 'object' && data ? data.error : undefined;
  if (serverError && String(serverError).trim()) return String(serverError).trim();

  const serverMessage = typeof data === 'object' && data ? data.message : undefined;
  if (serverMessage && String(serverMessage).trim()) return String(serverMessage).trim();

  if (isNetworkError(err)) return 'ارتباط با سرور برقرار نشد. اتصال اینترنت/شبکه را بررسی کنید.';

  const raw = e?.message ? String(e.message) : '';
  return raw.trim() || fallback;
};

export default extractApiErrorMessage;
