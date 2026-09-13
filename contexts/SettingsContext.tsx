import React, { createContext, useState, useEffect, useContext, ReactNode, useMemo } from 'react';
import { Settings } from '../types';
import { loadSettings as loadSettingsFromService, saveSettings as saveSettingsToService } from '../services/dataService';

interface SettingsContextType {
    settings: Settings;
    productMap: Map<string, string>;
    loadSettings: () => void;
    saveSettings: (newSettings: Settings) => void;
    loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<Settings>(loadSettingsFromService());
    const [loading, setLoading] = useState(true);

    const productMap = useMemo(() => {
        return new Map(settings.products.map(p => [p.id, p.name]));
    }, [settings.products]);

    const loadSettings = () => {
        setLoading(true);
        const loadedSettings = loadSettingsFromService();
        setSettings(loadedSettings);
        setLoading(false);
    };

    const saveSettings = (newSettings: Settings) => {
        saveSettingsToService(newSettings);
        setSettings(newSettings);
    };

    useEffect(() => {
        loadSettings();
    }, []);

    return (
        <SettingsContext.Provider value={{ settings, productMap, loadSettings, saveSettings, loading }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};