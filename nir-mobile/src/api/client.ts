/**
 * Smart Axios Network Client for NIR Mobile.
 *
 * Features:
 * - Bearer Token auto-injection from SecureStorage
 * - Automatic 401 Token Refresh with queued retry mechanism
 * - AUTH_EXPIRED event emission on invalid refresh token
 * - Configurable server URL (VPS / LAN / dev), guarded against cross-environment mistakes
 *
 * REMOVED in Phase 1 (security): the "offline demo engine" that fabricated API responses.
 * It used to inject mock payloads (a) whenever offline mode was on, (b) on ANY network error and
 * (c) on HTTP 404 — which silently hid every server-side route mismatch and made the app look
 * "working" while writing nothing. A failure is now a failure: real errors reach the caller.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { SecureStorageService } from '../services/secureStore';
import { Endpoints } from './endpoints';
import {
  evaluateBaseUrl,
  resolveAppVariant,
  detectTargetEnvironment,
  hostOf,
  variantLabel,
  type AppVariant,
} from '../utils/envGuard';

// Default API URL baked into the bundle by app.config.js / eas.json (APP_VARIANT).
export const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://app.artadan.ir').replace(/\/+$/, '');

// Which app this bundle is: a dev build (ir.artadan.nir.dev) must never reach production.
export const APP_VARIANT: AppVariant = resolveAppVariant(DEFAULT_API_URL);

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

export const onAuthExpired = (listener: AuthExpiredListener): (() => void) => {
  authExpiredListeners.add(listener);
  return () => authExpiredListeners.delete(listener);
};

export const notifyAuthExpired = (): void => {
  for (const listener of authExpiredListeners) {
    try {
      listener();
    } catch (e) {
      console.error('[NIR API] Error in auth expired listener:', e);
    }
  }
};

export const apiClient: AxiosInstance = axios.create({
  baseURL: DEFAULT_API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export interface SetApiBaseUrlResult {
  allowed: boolean;
  url: string;
  reason?: string;
}

/**
 * Point the client at another server (LAN / VPS testing). Switching to the OTHER artadan
 * environment is refused: a dev build can never be aimed at production and vice versa
 * (see utils/envGuard.ts). Returns the effective decision so the UI can explain a refusal.
 */
export const setApiBaseUrl = (url: string): SetApiBaseUrlResult => {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const decision = evaluateBaseUrl(APP_VARIANT, cleanUrl, DEFAULT_API_URL);
  apiClient.defaults.baseURL = decision.url;
  SecureStorageService.setServerUrl(decision.url).catch(() => {});
  if (!decision.allowed) {
    console.warn(`[NIR API] Refused base URL "${cleanUrl}": ${decision.reason}`);
  }
  return decision;
};

export const getApiBaseUrl = (): string => {
  return apiClient.defaults.baseURL || DEFAULT_API_URL;
};

/** "where is this build pointed" summary, shown on the login screen. */
export const describeApiTarget = (): string => {
  const baseUrl = getApiBaseUrl();
  const host = hostOf(baseUrl) || baseUrl;
  const target = detectTargetEnvironment(baseUrl);
  const envLabel = target === 'dev' ? 'توسعه' : target === 'production' ? 'عملیاتی' : 'سفارشی';
  return `${host} · ${envLabel} · ${variantLabel(APP_VARIANT)}`;
};

// Bootstrap the saved server URL - re-validated on every launch, so a stale or foreign value
// (e.g. a prod address left over from an old build) cannot survive an upgrade.
SecureStorageService.getServerUrl()
  .then((savedUrl) => {
    if (!savedUrl) return;
    const decision = evaluateBaseUrl(APP_VARIANT, savedUrl, DEFAULT_API_URL);
    apiClient.defaults.baseURL = decision.url;
    if (!decision.allowed) {
      console.warn(`[NIR API] Stored base URL "${savedUrl}" refused: ${decision.reason}`);
    }
  })
  .catch(() => {});

console.log(`[NIR API] variant=${APP_VARIANT} target=${describeApiTarget()}`);

// Queue state for requests waiting on token refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  config: InternalAxiosRequestConfig;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.config.headers.Authorization = `Bearer ${token}`;
      prom.resolve(apiClient(prom.config));
    }
  });
  failedQueue = [];
};

// Request Interceptor: attach the Bearer access token (no mock short-circuit any more)
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (!config.headers.Authorization) {
      const token = await SecureStorageService.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: 401 catch & token refresh queue.
// Real failures (network / 404 / 5xx) are propagated untouched — nothing is fabricated.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const url = originalRequest.url || '';
    const status = error.response?.status;

    // Visibility: these two cases used to be swallowed by mock payloads.
    if (!error.response) {
      console.warn(
        `[NIR API] Network failure on ${(originalRequest.method || 'get').toUpperCase()} ${url}: ${error.message}`
      );
    } else if (status === 404) {
      console.warn(
        `[NIR API] 404 on ${(originalRequest.method || 'get').toUpperCase()} ${url} - route not found on the server.`
      );
    }

    // Ignore 401 on login, verify, or refresh endpoints to prevent recursive loops
    const isAuthEndpoint =
      url.includes(Endpoints.auth.login) ||
      url.includes(Endpoints.auth.verifyOtp) ||
      url.includes(Endpoints.auth.refresh);

    if (status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStorageService.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const refreshResponse = await axios.post(
          `${apiClient.defaults.baseURL}${Endpoints.auth.refresh}`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        const newAccessToken = refreshResponse.data?.accessToken;
        const newRefreshToken = refreshResponse.data?.refreshToken;

        if (!newAccessToken) {
          throw new Error('Refresh response missing access token');
        }

        await SecureStorageService.setAccessToken(newAccessToken);
        if (newRefreshToken) {
          await SecureStorageService.setRefreshToken(newRefreshToken);
        }

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        processQueue(null, newAccessToken);

        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        await SecureStorageService.clearAuthSession();
        notifyAuthExpired();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
