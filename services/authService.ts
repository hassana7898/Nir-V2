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

/** Username used by the single-account login form (the server defaults to "admin" too). */
export const DEFAULT_USERNAME = 'admin';

export interface LoginOptions {
  totp?: string;
  rememberDevice?: boolean;
}

export interface LoginResult {
  /** The HTTP request itself succeeded (2xx). */
  ok: boolean;
  status: number;
  /** Credentials accepted AND no further 2FA step is pending. */
  success: boolean;
  /** The server asked for a 2FA code before it will complete the login. */
  twoFactorRequired: boolean;
  /** The authenticated user object when `success` is true (null otherwise). */
  user: any | null;
  /** Server-provided error message (wrong password / wrong code / etc.). */
  error: string | null;
  /** The RAW parsed response body, so callers can inspect any extra fields. */
  body: any;
}

/**
 * Server-backed login (POST /api/auth/login).
 *
 * Called with NO arguments it keeps the legacy behaviour of merely marking the local session
 * mirror (offline convenience). Called with credentials it performs the real request and
 * returns the raw body plus normalised flags, so the caller can detect `twoFactorRequired`
 * and re-submit with a `totp` code.
 */
export const login = async (
  username?: string,
  password?: string,
  opts?: LoginOptions,
): Promise<LoginResult> => {
  // Legacy zero-argument call: just stamp the local session mirror (unchanged behaviour).
  if (username === undefined || password === undefined) {
    sessionStorage.setItem(SESSION_KEY, 'true');
    return { ok: true, status: 200, success: true, twoFactorRequired: false, user: null, error: null, body: null };
  }

  try {
    const payload: Record<string, unknown> = { username, password };
    if (opts?.totp) payload.totp = opts.totp;
    if (opts?.rememberDevice !== undefined) payload.rememberDevice = opts.rememberDevice;

    const { ok, status, body } = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (ok) {
      const twoFactorRequired = body?.twoFactorRequired === true && body?.success !== true;
      const success = body?.success === true && !twoFactorRequired;
      if (success) sessionStorage.setItem(SESSION_KEY, 'true');
      return {
        ok,
        status,
        success,
        twoFactorRequired,
        user: body?.user ?? null,
        error: body?.error ?? null,
        body,
      };
    }

    // A definitive server rejection (bad credentials, wrong 2FA code, rate-limit ...) must
    // never be overridden by the local offline mirror.
    if ([400, 401, 403, 409, 429].includes(status)) {
      return { ok, status, success: false, twoFactorRequired: false, user: null, error: body?.error ?? null, body };
    }
  } catch { /* network failure -> offline fallback below */ }

  // Offline fallback: a browser that authenticated before can still sign in locally.
  const localOk = await verifyPasswordLocally(password);
  if (localOk) sessionStorage.setItem(SESSION_KEY, 'true');
  return {
    ok: localOk,
    status: localOk ? 200 : 0,
    success: localOk,
    twoFactorRequired: false,
    user: null,
    error: localOk ? null : 'ورود ناموفق بود.',
    body: null,
  };
};

export const logout = async (): Promise<void> => {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline is fine */ }
  sessionStorage.removeItem(SESSION_KEY);
};

/**
 * Clears the local auth mirror (session flag + bearer token). Called when the server answers
 * 401 so a stale local flag can never keep an authenticated-but-empty shell on screen; the
 * AuthProvider then re-renders the login route.
 */
export const clearLocalAuth = (): void => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { window.localStorage.removeItem('nir_token'); } catch { /* ignore */ }
};

/** Server session first; the local flag is only an offline convenience. */
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const { ok, status } = await apiFetch('/api/auth/me');
    if (ok) return true;
    // A definitive server verdict: not signed in.
    if (status === 401 || status === 403) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
    // The server answered but gave NO auth verdict (e.g. 429 throttling on
    // /api/auth, or a 5xx). Never silently grant access off a stale local flag:
    // the route guard must send an unverified user to /login. (The offline flag is
    // intentionally kept so a later genuinely-offline load can still use it.)
    return false;
  } catch {
    // Transport failure only = genuinely offline (intranet). Keep the local
    // convenience so an already-signed-in browser keeps working without the server.
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  }
};

