
import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';

interface AuthContextType {
    isAuthenticated: boolean;
    isPasswordSet: boolean;
    loading: boolean;
    login: (password: string) => Promise<boolean>;
    logout: () => void;
    setupPassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isPasswordSet, setIsPasswordSet] = useState(false);
    const [loading, setLoading] = useState(true);

    // Both flags now come from the server (users table is authoritative), with a local
    // offline fallback inside authService.
    const checkStatus = useCallback(async () => {
        setLoading(true);
        try {
            const passwordSet = await authService.isPasswordSet();
            const authenticated = passwordSet ? await authService.isAuthenticated() : false;
            setIsPasswordSet(passwordSet);
            setIsAuthenticated(authenticated);
        } catch {
            setIsPasswordSet(false);
            setIsAuthenticated(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void checkStatus();
    }, [checkStatus]);

    const login = async (password: string): Promise<boolean> => {
        const isValid = await authService.verifyPassword(password);
        if (isValid) {
            authService.login();
            setIsAuthenticated(true);
            return true;
        }
        return false;
    };

    const logout = () => {
        void authService.logout();
        setIsAuthenticated(false);
    };

    const setupPassword = async (password: string): Promise<void> => {
        await authService.setPassword(password);
        await checkStatus();
    };


    return (
        <AuthContext.Provider value={{ isAuthenticated, isPasswordSet, loading, login, logout, setupPassword }}>
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
