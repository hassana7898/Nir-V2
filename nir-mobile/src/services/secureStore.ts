/**
 * Secure Storage Service for NIR Mobile Client.
 * Manages Access Token, Refresh Token, and User Session via expo-secure-store.
 * Includes graceful memory-fallback for testing and unsupported environments.
 */

let SecureStore: any = null;
try {
  // Dynamically require so Node.js unit tests or web runners don't fail if native module is absent
  SecureStore = require('expo-secure-store');
} catch {
  SecureStore = null;
}

import type { MobileUser } from '../types/auth';

const ACCESS_TOKEN_KEY = 'nir_access_token';
const REFRESH_TOKEN_KEY = 'nir_refresh_token';
const USER_DATA_KEY = 'nir_user_data';

// In-memory fallback for test runners and non-native environments
const memoryFallback = new Map<string, string>();

async function setItemSafe(key: string, value: string): Promise<void> {
  if (SecureStore && typeof SecureStore.setItemAsync === 'function') {
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch {
      // Fallback to memory
    }
  }
  memoryFallback.set(key, value);
}

async function getItemSafe(key: string): Promise<string | null> {
  if (SecureStore && typeof SecureStore.getItemAsync === 'function') {
    try {
      const val = await SecureStore.getItemAsync(key);
      if (val !== null && val !== undefined) return val;
      return memoryFallback.get(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  }
  return memoryFallback.get(key) ?? null;
}

async function deleteItemSafe(key: string): Promise<void> {
  if (SecureStore && typeof SecureStore.deleteItemAsync === 'function') {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  }
  memoryFallback.delete(key);
}

export class SecureStorageService {
  /**
   * Retrieves the current Bearer access token.
   */
  static async getAccessToken(): Promise<string | null> {
    return getItemSafe(ACCESS_TOKEN_KEY);
  }

  /**
   * Persists the Bearer access token.
   */
  static async setAccessToken(token: string): Promise<void> {
    await setItemSafe(ACCESS_TOKEN_KEY, token);
  }

  /**
   * Retrieves the long-lived refresh token.
   */
  static async getRefreshToken(): Promise<string | null> {
    return getItemSafe(REFRESH_TOKEN_KEY);
  }

  /**
   * Persists the refresh token.
   */
  static async setRefreshToken(token: string): Promise<void> {
    await setItemSafe(REFRESH_TOKEN_KEY, token);
  }

  /**
   * Retrieves the cached user profile data.
   */
  static async getUserData<T = MobileUser>(): Promise<T | null> {
    const raw = await getItemSafe(USER_DATA_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Persists the cached user profile data.
   */
  static async setUserData<T = MobileUser>(user: T): Promise<void> {
    await setItemSafe(USER_DATA_KEY, JSON.stringify(user));
  }

  /**
   * Retrieves custom server URL.
   */
  static async getServerUrl(): Promise<string | null> {
    return getItemSafe('nir_server_url');
  }

  /**
   * Persists custom server URL.
   */
  static async setServerUrl(url: string): Promise<void> {
    await setItemSafe('nir_server_url', url);
  }

  /**
   * Wipes all credentials and user profile data on logout or session expiration.
   */
  static async clearAuthSession(): Promise<void> {
    await Promise.all([
      deleteItemSafe(ACCESS_TOKEN_KEY),
      deleteItemSafe(REFRESH_TOKEN_KEY),
      deleteItemSafe(USER_DATA_KEY),
    ]);
  }
}

export default SecureStorageService;