/** GET /api/auth/me -> the current user ({ id, username, role }) or null when signed out. */
export const getCurrentUser = async (): Promise<{ id?: string; username?: string; role?: string } | null> => {
  try {
    const { ok, body } = await apiFetch('/api/auth/me');
    if (ok) return body?.user ?? null;
  } catch { /* offline / not signed in */ }
  return null;
};

/** POST /api/auth/change-password -> change the signed-in user's password. */
export const changePassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error: string | null }> => {
  const { ok, body } = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const success = ok && body?.success !== false;
  return { ok: success, error: success ? null : (body?.error || 'تغییر رمز عبور ناموفق بود.') };
};

/** GET /api/auth/2fa/status -> is two-factor authentication currently enabled. */
export const twoFactorStatus = async (): Promise<boolean> => {
  try {
    const { ok, body } = await apiFetch('/api/auth/2fa/status');
    if (ok) return Boolean(body?.enabled);
  } catch { /* fall through */ }
  return false;
};

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  /** A LOCAL `data:image/png;base64,...` URI (never an external URL). */
  qrDataUrl: string;
}

/** POST /api/auth/2fa/generate -> fresh TOTP secret + a local QR data-URI. */
export const twoFactorGenerate = async (): Promise<TwoFactorSetup> => {
  const { ok, body } = await apiFetch('/api/auth/2fa/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!ok || !body?.secret) throw new Error(body?.error || 'تولید کلید دو مرحله‌ای ناموفق بود.');
  return {
    secret: String(body.secret),
    otpauthUrl: String(body.otpauthUrl || ''),
    qrDataUrl: String(body.qrDataUrl || ''),
  };
};

/** POST /api/auth/2fa/verify -> confirm a 6-digit code to enable 2FA. */
export const twoFactorVerify = async (code: string): Promise<{ ok: boolean; error: string | null }> => {
  const { ok, body } = await apiFetch('/api/auth/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const success = ok && body?.success !== false;
  return { ok: success, error: success ? null : (body?.error || 'کد تأیید نادرست است.') };
};

/** POST /api/auth/2fa/disable -> turn 2FA off (requires the account password). */
export const twoFactorDisable = async (password: string): Promise<{ ok: boolean; error: string | null }> => {
  const { ok, body } = await apiFetch('/api/auth/2fa/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const success = ok && body?.success !== false;
  return { ok: success, error: success ? null : (body?.error || 'غیرفعال‌سازی دو مرحله‌ای ناموفق بود.') };
};

// ---------------------------------------------------------------------------
// Server-side automatic backups (admin-only). Co-located here because this is the
// service module owned by this workstream; requests reuse the same apiFetch
// conventions (credentials: 'include', cache: 'no-store').
// ---------------------------------------------------------------------------

export interface ServerBackupFile {
  name: string;
  sizeBytes: number;
  mtime: string;
}

/** GET /api/backup/server-list -> scheduled server backups (newest first). */
export const listServerBackups = async (): Promise<ServerBackupFile[]> => {
  const { ok, body } = await apiFetch('/api/backup/server-list');
  if (!ok || !body?.success) throw new Error(body?.error || 'دریافت لیست پشتیبان‌ها ناموفق بود.');
  return Array.isArray(body.files) ? (body.files as ServerBackupFile[]) : [];
};

/** POST /api/backup/restore-server-file -> 1-click restore from a server-side backup. */
export const restoreServerBackup = async (
  filename: string,
): Promise<{ ok: boolean; report: any; error: string | null }> => {
  const { ok, body } = await apiFetch('/api/backup/restore-server-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  const success = ok && body?.success !== false;
  return { ok: success, report: body, error: success ? null : (body?.error || 'بازیابی پشتیبان ناموفق بود.') };
};
