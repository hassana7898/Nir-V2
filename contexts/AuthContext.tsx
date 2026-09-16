import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';

export interface AuthUser {
    id?: string;
    username?: string;
    role?: string;
    [key: string]: any;
}

/** Result of a login attempt, so the caller can drive the optional 2FA step. */
export interface LoginOutcome {
    /** Credentials accepted and the user is now signed in. */
    success: boolean;
    /** The server asked for a 2FA code before it will finish the login. */
    twoFactorRequired: boolean;
    /** Server-provided error message (wrong password / wrong code / etc.). */
    error?: string | null;
}

export interface LoginOptions {
    totp?: string;
    rememberDevice?: boolean;
}

interface AuthContextType {
    isAuthenticated: boolean;
    isPasswordSet: boolean;
    loading: boolean;
    /** The signed-in user ({ id, username, role }) when known, otherwise null. */
    user: AuthUser | null;
    /** The current role, upper-cased (e.g. 'ADMIN', 'VIEWER') or '' when unknown. */
    role: string;
    /** role === 'ADMIN'. */
    isAdmin: boolean;
    /** role === 'VIEWER'. */
    isViewer: boolean;
    login: (username: string, password: string, opts?: LoginOptions) => Promise<LoginOutcome>;
    logout: () => void;
    setupPassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isPasswordSet, setIsPasswordSet] = useState(false);
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    // Both flags now come from the server (users table is authoritative), with a local
    // offline fallback inside authService. The user object (and therefore the role) is
    // fetched from /api/auth/me once we know the browser is authenticated.
    const checkStatus = useCallback(async () => {
        setLoading(true);
        try {
            const passwordSet = await authService.isPasswordSet();
            const authenticated = passwordSet ? await authService.isAuthenticated() : false;
            setIsPasswordSet(passwordSet);
            setIsAuthenticated(authenticated);
            setUser(authenticated ? await authService.getCurrentUser() : null);
        } catch {
            setIsPasswordSet(false);
            setIsAuthenticated(false);
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void checkStatus();
    }, [checkStatus]);

    const login = async (username: string, password: string, opts?: LoginOptions): Promise<LoginOutcome> => {
        // authService.login handles the server call (and the offline fallback), and already
        // stamps the local session mirror on success. An empty username falls back to the
        // default account, so the single-user (admin) flow keeps working unchanged.
        const effectiveUsername = (username || '').trim() || authService.DEFAULT_USERNAME;
        const result = await authService.login(effectiveUsername, password, opts);

        if (result.success) {
            setIsAuthenticated(true);
            const resolvedUser = result.user ?? (result.ok ? await authService.getCurrentUser().catch(() => null) : null);
            setUser(resolvedUser ?? null);
            return { success: true, twoFactorRequired: false };
        }

        if (result.twoFactorRequired) {
            return { success: false, twoFactorRequired: true };
        }

        return { success: false, twoFactorRequired: false, error: result.error };
    };

    const logout = () => {
        void authService.logout().catch(() => { /* best-effort local sign-out */ });
        setIsAuthenticated(false);
        setUser(null);
    };

    const setupPassword = async (password: string): Promise<void> => {
        await authService.setPassword(password);
        await checkStatus();
    };

    const role = (user?.role || '').toUpperCase();
    const isAdmin = role === 'ADMIN';
    const isViewer = role === 'VIEWER';

    return (
        <AuthContext.Provider value={{ isAuthenticated, isPasswordSet, loading, user, role, isAdmin, isViewer, login, logout, setupPassword }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
