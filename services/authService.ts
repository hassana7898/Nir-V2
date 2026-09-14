// Authentication is SERVER-backed. The PostgreSQL users table is authoritative, so a
// fresh (empty) database reliably produces the first-run "setup" screen, and a password
// set through the UI creates a real server-side admin account.
//
// A local mirror of the login state is kept ONLY as an offline fallback for users who
// have already authenticated once on this browser.

const PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';

const bufferToHex = (buffer: ArrayBuffer): string => {
  return [...new Uint8Array(buffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const hashPassword = async (password: string, salt: string): Promise<string> => {
  const data = new TextEncoder().encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
};

/** fetch that never lets an HTTP cache answer for us (304s made the app lie). */
const apiFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', ...(init?.headers || {}) },
    ...init,
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* empty / 204 / 304 */ }
  return { ok: res.ok, status: res.status, body };
};

/**
 * Server-authoritative: is an admin account configured?
 * (server `setup:true` means a user row exists.)
 */
export const isPasswordSet = async (): Promise<boolean> => {
  try {
    const { ok, body } = await apiFetch('/api/auth/status');
    if (ok) {
      const configured = Boolean(body?.setup);
      if (configured) {
        if (!localStorage.getItem(PASSWORD_HASH_KEY)) localStorage.setItem(PASSWORD_HASH_KEY, 'server');
      } else {
        // The server is the source of truth: an empty users table means first-run setup.
        localStorage.removeItem(PASSWORD_HASH_KEY);
        localStorage.removeItem(PASSWORD_SALT_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      }
      return configured;
    }
  } catch { /* offline: fall through to the local mirror */ }
  return localStorage.getItem(PASSWORD_HASH_KEY) !== null;
};

/** Creates the real admin account on the server (POST /api/auth/setup). */
export const setPassword = async (password: string): Promise<void> => {
  const { ok, body } = await apiFetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!ok) throw new Error(body?.error || 'ثبت رمز عبور ناموفق بود. دوباره تلاش کنید.');

  // mirror locally so this browser can still log in while offline
  const salt = bufferToHex(crypto.getRandomValues(new Uint8Array(16)) as unknown as ArrayBuffer);
  const hash = await hashPassword(password, salt);
  localStorage.setItem(PASSWORD_SALT_KEY, salt);
  localStorage.setItem(PASSWORD_HASH_KEY, hash);
  sessionStorage.setItem(SESSION_KEY, 'true');
};

const verifyPasswordLocally = async (password: string): Promise<boolean> => {
  const salt = localStorage.getItem(PASSWORD_SALT_KEY);
  const storedHash = localStorage.getItem(PASSWORD_HASH_KEY);
  if (!salt || !storedHash || storedHash === 'server') return false;
  return (await hashPassword(password, salt)) === storedHash;
};

/** Verifies against the server; a definitive rejection is never overridden locally. */
export const verifyPassword = async (password: string): Promise<boolean> => {
  try {
    const { ok, status } = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (ok) return true;
    if ([400, 401, 403, 409, 429].includes(status)) return false; // server answered: rejected
  } catch { /* network failure -> offline fallback */ }
  return verifyPasswordLocally(password);
};

export const login = (): void => {
  sessionStorage.setItem(SESSION_KEY, 'true');
};

export const logout = async (): Promise<void> => {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline is fine */ }
  sessionStorage.removeItem(SESSION_KEY);
};

/** Server session first; the local flag is only an offline convenience. */
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const { ok, status } = await apiFetch('/api/auth/me');
    if (ok) return true;
    if (status === 401 || status === 403) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
  } catch { /* offline */ }
  return sessionStorage.getItem(SESSION_KEY) === 'true';
};
