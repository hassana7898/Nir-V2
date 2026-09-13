
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DatePicker from '../components/DatePicker';
import { Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatToISODate, formatDateWithWeekday, formatCurrency } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import { handlePrint, calculatePrintPages } from '../utils/print';
import Modal from '../components/Modal';
import Swal from 'sweetalert2';
import Sortable from 'sortablejs';
import DataImportModal from '../components/DataImportModal';
import ImageImportModal from '../components/ImageImportModal';

type SortableKeys = keyof Exit | 'farmerId' | 'productId';
type SortConfigItem = { key: SortableKeys; direction: 'asc' | 'desc' };

const ExitPage: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(() => {
        const saved = sessionStorage.getItem('targetDate');
        if (saved) {
            sessionStorage.removeItem('targetDate');
            const [y, m, d] = saved.split('-').map(Number);
            return new Date(y, m - 1, d, 12, 0, 0);
        }
        return new Date();
    });
    const [exits, setExits] = useState<Exit[]>([]);
    const [farmers, setFarmers] = useState<Farmer[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [pageBreakMode, setPageBreakMode] = useState(false);
    const [editMode, setEditMode] = useState<{ active: boolean, id: string | null }>({ active: false, id: null });
    const [driverNames, setDriverNames] = useState<string[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkMoveModalOpen, setIsBulkMoveModalOpen] = useState(false);
    const [bulkMoveTargetDate, setBulkMoveTargetDate] = useState(new Date());
    const [sortConfig, setSortConfig] = useState<SortConfigItem[]>([]);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isImageImportModalOpen, setIsImageImportModalOpen] = useState(false);
    const [printDescription, setPrintDescription] = useState('');
    const [customPrintTitle, setCustomPrintTitle] = useState('');
    const [showPageTotals, setShowPageTotals] = useState(false);
    const [showGrandTotal, setShowGrandTotal] = useState(true);
    const [pageSettings, setPageSettings] = useState<{title: string, description: string}[]>([]);
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

    const { settings, productMap } = useSettings();
    const tableBodyRef = useRef<HTMLTableSectionElement>(null);
    const sortableInstance = useRef<any | null>(null);
    const firstInputRef = useRef<HTMLSelectElement>(null);

    const productOrderMap = useMemo(() => {
        const map = new Map<string, number>();
        settings.products.forEach((p, idx) => map.set(p.id, idx));
        return map;
    }, [settings.products]);

    const initialFormState = { 
        farmerId: '', productId: settings.products.find(p => p.type === 'finishedGood')?.id || settings.products[0]?.id || '', 
        weight: 0, driverName: '', invoiceNumber: '', productVariant: '', isCrumble: false
    };

    const [formData, setFormData] = useState(initialFormState);

    const fetchExits = useCallback(() => {
        const data = dataService.getInvoicesByDate<Exit>('exit', currentDate);
        setExits(data);
        setFarmers(dataService.getFarmers());
        setDriverNames(dataService.getDrivers());
        setHasUnsavedChanges(false);
        setSelectedIds(new Set());
        setPageBreakMode(false);
        setSortConfig([]);
    }, [currentDate]);

    useEffect(() => { fetchExits(); }, [fetchExits]);
    
    useEffect(() => {
        const timerId = setTimeout(() => { setDebouncedSearchTerm(searchTerm); }, 300);
        return () => { clearTimeout(timerId); };
    }, [searchTerm]);

    const handleSort = (key: SortableKeys, event: React.MouseEvent) => {
        setSortConfig(prev => {
            const existingIndex = prev.findIndex(s => s.key === key);
            let newConfig = [...prev];

            if (event.shiftKey) {
                if (existingIndex > -1) {
                    if (prev[existingIndex].direction === 'asc') {
                        newConfig[existingIndex].direction = 'desc';
                    } else {
                        newConfig.splice(existingIndex, 1);
                    }
                } else {
                    newConfig.push({ key, direction: 'asc' });
                }
            } else {
                if (existingIndex > -1 && prev.length === 1) {
                    if (prev[0].direction === 'asc') {
                        newConfig = [{ key, direction: 'desc' }];
                    } else {
                        newConfig = [];
                    }
                } else {
                    newConfig = [{ key, direction: 'asc' }];
                }
            }
            return newConfig;
        });
    };

    const filteredExits = useMemo(() => {
        let result = [...exits];
        const query = debouncedSearchTerm.toLowerCase().trim();
        const fMap = new Map<string, string>(farmers.map(f => [f.id, f.name]));

        if (query) {
            result = result.filter(e => 
                (fMap.get(e.farmerId) || '').toLowerCase().includes(query) || 
                (productMap.get(e.productId) || '').toLowerCase().includes(query) || 
                (e.driverName || '').toLowerCase().includes(query) ||
                (e.invoiceNumber || '').toLowerCase().includes(query) ||
                (e.productVariant && e.productVariant.toLowerCase().includes(query))
            );
        }

        if (sortConfig.length > 0) {
            result.sort((a, b) => {
                for (const sort of sortConfig) {
                    let aVal: any, bVal: any;
                    
                    if (sort.key === 'farmerId') {
                        aVal = fMap.get(a.farmerId) || '';
                        bVal = fMap.get(b.farmerId) || '';
                    } else if (sort.key === 'productId') {
                        aVal = productOrderMap.get(a.productId) ?? 999;
                        bVal = productOrderMap.get(b.productId) ?? 999;
                    } else {
                        aVal = (a as any)[sort.key];
                        bVal = (b as any)[sort.key];
                    }

                    if (aVal === undefined || aVal === null) aVal = '';
                    if (bVal === undefined || bVal === null) bVal = '';

                    if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
                    if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
                }
                
                if (sortConfig[0]?.key !== 'farmerId') {
                    const aName = fMap.get(a.farmerId) || '';
                    const bName = fMap.get(b.farmerId) || '';
                    if (aName < bName) return -1;
                    if (aName > bName) return 1;
                }
                return a.createdAt - b.createdAt;
            });
        }
        return result;
    }, [exits, debouncedSearchTerm, farmers, productMap, sortConfig, productOrderMap]);

    const totalWeight = useMemo(() => {
        return filteredExits.reduce((sum, item) => sum + (item.weight || 0), 0);
    }, [filteredExits]);

    useEffect(() => {
        if (tableBodyRef.current) {
            if (sortableInstance.current) sortableInstance.current.destroy();
            const isDnDDisabled = pageBreakMode || !!debouncedSearchTerm.trim();

            sortableInstance.current = Sortable.create(tableBodyRef.current, {
                animation: 150,
                handle: '.cursor-move',
                disabled: isDnDDisabled,
                onEnd: (evt: any) => {
                    const { oldIndex, newIndex } = evt;
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    
                    const newOrdered = [...filteredExits];
                    const [movedItem] = newOrdered.splice(oldIndex, 1);
                    newOrdered.splice(newIndex, 0, movedItem);
                    
                    setExits(newOrdered);
                    setSortConfig([]); 
                    setHasUnsavedChanges(true);
                    if (sortConfig.length > 0) {
                        showToast('ترتیب دستی اعمال شد (مرتب‌سازی خودکار غیرفعال شد).', 'info');
                    }
                },
            });
        }
    }, [filteredExits, debouncedSearchTerm, pageBreakMode, sortConfig]);

    const handleSaveOrder = async () => {
        if (!!searchTerm) {
            showToast('در حالت جستجو امکان ذخیره ترتیب وجود ندارد.', 'warning');
            return;
        }
        const currentOrder = [...filteredExits];
        const currentOrderIds = currentOrder.map(e => e.id);

        await dataService.saveOrderForDate('exit', currentDate, currentOrderIds);
        
        setExits(currentOrder);
        setSortConfig([]); 
        setHasUnsavedChanges(false);
        showToast('چیدمان نهایی ذخیره شد.');
    };

    const handleTogglePageBreak = async (id: string) => {
        const exit = exits.find(e => e.id === id);
        if (exit) {
            const newValue = !exit.isPageBreak;
            await dataService.updateInvoice(id, { isPageBreak: newValue });
            setExits(prev => prev.map(e => e.id === id ? { ...e, isPageBreak: newValue } : e));
        }
    };

    const handleBulkMove = async () => {
        const count = await dataService.bulkMoveInvoicesByIds('exit', Array.from(selectedIds), bulkMoveTargetDate);
        showToast(`${toPersianNumerals(count)} حواله منتقل شد.`);
        setIsBulkMoveModalOpen(false);
        fetchExits();
    };

    const handleSingleMove = (id: string) => {
        setSelectedIds(new Set([id]));
        setBulkMoveTargetDate(currentDate);
        setIsBulkMoveModalOpen(true);
    };

    const handleSave = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        try {
            if (editMode.active && editMode.id) {
                await dataService.updateInvoice(editMode.id, formData);
                showToast('ویرایش شد.');
                setEditMode({ active: false, id: null });
                setIsFormVisible(false);
            } else {
                await dataService.addInvoice({ ...formData, date: formatToISODate(currentDate) } as any, 'exit');
                showToast('ثبت شد.');
                setFormData({ ...initialFormState, productId: formData.productId });
                setTimeout(() => firstInputRef.current?.focus(), 100);
            }
            fetchExits();
        } catch (e) { showToast('خطا در ذخیره', 'error'); }
    };

    const handleQuickAddFarmer = () => {
        Swal.fire({
            title: 'افزودن مرغدار جدید',
            input: 'text',
            inputPlaceholder: 'نام مرغدار را وارد کنید',
            showCancelButton: true,
            confirmButtonText: 'ثبت',
            cancelButtonText: 'انصراف',
            preConfirm: (name: string) => {
                if (!name.trim()) {
                    Swal.showValidationMessage('نام مرغدار نمی‌تواند خالی باشد');
                }
                return name.trim();
            }
        }).then((result: any) => {
            if (result.isConfirmed && result.value) {
                const newFarmer: Farmer = {
                    id: `farmer_${Date.now()}`,
                    name: result.value,
                    broods: []
                };
                const updatedFarmers = [...farmers, newFarmer];
                dataService.saveFarmers(updatedFarmers);
                
                setFarmers(updatedFarmers);
                setFormData(prev => ({ ...prev, farmerId: newFarmer.id }));
                
                dataService.logAction('created', 'farmer', newFarmer);
                showToast('مرغدار جدید اضافه و انتخاب شد.');
            }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const form = (e.target as HTMLElement).closest('form');
            if (!form) return;
            const inputs = Array.from(form.querySelectorAll('input, select, button[type="submit"]')) as HTMLElement[];
            const currentIndex = inputs.indexOf(e.target as HTMLElement);
            if (currentIndex > -1 && currentIndex < inputs.length - 1) {
                inputs[currentIndex + 1].focus();
            } else if (currentIndex === inputs.length - 1) {
                handleSave();
            }
        }
    };

    const toggleSelection = (id: string) => {
        const n = new Set(selectedIds);
        if (n.has(id)) n.delete(id); else n.add(id);
        setSelectedIds(n);
    };

    const startEditing = (e: Exit) => {
        setFormData({ 
            farmerId: e.farmerId || '', 
            productId: e.productId || '', 
            weight: e.weight || 0, 
            driverName: e.driverName || '', 
            invoiceNumber: e.invoiceNumber || '',
            productVariant: e.productVariant || '',
            isCrumble: e.isCrumble || false
        });
        setEditMode({ active: true, id: e.id });
        setIsFormVisible(true);
        setTimeout(() => firstInputRef.current?.focus(), 100);
    };

    const SortIcon = ({ colKey }: { colKey: SortableKeys }) => {
        const index = sortConfig.findIndex(s => s.key === colKey);
        if (index === -1) return <span className="text-slate-300 opacity-30 group-hover:opacity-100 transition-opacity mr-1">↕</span>;
        
        const config = sortConfig[index];
        return (
            <span className="text-sky-600 font-bold mr-1 inline-flex items-center text-xs">
                {config.direction === 'asc' ? '↑' : '↓'}
                {sortConfig.length > 1 && <span className="mr-0.5 text-[10px] bg-sky-100 text-sky-700 rounded-full w-4 h-4 flex items-center justify-center">{toPersianNumerals(index + 1)}</span>}
            </span>
        );
    };

    return (
        <div className="space-y-4">
            <datalist id="driver-list">{driverNames.map(n => <option key={n} value={n} />)}</datalist>
            <Modal isOpen={isBulkMoveModalOpen} onClose={() => setIsBulkMoveModalOpen(false)} title="انتقال حواله به تاریخ دیگر" footer={<><button onClick={() => setIsBulkMoveModalOpen(false)} className="px-4 py-2 text-slate-600">لغو</button><button onClick={handleBulkMove} className="bg-orange-500 text-white px-4 py-2 rounded-lg">تایید و انتقال</button></>}>
                <div className="space-y-4">
                    <p className="text-sm">تاریخ مقصد برای جابجایی {toPersianNumerals(selectedIds.size)} حواله خروج:</p>
                    <DatePicker id="bulk-move-exit-date" value={bulkMoveTargetDate} onChange={setBulkMoveTargetDate} />
                </div>
            </Modal>
            
            <DataImportModal 
                isOpen={isImportModalOpen} 
                onClose={() => setIsImportModalOpen(false)} 
                type="exit" 
                onSuccess={fetchExits} 
                initialDate={currentDate}
            />

            <ImageImportModal 
                isOpen={isImageImportModalOpen} 
                onClose={() => setIsImageImportModalOpen(false)} 
                onSuccess={fetchExits} 
                type="exit"
                initialDate={currentDate}
            />

            <div className="bg-white p-5 rounded-xl shadow-md">
                <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
                    <h1 className="text-2xl font-bold text-slate-700">مدیریت حواله‌های خروج</h1>
                    <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
                        <input type="text" placeholder="جستجو..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="p-2 border rounded-lg w-32" />
                        <div className="flex items-center gap-2 bg-slate-100 p-1 px-2 rounded-lg border border-slate-200">
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز بعد" type="button">{'<'}</button>
                             <DatePicker id="exit-date-picker" value={currentDate} onChange={setCurrentDate} className="w-32" />
                             <span className="text-sm font-bold text-sky-700 whitespace-nowrap min-w-[120px] text-center">{formatDateWithWeekday(currentDate)}</span>
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز قبل" type="button">{'>'}</button>
                        </div>
                        <button onClick={() => { setFormData({ ...initialFormState, productId: settings.products.find(p => p.type === 'finishedGood')?.id || '' }); setEditMode({ active: false, id: null }); setIsFormVisible(!isFormVisible); if(!isFormVisible) setTimeout(() => firstInputRef.current?.focus(), 100); }} className="bg-sky-500 text-white px-4 py-2 rounded-lg">افزودن</button>
                        <button onClick={() => setIsImageImportModalOpen(true)} className="bg-pink-600 text-white px-4 py-2 rounded-lg" title="وارد کردن از تصویر (AI)">پردازش تصویر هوش مصنوعی</button>
                        {selectedIds.size > 0 && (
                            <>
                                <button onClick={() => { setBulkMoveTargetDate(currentDate); setIsBulkMoveModalOpen(true); }} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm shadow-md animate-pulse">انتقال ({toPersianNumerals(selectedIds.size)})</button>
                                <button onClick={() => {
                                    Swal.fire({ title: `حذف ${toPersianNumerals(selectedIds.size)} حواله؟`, text: 'آیا مطمئن هستید؟ این عملیات غیرقابل بازگشت است.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' }).then(async (r:any) => {
                                        if (r.isConfirmed) {
                                            for(let id of Array.from(selectedIds)) { await dataService.deleteInvoice(id); }
                                            setSelectedIds(new Set());
                                            fetchExits();
                                            showToast('حواله‌های انتخاب شده حذف شدند.');
                                        }
                                    });
                                }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm shadow-md">حذف ({toPersianNumerals(selectedIds.size)})</button>
                            </>
                        )}
                        <button 
                            disabled={!!searchTerm}
                            onClick={handleSaveOrder} 
                            className={`px-4 py-2 rounded-lg text-sm transition-all ${hasUnsavedChanges && !searchTerm ? 'bg-orange-500 text-white scale-105 shadow-lg' : 'bg-slate-200 text-slate-500'}`}
                        >
                            ذخیره ترتیب
                        </button>
                        {sortConfig.length > 0 && (
                            <button onClick={() => setSortConfig([])} className="px-4 py-2 rounded-lg text-sm bg-red-100 text-red-600 hover:bg-red-200">
                                لغو مرتب‌سازی
                            </button>
                        )}
                        <button onClick={() => setPageBreakMode(!pageBreakMode)} className={`px-4 py-2 rounded-lg text-sm ${pageBreakMode ? 'bg-red-500 text-white' : 'bg-slate-200'}`}>تعیین صفحه</button>
                        <button onClick={() => setIsPrintModalOpen(true)} className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm">چاپ</button>
                    </div>
                </div>
            </div>

            {isPrintModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">تنظیمات چاپ</h2>
                        <div className="mb-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                            {calculatePrintPages(filteredExits).map((_, index) => (
                                <div key={index} className="border p-3 rounded-lg bg-slate-50 mb-3 space-y-3">
                                    <h3 className="font-bold text-slate-800 border-b pb-1">صفحه {index + 1}</h3>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">تیتر اختصاصی صفحه (اختیاری)</label>
                                        <input
                                            type="text"
                                            value={pageSettings[index]?.title || ''}
                                            onChange={e => {
                                                const newSettings = [...pageSettings];
                                                if (!newSettings[index]) newSettings[index] = { title: '', description: '' };
                                                newSettings[index].title = e.target.value;
                                                setPageSettings(newSettings);
                                            }}
                                            className="w-full p-2 border rounded-lg text-sm"
                                            placeholder="تیتر پیش‌فرض جایگزین می‌شود..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات اختصاصی صفحه (اختیاری)</label>
                                        <textarea
                                            value={pageSettings[index]?.description || ''}
                                            onChange={e => {
                                                const newSettings = [...pageSettings];
                                                if (!newSettings[index]) newSettings[index] = { title: '', description: '' };
                                                newSettings[index].description = e.target.value;
                                                setPageSettings(newSettings);
                                            }}
                                            className="w-full p-2 border rounded-lg resize-y min-h-[60px] text-sm"
                                            placeholder="توضیحاتی که در انتهای این صفحه چاپ می‌شود..."
                                        ></textarea>
                                    </div>
                                </div>
                            ))}
                            <div className="border-t pt-4 mt-2">
                                <h3 className="font-bold text-slate-800 mb-3">تنظیمات کلی:</h3>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات انتهای کل گزارش (اختیاری)</label>
                                    <textarea
                                        value={printDescription}
                                        onChange={e => setPrintDescription(e.target.value)}
                                        className="w-full p-2 border rounded-lg resize-y min-h-[60px] text-sm mb-3"
                                        placeholder="توضیحات کلی که در آخرین صفحه چاپ می‌شود..."
                                    ></textarea>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="checkbox" 
                                    id="showPageTotals" 
                                    checked={showPageTotals} 
                                    onChange={e => setShowPageTotals(e.target.checked)} 
                                    className="w-4 h-4 text-emerald-500 rounded border-gray-300 focus:ring-emerald-500"
                                />
                                <label htmlFor="showPageTotals" className="text-sm font-bold text-slate-700">نمایش جمع هر صفحه</label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="checkbox" 
                                    id="showGrandTotal" 
                                    checked={showGrandTotal} 
                                    onChange={e => setShowGrandTotal(e.target.checked)} 
                                    className="w-4 h-4 text-emerald-500 rounded border-gray-300 focus:ring-emerald-500"
                                />
                                <label htmlFor="showGrandTotal" className="text-sm font-bold text-slate-700">نمایش جمع کل در انتهای صفحات</label>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t">
                            <button onClick={() => setIsPrintModalOpen(false)} className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold">انصراف</button>
                            <button onClick={() => {
                                setIsPrintModalOpen(false);
                                handlePrint('exit', filteredExits, { printDate: currentDate, generalDescription: printDescription, customPrintTitle, pageSettings, showPageTotals, showGrandTotal });
                            }} className="px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg font-bold">تایید و چاپ</button>
                        </div>
                    </div>
                </div>
            )}

            {isFormVisible && (
                <form className="bg-white p-5 rounded-xl shadow-md space-y-4" onSubmit={handleSave}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-end gap-2">
                            <div className="flex-grow">
                                <label className="block text-xs font-bold text-slate-500 mb-1">مرغدار</label>
                                <select ref={firstInputRef} onKeyDown={handleKeyDown} value={formData.farmerId} onChange={e => setFormData({...formData, farmerId: e.target.value})} className="w-full p-2 border rounded-lg h-[42px]">
                                    <option value="">انتخاب کنید...</option>
                                    {farmers.filter(f => !f.isDeleted).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            </div>
                            <button type="button" onClick={handleQuickAddFarmer} className="bg-green-500 text-white p-2 rounded-lg h-[42px] w-[42px] flex items-center justify-center font-bold text-xl" title="افزودن مرغدار جدید">+</button>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">نوع محصول</label>
                            <select onKeyDown={handleKeyDown} value={formData.productId} onChange={e => setFormData({...formData, productId: e.target.value})} className="w-full p-2 border rounded-lg h-[42px]">
                                <optgroup label="ماده اولیه">
                                    {settings.products.filter(p => !p.isDeleted && p.type === 'rawMaterial').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </optgroup>
                                <optgroup label="محصول نهایی">
                                    {settings.products.filter(p => !p.isDeleted && p.type === 'finishedGood').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </optgroup>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">وزن (کیلوگرم)</label>
                            <input onKeyDown={handleKeyDown} type="number" placeholder="وزن" value={formData.weight || ''} onChange={e => setFormData({...formData, weight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" required />
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">راننده</label>
                            <input list="driver-list" onKeyDown={handleKeyDown} placeholder="نام راننده" value={formData.driverName} onChange={e => setFormData({...formData, driverName: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">شماره حواله</label>
                            <input onKeyDown={handleKeyDown} placeholder="شماره حواله" value={formData.invoiceNumber} onChange={e => setFormData({...formData, invoiceNumber: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">توضیحات / نوع (اختیاری)</label>
                            <div className="flex items-center gap-2">
                                <input onKeyDown={handleKeyDown} placeholder="مثلا: دان پلت، مش و..." value={formData.productVariant} onChange={e => setFormData({...formData, productVariant: e.target.value})} className="flex-grow p-2 border rounded-lg h-[42px]" />
                                <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap bg-slate-50 p-2 rounded-lg border h-[42px] hover:bg-slate-100 transition-colors">
                                    <input type="checkbox" checked={formData.isCrumble || false} onChange={e => setFormData({...formData, isCrumble: e.target.checked})} className="w-4 h-4 text-sky-600 rounded cursor-pointer" />
                                    <span className="text-sm font-bold text-slate-700">کرامبل</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="submit" className="bg-green-500 text-white px-8 py-2 rounded-lg font-bold">ذخیره (Enter)</button>
                        <button type="button" onClick={() => setIsFormVisible(false)} className="bg-gray-400 text-white px-8 py-2 rounded-lg">انصراف</button>
                    </div>
                </form>
            )}

            <div className="bg-white p-5 rounded-xl shadow-md overflow-x-auto">
                <div className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    برای مرتب‌سازی چند سطحی، کلید Shift را نگه دارید و روی سرستون‌ها کلیک کنید.
                </div>
                <table className="w-full text-sm text-center border-collapse border border-slate-800">
                    <thead className="bg-slate-100 font-bold text-slate-800">
                        <tr>
                            <th className="p-2 border border-slate-400 no-print w-10">
                                {!pageBreakMode && (
                                    <input 
                                        type="checkbox" 
                                        checked={filteredExits.length > 0 && selectedIds.size === filteredExits.length} 
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedIds(new Set(filteredExits.map(e => e.id)));
                                            else setSelectedIds(new Set());
                                        }} 
                                    />
                                )}
                            </th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('createdAt', e)}>ردیف <SortIcon colKey="createdAt"/></th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('farmerId', e)}>نام مرغدار <SortIcon colKey="farmerId"/></th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('productId', e)}>نوع محصول <SortIcon colKey="productId"/></th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('weight', e)}>وزن <SortIcon colKey="weight"/></th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('driverName', e)}>نام راننده <SortIcon colKey="driverName"/></th>
                            <th className="p-2 border border-slate-400 cursor-pointer group select-none" onClick={(e) => handleSort('invoiceNumber', e)}>شماره حواله <SortIcon colKey="invoiceNumber"/></th>
                            <th className="p-2 border border-slate-400 no-print">عملیات</th>
                        </tr>
                    </thead>
                    <tbody ref={tableBodyRef} className={pageBreakMode ? 'page-break-selector' : ''}>
                        {filteredExits.map((e, idx) => {
                            const farmerName = farmers.find(f => f.id === e.farmerId)?.name || 'ناشناس';
                            return (
                                <tr key={e.id} data-id={e.id} onClick={() => pageBreakMode && handleTogglePageBreak(e.id)} className={`hover:bg-slate-50 transition-all ${e.isPageBreak ? 'page-break-indicator' : ''}`}>
                                    <td className="p-2 border border-slate-400 no-print">
                                        {!pageBreakMode && <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelection(e.id)} onClick={ev => ev.stopPropagation()} />}
                                    </td>
                                    <td className={`p-2 border border-slate-400 font-bold text-lg ${(!pageBreakMode && !searchTerm && sortConfig.length === 0) ? 'cursor-move' : ''}`}>{toPersianNumerals(idx + 1)}</td>
                                    <td className="p-2 border border-slate-400 font-bold text-lg text-slate-900">{farmerName}</td>
                                    <td className="p-2 border border-slate-400 font-bold text-lg text-slate-900">
                                        {productMap.get(e.productId)}
                                        {e.productVariant && <span className="text-xs font-normal text-slate-500 mr-1">({e.productVariant})</span>}
                                        {e.isCrumble && <span className="text-xs font-normal text-slate-500 mr-1">(کرامبل)</span>}
                                    </td>
                                    <td className="p-2 border border-slate-400 font-bold text-lg text-slate-900">{toPersianNumerals(Number(e.weight || 0).toLocaleString())}</td>
                                    <td className="p-2 border border-slate-400 font-bold text-lg text-slate-900">{e.driverName || '-'}</td>
                                    <td className="p-2 border border-slate-400 font-bold text-lg text-slate-900">{toPersianNumerals(e.invoiceNumber)}</td>
                                    <td className="p-2 border border-slate-400 no-print">
                                        <div className="flex gap-2 justify-center">
                                            <button onClick={(ev) => { ev.stopPropagation(); startEditing(e); }} className="text-blue-600 hover:font-bold">ویرایش</button>
                                            <button onClick={(ev) => { ev.stopPropagation(); handleSingleMove(e.id); }} className="text-orange-600 hover:font-bold">انتقال</button>
                                            <button onClick={(ev) => { ev.stopPropagation(); Swal.fire({ title: 'حذف حواله؟', icon: 'warning', showCancelButton: true }).then(async (r:any) => { if (r.isConfirmed) { await dataService.deleteInvoice(e.id); fetchExits(); } }); }} className="text-red-500 hover:font-bold">حذف</button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-600">
                        <tr>
                            <td className="border border-slate-400 no-print"></td>
                            <td className="border border-slate-400"></td>
                            <td className="p-2 border border-slate-400 text-left pl-4 text-lg" colSpan={2}>
                                مجموع خروج روزانه:
                            </td>
                            <td className="p-2 border border-slate-400 text-lg">
                                {toPersianNumerals(totalWeight.toLocaleString())}
                            </td>
                            <td className="p-2 border border-slate-400">-</td>
                            <td className="p-2 border border-slate-400 text-lg">کیلوگرم</td>
                            <td className="border border-slate-400 no-print"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default ExitPage;
