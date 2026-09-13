
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
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
    return (
        <div className="flex h-screen transition-opacity duration-500 opacity-100">
            <Sidebar />
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
