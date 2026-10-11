/**
 * Smart Axios Network Client for NIR Mobile.
 * Features:
 * - Bearer Token auto-injection from SecureStorage
 * - Automatic 401 Token Refresh with queued retry mechanism
 * - AUTH_EXPIRED event emission on invalid refresh token
 * - Zero-config Offline Demo Engine with realistic mock fallbacks
 * - Dynamic Server URL switching for VPS / local deployment
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { SecureStorageService } from '../services/secureStore';
import { handleMockRoute } from '../services/mockDataService';

// Default production URL or environment override
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://app.artadan.ir';

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

let isOfflineDemo = false;

export const setOfflineDemoMode = (enabled: boolean): void => {
  isOfflineDemo = enabled;
  SecureStorageService.setOfflineMode(enabled).catch(() => {});
};

export const getOfflineDemoMode = (): boolean => isOfflineDemo;

export const apiClient: AxiosInstance = axios.create({
  baseURL: DEFAULT_API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export const setApiBaseUrl = (url: string): void => {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  apiClient.defaults.baseURL = cleanUrl;
  SecureStorageService.setServerUrl(cleanUrl).catch(() => {});
};

export const getApiBaseUrl = (): string => {
  return apiClient.defaults.baseURL || DEFAULT_API_URL;
};

// Bootstrap custom server URL & offline mode from SecureStorage
SecureStorageService.getServerUrl().then((savedUrl) => {
  if (savedUrl) apiClient.defaults.baseURL = savedUrl;
}).catch(() => {});

SecureStorageService.getOfflineMode().then((savedOffline) => {
  isOfflineDemo = savedOffline;
}).catch(() => {});

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

// Request Interceptor: Attach Bearer Access Token & Offline Short-Circuit
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // 1. If explicit offline demo mode is enabled
    if (isOfflineDemo) {
      const method = (config.method || 'get').toUpperCase();
      const url = config.url || '';
      const mockData = handleMockRoute(method, url, config.data);
      if (mockData !== null && mockData !== undefined) {
        config.adapter = async () => ({
          data: mockData,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        });
        return config;
      }
    }

    // 2. Attach Bearer Token if not already present
    if (!config.headers.Authorization) {
      const token = await SecureStorageService.getAccessToken();
      if (token && !token.startsWith('offline_')) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: 401 Catch & Refresh Queue + Offline Fallback
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const url = originalRequest.url || '';
    const status = error.response?.status;

    // 1. If real network request failed due to server offline/unreachable/down (and not 401/422)
    const isNetworkOrDown =
      !error.response ||
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNREFUSED' ||
      error.message?.includes('Network Error') ||
      status === 404;

    if (isNetworkOrDown && url.includes('/api/mobile/')) {
      const method = (originalRequest.method || 'get').toUpperCase();
      const mockData = handleMockRoute(method, url, originalRequest.data);
      if (mockData !== null && mockData !== undefined) {
        return {
          data: mockData,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: originalRequest,
        };
      }
    }

    // 2. Ignore 401 on login, verify, or refresh endpoints to prevent recursive loops
    const isAuthEndpoint =
      url.includes('/api/mobile/auth/login') ||
      url.includes('/api/mobile/auth/otp/verify') ||
      url.includes('/api/mobile/auth/refresh');

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
          `${apiClient.defaults.baseURL}/api/mobile/auth/refresh`,
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
