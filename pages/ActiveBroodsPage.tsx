
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Farmer, Brood, Exit } from '../types';
import * as dataService from '../services/dataService';
import BroodDetailsCard from '../components/BroodDetailsCard';
import { showToast } from '../utils/helpers';
import { toPersianNumerals } from '../utils/formatters';

const StatCard = ({ title, value, unit, icon, color }: any) => (
    <div className={`bg-white p-4 rounded-xl shadow-sm border-r-4 ${color} flex items-center justify-between`}>
        <div>
            <p className="text-xs text-slate-500 mb-1">{title}</p>
            <p className="text-xl font-bold text-slate-700">
                {toPersianNumerals(value)} <span className="text-xs font-normal text-slate-400">{unit}</span>
            </p>
        </div>
        <div className="text-slate-200">{icon}</div>
    </div>
);

const ActiveBroodsPage: React.FC = () => {
    const [allBroods, setAllBroods] = useState<{ farmer: Farmer, brood: Brood }[]>([]);
    const [allExits, setAllExits] = useState<Exit[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');

    const fetchData = useCallback(() => {
        const farmers = dataService.getFarmers();
        const exits = dataService.getAllInvoices().filter(i => 'farmerId' in i) as Exit[];
        setAllExits(exits);

        const loadedBroods: { farmer: Farmer, brood: Brood }[] = [];
        farmers.forEach(farmer => {
            if (farmer.isDeleted) return;
            if (Array.isArray(farmer.broods)) {
                farmer.broods.forEach(brood => {
                    loadedBroods.push({ farmer, brood });
                });
            }
        });

        // Sort by start date, newest first
        loadedBroods.sort((a, b) => new Date(b.brood.startDate).getTime() - new Date(a.brood.startDate).getTime());
        setAllBroods(loadedBroods);
    }, []);

    useEffect(() => {
        fetchData();
        const handleFocus = () => { fetchData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [fetchData]);

    const handleBroodUpdate = (updatedBrood: Brood) => {
        const allFarmers = dataService.getFarmers();
        let farmerWasUpdated = false;
        let farmerForLog: Farmer | undefined;
    
        const updatedFarmers = allFarmers.map(farmer => {
            const broodIndex = (farmer.broods || []).findIndex(b => b && b.id === updatedBrood.id);
            if (broodIndex > -1) {
                const newBroods = [...farmer.broods];
                newBroods[broodIndex] = updatedBrood;
                farmerWasUpdated = true;
                farmerForLog = farmer; 
                return { ...farmer, broods: newBroods };
            }
            return farmer;
        });
    
        if (farmerWasUpdated && farmerForLog) {
            dataService.saveFarmers(updatedFarmers);
            dataService.logAction('updated', 'farmer', farmerForLog);
            showToast('اطلاعات دوره به‌روزرسانی شد');
            fetchData();
        } else {
             showToast('خطا در به‌روزرسانی دوره.', 'error');
        }
    };

    const handleBroodDelete = (broodId: string) => {
        const allFarmers = dataService.getFarmers();
        let farmerForLog: Farmer | undefined;
        const updatedFarmers = allFarmers.map(f => {
            const initialBroodCount = f.broods.length;
            const newBroods = f.broods.filter(b => b && b.id !== broodId);
            if(newBroods.length < initialBroodCount) {
                farmerForLog = f;
            }
            return {...f, broods: newBroods};
        });

        if(farmerForLog) {
            dataService.saveFarmers(updatedFarmers);
            dataService.logAction('updated', 'farmer', farmerForLog);
            showToast('دوره با موفقیت حذف شد');
            fetchData();
        }
    };
    
    const handleInvoiceUpdate = () => {
        fetchData();
    };

    // Filter based on ViewMode and Search
    const filteredBroods = useMemo(() => {
        const byStatus = allBroods.filter(({ brood }) => {
            if (viewMode === 'active') return !brood.endDate;
            return !!brood.endDate;
        });

        if (!searchTerm) return byStatus;
        return byStatus.filter(({ farmer }) => farmer.name.includes(searchTerm));
    }, [allBroods, viewMode, searchTerm]);

    // Statistics
    const stats = useMemo(() => {
        const activeList = allBroods.filter(b => !b.brood.endDate);
        const count = activeList.length;
        const totalChicks = activeList.reduce((sum, item) => sum + item.brood.chickCount, 0);
        return { count, totalChicks };
    }, [allBroods]);

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-700">مدیریت دوره‌های جوجه‌ریزی</h1>
            
            {/* Header Stats - Only relevant for active broods */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard 
                    title="تعداد دوره‌های جاری" 
                    value={stats.count} 
                    unit="مورد" 
                    color="border-blue-500"
                    icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                />
                <StatCard 
                    title="مجموع جوجه‌ریزی فعال" 
                    value={stats.totalChicks.toLocaleString()} 
                    unit="قطعه" 
                    color="border-green-500"
                    icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                />
                 <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-center">
                    <label className="text-xs text-slate-500 mb-1">جستجوی مرغدار</label>
                    <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="نام مرغدار را وارد کنید..."
                        className="w-full p-2 border rounded-lg text-sm bg-slate-50 focus:bg-white transition-colors"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-300 mb-4">
                <button 
                    onClick={() => setViewMode('active')}
                    className={`px-6 py-2 font-bold text-sm transition-colors ${viewMode === 'active' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    دوره‌های جاری (فعال)
                </button>
                <button 
                    onClick={() => setViewMode('archived')}
                    className={`px-6 py-2 font-bold text-sm transition-colors ${viewMode === 'archived' ? 'text-slate-600 border-b-2 border-slate-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    بایگانی شده (خاتمه یافته)
                </button>
            </div>

            {/* Grid of Cards */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {filteredBroods.length === 0 ? (
                    <div className="col-span-full bg-white p-10 rounded-xl shadow-md text-center">
                        <p className="text-slate-500">
                            {searchTerm 
                                ? 'موردی با این مشخصات یافت نشد.' 
                                : (viewMode === 'active' ? 'هیچ دوره فعالی وجود ندارد.' : 'هیچ دوره بایگانی شده‌ای وجود ندارد.')
                            }
                        </p>
                    </div>
                ) : (
                    filteredBroods.map(({ farmer, brood }) => (
                        <BroodDetailsCard 
                            key={brood.id}
                            farmer={farmer}
                            brood={brood}
                            allExits={allExits}
                            onUpdate={handleBroodUpdate}
                            onDelete={handleBroodDelete}
                            onInvoiceUpdate={handleInvoiceUpdate}
                            showFarmerName={true}
                            isArchived={viewMode === 'archived'}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default ActiveBroodsPage;
