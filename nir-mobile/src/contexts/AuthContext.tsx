/**
 * Authentication Context for NIR Mobile Client.
 *
 * Supported flows (Phase 1 — real backend only):
 *   - Driver / Farmer : mobile number + SMS OTP
 *   - Manager / Admin : username + password (+ optional TOTP 2FA)
 *
 * REMOVED in Phase 1 (security):
 *   - "one-touch offline demo login" that stored a synthetic token plus a mock user profile
 *   - the OTP/verify offline fallback that granted a session when the server was unreachable
 *   - the hardcoded fallback credentials inside the password login
 * A cached session is trusted only when it holds a real access token AND a role the server issued.
 * (tests/noMockFallback.test.ts fails the build if any of these come back, which is why the exact
 * identifiers are not repeated here.)
 */

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { apiClient, onAuthExpired } from '../api/client';
import { Endpoints } from '../api/endpoints';
import { extractApiErrorMessage } from '../api/errors';
import { SecureStorageService } from '../services/secureStore';
import type {
  AuthState,
  LoginResponse,
  MobileUser,
  OtpRequestResponse,
  UserRole,
} from '../types/auth';

export const KNOWN_ROLES: UserRole[] = ['DRIVER', 'FARMER', 'MANAGER', 'ADMIN'];

/** Fail-closed role check: anything the server did not explicitly issue keeps the user signed out. */
export const isKnownRole = (role: unknown): role is UserRole =>
  KNOWN_ROLES.includes(String(role || '').toUpperCase() as UserRole);

