export type UserRole = 'DRIVER' | 'FARMER' | 'MANAGER' | 'ADMIN';

export interface MobileUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string | null;
  driverId?: string | null;
  farmerId?: string | null;
  phone?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  success: boolean;
  user: MobileUser;
  accessToken: string;
  refreshToken: string;
  message?: string;
}

export interface OtpRequestResponse {
  success: boolean;
  message?: string;
  expiresIn?: number;
  debugCode?: string;
}

export interface LoginResponse {
  success: boolean;
  user?: MobileUser;
  accessToken?: string;
  refreshToken?: string;
  requires2FA?: boolean;
  message?: string;
}

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: MobileUser | null;
  role: UserRole | null;
}
