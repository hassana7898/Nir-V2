
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DatePicker from '../components/DatePicker';
import { Entry, Product } from '../types';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatWastage, formatToISODate, formatDateWithWeekday, formatCurrency, formatIBANForDisplay } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import { handlePrint, calculatePrintPages } from '../utils/print';
import Modal from '../components/Modal';
import Swal from 'sweetalert2';
import Sortable from 'sortablejs';
import DataImportModal from '../components/DataImportModal';
import ImageImportModal from '../components/ImageImportModal';

type SortableKeys = keyof Entry | 'productId';
type SortConfigItem = { key: SortableKeys; direction: 'asc' | 'desc' };

const EntryPage: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(() => {
        const saved = sessionStorage.getItem('targetDate');
        if (saved) {
            sessionStorage.removeItem('targetDate');
            const [y, m, d] = saved.split('-').map(Number);
            return new Date(y, m - 1, d, 12, 0, 0);
        }
        return new Date();
    });
    const [entries, setEntries] = useState<Entry[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [pageBreakMode, setPageBreakMode] = useState(false);
    const [editMode, setEditMode] = useState<{ active: boolean, id: string | null }>({ active: false, id: null });
    const [driverNames, setDriverNames] = useState<string[]>([]);
    const [originNames, setOriginNames] = useState<string[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkMoveModalOpen, setIsBulkMoveModalOpen] = useState(false);
    const [bulkMoveTargetDate, setBulkMoveTargetDate] = useState(new Date());
    const [sortConfig, setSortConfig] = useState<SortConfigItem[]>([]);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isImageImportModalOpen, setIsImageImportModalOpen] = useState(false);
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [printDescription, setPrintDescription] = useState('');
    const [customPrintTitle, setCustomPrintTitle] = useState('');
    const [showPageTotals, setShowPageTotals] = useState(false);
    const [showGrandTotal, setShowGrandTotal] = useState(true);
    const [pageSettings, setPageSettings] = useState<{title: string, description: string}[]>([]);

    const { settings, productMap } = useSettings();
    const tableBodyRef = useRef<HTMLTableSectionElement>(null);
    const sortableInstance = useRef<any | null>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);

    const productOrderMap = useMemo(() => {
        const map = new Map<string, number>();
        settings.products.forEach((p, index) => map.set(p.id, index));
        return map;
    }, [settings.products]);

    const initialFormState = { 
        sellerName: '', billNumber: '', origin: '', factory: '', driverName: '', 
        driverPhone: '', driverIBAN: '', productId: settings.products[0]?.id || '', 
        billWeight: 0, scaleWeight: 0, transportCost: 0
    };

    const [formData, setFormData] = useState(initialFormState);

    const ibanValidation = useMemo(() => {
        const raw = formData.driverIBAN || '';
        const clean = raw.replace(/[\s-]/g, '');
        const numericPart = clean.replace(/\D/g, '');
        
        if (clean.length === 0) return { isValid: true, message: null, length: 0 };

        if (clean.length < 16) {
            return { isValid: false, message: 'کوتاه (حداقل ۱۶)', length: clean.length };
        }
        
        if (numericPart.length > 24) {
            return { isValid: false, message: 'طولانی (حداکثر ۲۴ رقم)', length: clean.length };
        }

        return { isValid: true, message: null, length: clean.length };
    }, [formData.driverIBAN]);

    const fetchEntries = useCallback(() => {
        const data = dataService.getInvoicesByDate<Entry>('entry', currentDate);
        setEntries(data);
        setDriverNames(dataService.getDrivers());
        setOriginNames(dataService.getOrigins ? dataService.getOrigins() : []);
        setHasUnsavedChanges(false);
        setSelectedIds(new Set());
        setPageBreakMode(false);
        setSortConfig([]);
    }, [currentDate]);

    useEffect(() => { fetchEntries(); }, [fetchEntries]);
    
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

    const filteredEntries = useMemo(() => {
        let result = [...entries];
        const query = debouncedSearchTerm.toLowerCase().trim();
        
        if (query) {
            result = result.filter(e => 
                (productMap.get(e.productId) || '').toLowerCase().includes(query) || 
                (e.sellerName || '').toLowerCase().includes(query) || 
                (e.billNumber || '').toLowerCase().includes(query) ||
                (e.driverName || '').toLowerCase().includes(query)
            );
        }

        if (sortConfig.length > 0) {
            result.sort((a, b) => {
                for (const sort of sortConfig) {
                    let aVal: any, bVal: any;
                    
                    if (sort.key === 'productId') {
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
                return a.createdAt - b.createdAt;
            });
        }
        return result;
    }, [entries, debouncedSearchTerm, productMap, sortConfig, productOrderMap]);

    const totals = useMemo(() => {
        return filteredEntries.reduce((acc, item) => ({
            billWeight: acc.billWeight + (item.billWeight || 0),
            scaleWeight: acc.scaleWeight + (item.scaleWeight || 0),
            wastage: acc.wastage + (item.wastage || 0)
        }), { billWeight: 0, scaleWeight: 0, wastage: 0 });
    }, [filteredEntries]);

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
                    
                    const newOrdered = [...filteredEntries];
                    const [movedItem] = newOrdered.splice(oldIndex, 1);
                    newOrdered.splice(newIndex, 0, movedItem);
                    
                    setEntries(newOrdered);
                    setSortConfig([]); 
                    setHasUnsavedChanges(true);
                    if (sortConfig.length > 0) {
                        showToast('ترتیب دستی اعمال شد (مرتب‌سازی خودکار غیرفعال شد).', 'info');
                    }
                },
            });
        }
    }, [filteredEntries, debouncedSearchTerm, pageBreakMode, sortConfig]);

    const handleSaveOrder = async () => {
        if (!!searchTerm) {
            showToast('در حالت جستجو امکان ذخیره ترتیب وجود ندارد.', 'warning');
            return;
        }
        const currentOrder = [...filteredEntries];
        const currentOrderIds = currentOrder.map(e => e.id);
        
        await dataService.saveOrderForDate('entry', currentDate, currentOrderIds);
        
        setEntries(currentOrder);
        setSortConfig([]); 
        setHasUnsavedChanges(false);
        showToast('چیدمان نهایی ذخیره شد.');
    };

    const handleTogglePageBreak = async (id: string) => {
        const entry = entries.find(e => e.id === id);
        if (entry) {
            const newValue = !entry.isPageBreak;
            await dataService.updateInvoice(id, { isPageBreak: newValue });
            setEntries(prev => prev.map(e => e.id === id ? { ...e, isPageBreak: newValue } : e));
        }
    };

    const handleBulkMove = async () => {
        const count = await dataService.bulkMoveInvoicesByIds('entry', Array.from(selectedIds), bulkMoveTargetDate);
        showToast(`${toPersianNumerals(count)} حواله منتقل شد.`);
        setIsBulkMoveModalOpen(false);
        fetchEntries();
    };

    const handleSingleMove = (id: string) => {
        setSelectedIds(new Set([id]));
        setBulkMoveTargetDate(currentDate);
        setIsBulkMoveModalOpen(true);
    };

    const handleSave = async (e?: React.FormEvent, keepSellerInfo: boolean = false) => {
        if (e) e.preventDefault();

        if (formData.driverIBAN && !ibanValidation.isValid) {
            showToast(ibanValidation.message || 'شماره شبا/کارت نامعتبر است', 'error');
            return;
        }

        try {
            if (editMode.active && editMode.id) {
                await dataService.updateInvoice(editMode.id, formData);
                showToast('ویرایش شد.');
                setEditMode({ active: false, id: null });
                setIsFormVisible(false);
            } else {
                await dataService.addInvoice({ ...formData, date: formatToISODate(currentDate) } as any, 'entry');
                showToast('ثبت شد.');
                if (keepSellerInfo) {
                    setFormData({
                        ...formData,
                        productId: settings.products[0]?.id || '',
                        billWeight: 0,
                        scaleWeight: 0,
                        wastage: 0
                    });
                } else {
                    if (keepSellerInfo) {
                    setFormData({
                        ...formData,
                        productId: settings.products[0]?.id || '',
                        billWeight: 0,
                        scaleWeight: 0,
                        wastage: 0
                    });
                } else {
                    setFormData({ ...initialFormState, productId: formData.productId });
                }
                }
                setTimeout(() => firstInputRef.current?.focus(), 100);
            }
            fetchEntries();
        } catch (e) { showToast('خطا در ذخیره', 'error'); }
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

    const startEditing = (e: Entry) => {
        setFormData({
            sellerName: e.sellerName || '', billNumber: e.billNumber || '', origin: e.origin || '', factory: e.factory || '', 
            driverName: e.driverName || '', driverPhone: e.driverPhone || '', driverIBAN: e.driverIBAN || '', 
            productId: e.productId || '', billWeight: e.billWeight || 0, scaleWeight: e.scaleWeight || 0, transportCost: e.transportCost || 0
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
            <datalist id="origin-list">{originNames.map(n => <option key={n} value={n} />)}</datalist>
            <Modal isOpen={isBulkMoveModalOpen} onClose={() => setIsBulkMoveModalOpen(false)} title="انتقال حواله به تاریخ دیگر" footer={<><button onClick={() => setIsBulkMoveModalOpen(false)} className="px-4 py-2 text-slate-600">لغو</button><button onClick={handleBulkMove} className="bg-orange-500 text-white px-4 py-2 rounded-lg">تایید و انتقال</button></>}>
                <div className="space-y-4">
                    <p className="text-sm">تاریخ مقصد برای جابجایی {toPersianNumerals(selectedIds.size)} حواله:</p>
                    <DatePicker id="bulk-move-date" value={bulkMoveTargetDate} onChange={setBulkMoveTargetDate} />
                </div>
            </Modal>
            
            <DataImportModal 
                isOpen={isImportModalOpen} 
                onClose={() => setIsImportModalOpen(false)} 
                type="entry" 
                onSuccess={fetchEntries} 
                initialDate={currentDate}
            />

            <ImageImportModal 
                isOpen={isImageImportModalOpen} 
                onClose={() => setIsImageImportModalOpen(false)} 
                onSuccess={fetchEntries} 
                type="entry"
                initialDate={currentDate}
            />

            <div className="bg-white p-5 rounded-xl shadow-md">
                <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
                    <h1 className="text-2xl font-bold text-slate-700">مدیریت حواله‌های ورود</h1>
                    <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
                        <input type="text" placeholder="جستجو..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="p-2 border rounded-lg w-32" />
                        <div className="flex items-center gap-2 bg-slate-100 p-1 px-2 rounded-lg border border-slate-200">
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز بعد" type="button">{'<'}</button>
                             <DatePicker id="entry-date-picker" value={currentDate} onChange={setCurrentDate} className="w-32" />
                             <span className="text-sm font-bold text-sky-700 whitespace-nowrap min-w-[120px] text-center">{formatDateWithWeekday(currentDate)}</span>
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز قبل" type="button">{'>'}</button>
                        </div>
                        <button onClick={() => { setFormData({ ...initialFormState, productId: settings.products[0]?.id || '' }); setEditMode({ active: false, id: null }); setIsFormVisible(!isFormVisible); if(!isFormVisible) setTimeout(() => firstInputRef.current?.focus(), 100); }} className="bg-sky-500 text-white px-4 py-2 rounded-lg">افزودن</button>
                        <button onClick={() => setIsImageImportModalOpen(true)} className="bg-pink-600 text-white px-4 py-2 rounded-lg" title="وارد کردن از تصویر (AI)">پردازش تصویر هوش مصنوعی</button>
                        {selectedIds.size > 0 && (
                            <>
                                <button onClick={() => { setBulkMoveTargetDate(currentDate); setIsBulkMoveModalOpen(true); }} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm shadow-md animate-pulse">انتقال ({toPersianNumerals(selectedIds.size)})</button>
                                <button onClick={() => {
                                    Swal.fire({ title: `حذف ${toPersianNumerals(selectedIds.size)} حواله؟`, text: 'آیا مطمئن هستید؟ این عملیات غیرقابل بازگشت است.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' }).then(async (r:any) => {
                                        if (r.isConfirmed) {
                                            for(let id of Array.from(selectedIds)) { await dataService.deleteInvoice(id); }
                                            setSelectedIds(new Set());
                                            fetchEntries();
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
                            {calculatePrintPages(filteredEntries).map((_, index) => (
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
                                handlePrint('entry', filteredEntries, { printDate: currentDate, generalDescription: printDescription, customPrintTitle, pageSettings, showPageTotals, showGrandTotal });
                            }} className="px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg font-bold">تایید و چاپ</button>
                        </div>
                    </div>
                </div>
            )}

            {isFormVisible && (
                <form className="bg-white p-5 rounded-xl shadow-md space-y-4" onSubmit={handleSave}>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">فروشنده</label>
                            <input ref={firstInputRef} onKeyDown={handleKeyDown} placeholder="نام فروشنده" value={formData.sellerName} onChange={e => setFormData({...formData, sellerName: e.target.value})} className="w-full p-2 border rounded-lg" required />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">کارخانه</label>
                            <input onKeyDown={handleKeyDown} placeholder="نام کارخانه" value={formData.factory || ''} onChange={e => setFormData({...formData, factory: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">شماره بارنامه</label>
                            <input onKeyDown={handleKeyDown} placeholder="شماره بارنامه" value={formData.billNumber} onChange={e => setFormData({...formData, billNumber: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">مبدا</label>
                            <input list="origin-list" onKeyDown={handleKeyDown} placeholder="مبدا بارگیری" value={formData.origin} onChange={e => setFormData({...formData, origin: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
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
                            <label className="block text-xs font-bold text-slate-500 mb-1">وزن بارنامه</label>
                            <input onKeyDown={handleKeyDown} type="number" placeholder="وزن بارنامه" value={formData.billWeight || ''} onChange={e => setFormData({...formData, billWeight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">وزن باسکول (تخلیه)</label>
                            <input onKeyDown={handleKeyDown} type="number" placeholder="وزن باسکول" value={formData.scaleWeight || ''} onChange={e => setFormData({...formData, scaleWeight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" required />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t pt-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">راننده</label>
                            <input list="driver-list" onKeyDown={handleKeyDown} placeholder="نام راننده" value={formData.driverName} onChange={e => setFormData({...formData, driverName: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">تلفن راننده</label>
                            <input onKeyDown={handleKeyDown} placeholder="تلفن" value={formData.driverPhone} onChange={e => setFormData({...formData, driverPhone: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                         <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-bold text-slate-500">شبا/کارت</label>
                                {formData.driverIBAN && (
                                    <span className={`text-[10px] font-mono dir-ltr ${ibanValidation.isValid ? 'text-green-600' : 'text-red-500'}`}>
                                        {toPersianNumerals(ibanValidation.length)}
                                    </span>
                                )}
                            </div>
                            <div className="relative group">
                                <input 
                                    dir="ltr"
                                    maxLength={26}
                                    onKeyDown={handleKeyDown} 
                                    placeholder="IR... / کارت" 
                                    value={formData.driverIBAN} 
                                    onChange={e => setFormData({...formData, driverIBAN: e.target.value})} 
                                    className={`w-full p-2 border rounded-lg text-left font-mono transition-colors ${
                                        formData.driverIBAN && !ibanValidation.isValid 
                                            ? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200' 
                                            : ''
                                    }`} 
                                />
                                {formData.driverIBAN && !ibanValidation.isValid && (
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <span className="text-[10px] text-red-600 font-bold bg-white/90 px-1.5 py-0.5 rounded backdrop-blur-sm shadow-sm border border-red-100">
                                            {ibanValidation.message}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                         <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">کرایه (ریال)</label>
                            <input onKeyDown={handleKeyDown} type="number" placeholder="کرایه" value={formData.transportCost || ''} onChange={e => setFormData({...formData, transportCost: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-4">
                        {!editMode.active && (
                            <button type="button" onClick={(e) => handleSave(e as any, true)} className="bg-sky-500 text-white px-4 py-2 rounded-lg font-bold">ثبت و افزودن محصول دیگر</button>
                        )}
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
                <table className="w-full text-[13px] text-center border-collapse">
                    <thead className="bg-slate-100 font-bold">
                        <tr className="border-b-2 border-slate-300">
                            <th className="p-2 no-print">
                                {!pageBreakMode && (
                                    <input 
                                        type="checkbox" 
                                        checked={filteredEntries.length > 0 && selectedIds.size === filteredEntries.length} 
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedIds(new Set(filteredEntries.map(e => e.id)));
                                            else setSelectedIds(new Set());
                                        }} 
                                    />
                                )}
                            </th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('createdAt', e)}>ردیف <SortIcon colKey="createdAt"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('sellerName', e)}>فروشنده <SortIcon colKey="sellerName"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('productId', e)}>نوع محصول <SortIcon colKey="productId"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('billWeight', e)}>وزن بارنامه <SortIcon colKey="billWeight"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('scaleWeight', e)}>وزن باسکول <SortIcon colKey="scaleWeight"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('factory' as any, e)}>کارخانه <SortIcon colKey={'factory' as any}/></th>
                            <th className="p-2">افت</th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('billNumber', e)}>شماره بارنامه <SortIcon colKey="billNumber"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('origin', e)}>مبدا <SortIcon colKey="origin"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('transportCost', e)}>کرایه <SortIcon colKey="transportCost"/></th>
                            <th className="p-2 cursor-pointer group select-none" onClick={(e) => handleSort('driverName', e)}>راننده <SortIcon colKey="driverName"/></th>
                            <th className="p-2">تلفن راننده</th>
                            <th className="p-2">شبا/کارت</th>
                            <th className="p-2 no-print">عملیات</th>
                        </tr>
                    </thead>
                    <tbody ref={tableBodyRef} className={pageBreakMode ? 'page-break-selector' : ''}>
                        {filteredEntries.map((e, idx) => (
                            <tr key={e.id} data-id={e.id} onClick={() => pageBreakMode && handleTogglePageBreak(e.id)} className={`border-b hover:bg-slate-50 transition-all ${e.isPageBreak ? 'page-break-indicator' : ''}`}>
                                <td className="p-2 no-print">
                                    {!pageBreakMode && <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelection(e.id)} onClick={ev => ev.stopPropagation()} />}
                                </td>
                                <td className={`p-2 ${(!pageBreakMode && !searchTerm) ? 'cursor-move' : ''}`}>{toPersianNumerals(idx + 1)}</td>
                                <td className="p-2">{e.sellerName}</td>
                                <td className="p-2 font-bold text-sky-800">{productMap.get(e.productId)}</td>
                                <td className="p-2">{toPersianNumerals(Number(e.billWeight || 0).toLocaleString())}</td>
                                <td className="p-2 font-bold">{toPersianNumerals(Number(e.scaleWeight || 0).toLocaleString())}</td>
                                <td className="p-2">{e.factory || '-'}</td>
                                <td className={`p-2 font-bold ${e.wastage < 0 ? 'text-red-500' : 'text-green-600'}`}>{formatWastage(e.wastage)}</td>
                                <td className="p-2">{toPersianNumerals(e.billNumber)}</td>
                                <td className="p-2">{e.origin || '-'}</td>
                                <td className="p-2 text-xs">{formatCurrency(e.transportCost)}</td>
                                <td className="p-2">{e.driverName}</td>
                                <td className="p-2 text-xs">{toPersianNumerals(e.driverPhone)}</td>
                                <td className="p-2 text-xs" dir="ltr">{formatIBANForDisplay(e.driverIBAN)}</td>
                                <td className="p-2 no-print">
                                    <div className="flex gap-2 justify-center">
                                        <button onClick={(ev) => { ev.stopPropagation(); startEditing(e); }} className="text-blue-600 hover:font-bold">ویرایش</button>
                                        <button onClick={(ev) => { ev.stopPropagation(); handleSingleMove(e.id); }} className="text-orange-600 hover:font-bold">انتقال</button>
                                        <button onClick={(ev) => { ev.stopPropagation(); Swal.fire({ title: 'حذف حواله؟', icon: 'warning', showCancelButton: true }).then(async (r:any) => { if (r.isConfirmed) { await dataService.deleteInvoice(e.id); fetchEntries(); } }); }} className="text-red-500 hover:font-bold">حذف</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-600">
                        <tr>
                            <td className="p-2 no-print"></td>
                            <td className="p-2 text-left pl-4 text-lg" colSpan={4}>
                                مجموع ورود روزانه:
                            </td>
                            <td className="p-2 text-lg">
                                {toPersianNumerals(totals.billWeight.toLocaleString())}
                            </td>
                            <td className="p-2 text-lg">
                                {toPersianNumerals(totals.scaleWeight.toLocaleString())}
                            </td>
                            <td className={`p-2 text-lg ${totals.wastage < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                {formatWastage(totals.wastage)}
                            </td>
                            <td className="p-2" colSpan={5}></td>
                            <td className="p-2 no-print"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default EntryPage;
