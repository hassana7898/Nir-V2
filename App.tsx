
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { migrateLegacyData } from './services/dataService';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import MainLayout from './components/MainLayout';

const AppContent: React.FC = () => {
    const { isAuthenticated, isPasswordSet, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-slate-100">
                <p>در حال بارگذاری...</p>
            </div>
        );
    }

    return (
        <Routes>
            {!isPasswordSet ? (
                <Route path="*" element={<SetupPage />} />
            ) : !isAuthenticated ? (
                <Route path="*" element={<LoginPage />} />
            ) : (
                <Route path="/*" element={<MainLayout />} />
            )}
        </Routes>
    );
};


const App: React.FC = () => {

    useEffect(() => {
        // Run data migration once on app load
        migrateLegacyData();
    }, []);

    return (
        <SettingsProvider>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </SettingsProvider>
    );
};

export default App;
