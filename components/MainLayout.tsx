
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { hydrateFromServer, onUnauthorized } from '../services/dataService';
import Sidebar from './Sidebar';
import SyncStatusIndicator from './SyncStatusIndicator';
import EntryPage from '../pages/EntryPage';
import ExitPage from '../pages/ExitPage';
import ReportsPage from '../pages/ReportsPage';
import ReportsDashboard from '../pages/ReportsDashboard';
import LogPage from '../pages/LogPage';
import SettingsPage from '../pages/SettingsPage';
import InventoryPage from '../pages/InventoryPage';
import ProductionPage from '../pages/ProductionPage';
import InventoryAnalysisPage from '../pages/InventoryAnalysisPage';
import FarmersPage from '../pages/FarmersPage';
import ActiveBroodsPage from '../pages/ActiveBroodsPage';
import DashboardPage from '../pages/DashboardPage';
import GlobalSearchPage from '../pages/GlobalSearchPage';
import WeighbridgePage from '../pages/WeighbridgePage';

const MainLayout: React.FC = () => {
    const { loadSettings, settings } = useSettings();
    const { logout } = useAuth();
    // Gate rendering on a full hydration so every page mounts with a populated cache.
    // Without this, a freshly cleared browser rendered empty screens forever, because
    // each page reads synchronously from the local cache inside a one-shot effect.
    const [ready, setReady] = useState(false);

    // Mobile navigation drawer. On >= md the sidebar is a static column and this is
    // ignored; below md the sidebar becomes an off-canvas drawer toggled here.
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // If a 401/session-expiry is observed while we are inside the app (e.g. the cookie
    // expired but a stale local flag still said "authenticated"), drop straight to the
    // login screen instead of leaving the user on a blank dashboard.
    useEffect(() => onUnauthorized(() => { logout(); }), []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="flex h-screen w-full overflow-hidden transition-opacity duration-500 opacity-100">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <SyncStatusIndicator />
            <div className="flex-1 flex flex-col min-w-0">
                {/* Mobile-only top bar with the navigation toggle. Hidden on md+ where
                    the sidebar is always visible as a static column. */}
                <header className="md:hidden flex items-center gap-3 bg-slate-800 text-white px-3 py-2 no-print shrink-0">
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        aria-label="باز کردن منو"
                        aria-expanded={sidebarOpen}
                        className="p-2 rounded-lg hover:bg-slate-700 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    <span className="font-bold truncate">{settings.factoryName}</span>
                </header>
                <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto bg-slate-100 min-w-0">
                    <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/entry" element={<EntryPage />} />
                        <Route path="/exit" element={<ExitPage />} />
                        <Route path="/farmers" element={<FarmersPage />} />
                        <Route path="/broods" element={<ActiveBroodsPage />} />
                        <Route path="/inventory" element={settings.enabledMenus?.warehouses !== false ? <InventoryPage /> : <Navigate to="/dashboard" replace />} />
                        <Route path="/inventory-analysis" element={settings.enabledMenus?.inventoryAnalysis !== false ? <InventoryAnalysisPage /> : <Navigate to="/dashboard" replace />} />
                        <Route path="/production" element={settings.enabledMenus?.production !== false ? <ProductionPage /> : <Navigate to="/dashboard" replace />} />
                        <Route path="/weighbridge" element={settings.enabledMenus?.weighbridge !== false ? <WeighbridgePage /> : <Navigate to="/dashboard" replace />} />
                        <Route path="/global-search" element={<GlobalSearchPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                        <Route path="/reports-dashboard" element={<ReportsDashboard />} />
                        <Route path="/log" element={<LogPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