export interface AuthContextType extends AuthState {
  requestOtp: (phone: string) => Promise<OtpRequestResponse>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  loginWithPassword: (
    username: string,
    password: string,
    totpCode?: string
  ) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const UNAUTHENTICATED: AuthState = {
  isLoading: false,
  isAuthenticated: false,
  user: null,
  role: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    user: null,
    role: null,
  });

  // Handle auto-logout on refresh token expiration
  useEffect(() => {
    const unsubscribe = onAuthExpired(() => {
      console.warn('[NIR Auth] Session expired. Resetting authentication state.');
      setState(UNAUTHENTICATED);
    });
    return () => unsubscribe();
  }, []);

  // Bootstrap session from SecureStore on startup (real token + known role only)
  const bootstrapSession = useCallback(async () => {
    try {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 1500)
      );

      const fetchPromise = Promise.all([
        SecureStorageService.getAccessToken(),
        SecureStorageService.getRefreshToken(),
        SecureStorageService.getUserData<MobileUser>(),
      ]);

      const result = await Promise.race([fetchPromise, timeoutPromise]);

      if (result) {
        const [accessToken, , cachedUser] = result;
        if (accessToken && cachedUser && isKnownRole(cachedUser.role)) {
          setState({
            isLoading: false,
            isAuthenticated: true,
            user: cachedUser,
            role: cachedUser.role,
          });
          return;
        }

        // A stored session without a token, without a user or with a role we never issue is not a
        // session: wipe it instead of letting the app open a screen it has no rights for.
        if (accessToken || cachedUser) {
          console.warn('[NIR Auth] Discarding invalid cached session (missing token or unknown role).');
          await SecureStorageService.clearAuthSession();
        }
      }

      setState(UNAUTHENTICATED);
    } catch (err) {
      console.error('[NIR Auth] Bootstrap session failed:', err);
      setState(UNAUTHENTICATED);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  /**
   * Request OTP SMS for Drivers / Farmers. Errors are propagated to the screen (no fake code).
   */
  const requestOtp = useCallback(async (phone: string): Promise<OtpRequestResponse> => {
    const response = await apiClient.post<OtpRequestResponse>(Endpoints.auth.requestOtp, {
      phone,
    });
    return response.data;
  }, []);

  /**
   * Verify OTP and establish a driver/farmer session.
   */
  const verifyOtp = useCallback(async (phone: string, code: string): Promise<void> => {
    const response = await apiClient.post<{
      success: boolean;
      user: MobileUser;
      accessToken: string;
      refreshToken: string;
    }>(Endpoints.auth.verifyOtp, { phone, code });

    const { user, accessToken, refreshToken } = response.data;

    if (!accessToken || !refreshToken || !user || !isKnownRole(user.role)) {
      throw new Error('پاسخ سرور برای ورود نامعتبر بود. لطفاً دوباره تلاش کنید.');
    }

    await Promise.all([
      SecureStorageService.setAccessToken(accessToken),
      SecureStorageService.setRefreshToken(refreshToken),
      SecureStorageService.setUserData(user),
    ]);

    setState({
      isLoading: false,
      isAuthenticated: true,
      user,
      role: user.role,
    });
  }, []);

  /**
   * Password login for Manager / Admin (+ optional TOTP 2FA).
   */
  const loginWithPassword = useCallback(
    async (username: string, password: string, totpCode?: string): Promise<LoginResponse> => {
      try {
        const response = await apiClient.post<LoginResponse>(Endpoints.auth.login, {
          username: username.trim(),
          password,
          totpCode,
        });

        const data = response.data;

        if (data.requires2FA) {
          return { success: false, requires2FA: true };
        }

        if (!data.success || !data.user || !data.accessToken || !data.refreshToken) {
          throw new Error(data.message || 'پاسخ سرور برای ورود نامعتبر بود.');
        }

        if (!isKnownRole(data.user.role)) {
          throw new Error('نقش کاربری این حساب در اپلیکیشن موبایل پشتیبانی نمی‌شود.');
        }

        await Promise.all([
          SecureStorageService.setAccessToken(data.accessToken),
          SecureStorageService.setRefreshToken(data.refreshToken),
          SecureStorageService.setUserData(data.user),
        ]);

        setState({
          isLoading: false,
          isAuthenticated: true,
          user: data.user,
          role: data.user.role,
        });

        return data;
      } catch (err: any) {
        // Some legacy paths answer HTTP 200 with { success:false, twoFactorRequired:true }.
        const payload = err?.response?.data;
        if (payload?.twoFactorRequired || payload?.requires2FA) {
          return { success: false, requires2FA: true };
        }
        // No fallback credentials: the server's own message is what the operator must see.
        throw new Error(extractApiErrorMessage(err, 'نام کاربری یا کلمه عبور اشتباه است'));
      }
    },
    []
  );

  /**
   * Logout: revoke the server session (the endpoint also deletes the session bound to the refresh
   * token) and always wipe local credentials, even when the server is unreachable.
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      const refreshToken = await SecureStorageService.getRefreshToken();
      await apiClient
        .post(Endpoints.auth.logout, refreshToken ? { refreshToken } : {})
        .catch(() => {});
    } finally {
      await SecureStorageService.clearAuthSession();
      setState(UNAUTHENTICATED);
    }
  }, []);

  /**
   * Force refresh session.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    const refreshToken = await SecureStorageService.getRefreshToken();
    if (!refreshToken) {
      await logout();
      return;
    }

    try {
      const response = await apiClient.post<{
        success: boolean;
        accessToken: string;
        refreshToken?: string;
        user?: MobileUser;
      }>(Endpoints.auth.refresh, { refreshToken });

      await SecureStorageService.setAccessToken(response.data.accessToken);
      if (response.data.refreshToken) {
        await SecureStorageService.setRefreshToken(response.data.refreshToken);
      }
      if (response.data.user && isKnownRole(response.data.user.role)) {
        await SecureStorageService.setUserData(response.data.user);
        setState((prev) => ({
          ...prev,
          user: response.data.user ?? prev.user,
          role: response.data.user?.role ?? prev.role,
        }));
      }
    } catch {
      await logout();
    }
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        requestOtp,
        verifyOtp,
        loginWithPassword,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
