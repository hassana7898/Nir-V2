
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { hydrateFromServer } from '../services/dataService';
import Sidebar from './Sidebar';
import SyncStatusIndicator from './SyncStatusIndicator';
import EntryPage from '../pages/EntryPage';
import ExitPage from '../pages/ExitPage';
import ReportsPage from '../pages/ReportsPage';
import LogPage from '../pages/LogPage';
import SettingsPage from '../pages/SettingsPage';
import InventoryPage from '../pages/InventoryPage';
import ProductionPage from '../pages/ProductionPage';
import InventoryAnalysisPage from '../pages/InventoryAnalysisPage';
import FarmersPage from '../pages/FarmersPage';
import ActiveBroodsPage from '../pages/ActiveBroodsPage';
import DashboardPage from '../pages/DashboardPage';
import GlobalSearchPage from '../pages/GlobalSearchPage';

const MainLayout: React.FC = () => {
    const { loadSettings } = useSettings();
    // Gate rendering on a full hydration so every page mounts with a populated cache.
    // Without this, a freshly cleared browser rendered empty screens forever, because
    // each page reads synchronously from the local cache inside a one-shot effect.
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let active = true;
        hydrateFromServer()
            .catch(() => { /* offline / server down: fall back to whatever is cached */ })
            .finally(() => {
                if (!active) return;
                loadSettings(); // refresh the product list the SettingsProvider read before hydration
                setReady(true);
            });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!ready) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-slate-100">
                <p>در حال بارگذاری...</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen transition-opacity duration-500 opacity-100">
            <Sidebar />
            <SyncStatusIndicator />
            <main className="flex-1 p-6 overflow-y-auto bg-slate-100">
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/entry" element={<EntryPage />} />
                    <Route path="/exit" element={<ExitPage />} />
                    <Route path="/farmers" element={<FarmersPage />} />
                    <Route path="/broods" element={<ActiveBroodsPage />} />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/inventory-analysis" element={<InventoryAnalysisPage />} />
                    <Route path="/production" element={<ProductionPage />} />
                    <Route path="/global-search" element={<GlobalSearchPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/log" element={<LogPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                </Routes>
            </main>
        </div>
    );
};

export default MainLayout;
