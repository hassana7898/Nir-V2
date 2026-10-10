
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Farmer, Brood, Exit } from '../types';
import * as dataService from '../services/dataService';
import BroodDetailsCard from '../components/BroodDetailsCard';
import { showToast } from '../utils/helpers';
import { toPersianNumerals, formatDate } from '../utils/formatters';
import { isBroodDeleted } from '../shared/broodMerge';
import { confirmTypedDelete } from '../utils/confirmDelete';

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
    const [viewMode, setViewMode] = useState<'active' | 'archived' | 'deleted'>('active');

    /** The farmer that owns a period id (the API is farmer-scoped, so we must know the owner). */
    const findOwningFarmerId = (broodId: string, deletedOnly = false): string | undefined => {
        for (const farmer of dataService.getFarmers()) {
            const match = (farmer.broods || []).find(b => b && b.id === broodId && (!deletedOnly || isBroodDeleted(b)));
            if (match) return farmer.id;
        }
        return undefined;
    };

    const fetchData = useCallback(() => {
        const farmers = dataService.getFarmers();
        const exits = dataService.getAllInvoices().filter(i => 'farmerId' in i) as Exit[];
        setAllExits(exits);

        const loadedBroods: { farmer: Farmer, brood: Brood }[] = [];
        farmers.forEach(farmer => {
            if (farmer.isDeleted) return;
            // Soft-deleted periods are collected too (the recycle bin needs them) but every ACTIVE
            // view filters them out below.
            (farmer.broods || []).forEach(brood => {
                if (!brood) return;
                loadedBroods.push({ farmer, brood });
            });
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

    const handleBroodUpdate = async (updatedBrood: Brood) => {
        const allFarmers = dataService.getFarmers();
        let farmerForLog: Farmer | undefined;
    
        const updatedFarmers = allFarmers.map(farmer => {
            // Only the FIRST farmer owning this id is updated: brood ids could collide between farmers
            // (the old `brood_${Date.now()}` scheme), and the previous version overwrote the period of
            // every farmer that happened to share the id.
            if (farmerForLog) return farmer;
            const broodIndex = (farmer.broods || []).findIndex(b => b && b.id === updatedBrood.id);
            if (broodIndex > -1) {
                const newBroods = [...(farmer.broods || [])];
                newBroods[broodIndex] = updatedBrood;
                farmerForLog = farmer; 
                return { ...farmer, broods: newBroods };
            }
            return farmer;
        });
    
        if (!farmerForLog) {
             showToast('خطا در به‌روزرسانی دوره.', 'error');
             return false;
        }

        // AWAITED on purpose: the previous fire-and-forget call wrote to the local cache only, so a
        // change (e.g. archiving a brood) silently reverted on the next hydration.
        const persisted = await dataService.saveFarmers(updatedFarmers);
        await dataService.logAction('updated', 'farmer', farmerForLog as Farmer);
        fetchData();
        if (!persisted) {
            showToast('ذخیره دوره ناموفق بود؛ در صف همگام‌سازی قرار گرفت و پس از اتصال اعمال می‌شود.', 'warning');
        }
        return persisted;
    };

    const handleBroodDelete = async (broodId: string) => {
        // The period must be removed from the farmer that OWNS it: the previous implementation
        // filtered the brood id out of EVERY farmer, so a legacy id collision deleted the period of
        // the wrong farmer as well.
        const ownerId = findOwningFarmerId(broodId);
        if (!ownerId) {
            showToast('دوره مورد نظر یافت نشد.', 'error');
            return false;
        }
        const owner = dataService.getFarmers().find(f => f.id === ownerId);
        const brood = (owner?.broods || []).find(b => b && b.id === broodId);

        // STRICT typed confirmation (the delete button stays disabled until «تایید» is typed).
        const confirmed = await confirmTypedDelete({
            title: 'حذف دوره جوجه‌ریزی',
            html: `<div style="text-align:right;font-size:13px">
                <p>مرغدار: <strong>${owner?.name || ''}</strong></p>
                <p>دوره ${brood ? formatDate(brood.startDate) : ''} — ${toPersianNumerals(brood?.chickCount || 0)} قطعه</p>
                <p style="color:#475569;margin-top:8px">دوره فقط <strong>حذف نرم</strong> می‌شود و از «سلة بازیافت» قابل بازگردانی است.</p>
            </div>`,
            confirmButtonText: 'حذف دوره',
        });
        if (!confirmed) return false;

        try {
            await dataService.deleteBrood(ownerId, broodId);
            fetchData();
            showToast('دوره حذف شد (قابل بازیابی از سلة بازیافت).', 'info');
            return true;
        } catch (e: any) {
            showToast(e?.message || 'حذف دوره ناموفق بود.', 'error');
            return false;
        }
    };

    const handleBroodRestore = async (broodId: string) => {
        const ownerId = findOwningFarmerId(broodId, true);
        if (!ownerId) {
            showToast('مرغدار مربوط به این دوره یافت نشد.', 'error');
            return;
        }
        try {
            await dataService.restoreBrood(ownerId, broodId);
            fetchData();
            showToast('دوره بازیابی شد.', 'success');
        } catch (e: any) {
            showToast(e?.message || 'بازیابی دوره ناموفق بود.', 'error');
        }
    };
    
    const handleInvoiceUpdate = () => {
        fetchData();
    };

    // Filter based on ViewMode and Search.
    // Soft-deleted periods are ONLY visible in the recycle bin tab, never in the active/archived views.
    const filteredBroods = useMemo(() => {
        const byStatus = allBroods.filter(({ brood }) => {
            if (viewMode === 'deleted') return isBroodDeleted(brood);
            if (isBroodDeleted(brood)) return false;
            if (viewMode === 'active') return !brood.endDate;
            return !!brood.endDate;
        });

        const term = searchTerm.trim().toLowerCase();
        if (!term) return byStatus;
        // Trimmed + case-insensitive so « علی » (with spaces) also finds the farmer.
        return byStatus.filter(({ farmer }) => String(farmer.name || '').toLowerCase().includes(term));
    }, [allBroods, viewMode, searchTerm]);

    // Statistics (active periods only - deleted ones must not be counted anywhere)
    const stats = useMemo(() => {
        const activeList = allBroods.filter(({ brood }) => !brood.endDate && !isBroodDeleted(brood));
        const count = activeList.length;
        const totalChicks = activeList.reduce((sum, item) => sum + Number(item.brood.chickCount || 0), 0);
        return { count, totalChicks };
    }, [allBroods]);

    const deletedCount = useMemo(() => allBroods.filter(({ brood }) => isBroodDeleted(brood)).length, [allBroods]);

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
                <button
                    onClick={() => setViewMode('deleted')}
                    className={`px-6 py-2 font-bold text-sm transition-colors ${viewMode === 'deleted' ? 'text-red-600 border-b-2 border-red-500' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    سلة بازیافت {deletedCount > 0 && <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 mr-1">{toPersianNumerals(deletedCount)}</span>}
                </button>
            </div>

            {/* Grid of Cards */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {filteredBroods.length === 0 ? (
                    <div className="col-span-full bg-white p-10 rounded-xl shadow-md text-center">
                        <p className="text-slate-500">
                            {searchTerm 
                                ? 'موردی با این مشخصات یافت نشد.' 
                                : (viewMode === 'active'
                                    ? 'هیچ دوره فعالی وجود ندارد.'
                                    : viewMode === 'archived'
                                        ? 'هیچ دوره بایگانی شده‌ای وجود ندارد.'
                                        : 'سلة بازیافت خالی است.')
                            }
                        </p>
                    </div>
                ) : (
                    filteredBroods.map(({ farmer, brood }) => (
                        <BroodDetailsCard 
                            key={`${viewMode}-${farmer.id}-${brood.id}`}
                            farmer={farmer}
                            brood={brood}
                            allExits={allExits}
                            onUpdate={handleBroodUpdate}
                            onDelete={handleBroodDelete}
                            onRestore={handleBroodRestore}
                            onInvoiceUpdate={handleInvoiceUpdate}
                            showFarmerName={true}
                            isArchived={viewMode === 'archived'}
                            isDeletedBrood={viewMode === 'deleted'}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default ActiveBroodsPage;
