
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DatePicker from '../components/DatePicker';
import { Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatToISODate, formatDateWithWeekday, formatCurrency } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import { sortRows, nextSortSpecs, debugSort } from '../utils/tableSort';
import { handlePrint, calculatePrintPages } from '../utils/print';
import Modal from '../components/Modal';
import Swal from 'sweetalert2';
import Sortable from 'sortablejs';
import DataImportModal from '../components/DataImportModal';
import ImageImportModal from '../components/ImageImportModal';
import { useAuth } from '../contexts/AuthContext';

type SortableKeys = keyof Exit | 'farmerId' | 'productId';
type SortConfigItem = { key: SortableKeys; direction: 'asc' | 'desc' };

const ExitPage: React.FC = () => {
    const { isViewer } = useAuth();
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

    const { settings, productMap, saveSettings } = useSettings();
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
        weight: 0, driverName: '', invoiceNumber: '', productVariant: '', isCrumble: false, notes: ''
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

    // Device-sync fix: re-read the day as soon as hydration has rebuilt the layout from the
    // server's authoritative `sort_order`.
    useEffect(() => {
        const onOrderSynced = () => fetchExits();
        window.addEventListener(dataService.ORDER_SYNCED_EVENT, onOrderSynced);
        return () => window.removeEventListener(dataService.ORDER_SYNCED_EVENT, onOrderSynced);
    }, [fetchExits]);
    
    useEffect(() => {
        const timerId = setTimeout(() => { setDebouncedSearchTerm(searchTerm); }, 300);
        return () => { clearTimeout(timerId); };
    }, [searchTerm]);

    const handleSort = (key: SortableKeys, event: React.MouseEvent) => {
        // Shift = add a secondary level. Sorting the ROWS is the only thing that changes; the
        // sort config itself is pure state (see utils/tableSort for the row-integrity rule).
        setSortConfig(prev => nextSortSpecs<SortableKeys>(prev, key, event.shiftKey));
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
            // ROW INTEGRITY: `sortRows` sorts the WHOLE exit objects; the farmer name is read
            // through an accessor (farmerId -> name) so a row's name can never detach from its
            // own weights during a multi-level sort.
            const tiebreak = (a: Exit, b: Exit) => {
                if (sortConfig[0]?.key !== 'farmerId') {
                    const aName = fMap.get(a.farmerId) || '';
                    const bName = fMap.get(b.farmerId) || '';
                    if (aName !== bName) return aName.localeCompare(bName, 'fa', { numeric: true, sensitivity: 'base' }) < 0 ? -1 : 1;
                }
                return dataService.createdMs(a) - dataService.createdMs(b);
            };

            result = debugSort<Exit>(
                'exit',
                sortRows<Exit, SortableKeys>(
                    result,
                    sortConfig,
                    {
                        farmerId: (e) => fMap.get(e.farmerId) || '',
                        productId: (e) => productOrderMap.get(e.productId) ?? 999,
                    },
                    tiebreak,
                ),
                exits,
                sortConfig as any,
                ['id', 'date', 'farmerId', 'productId', 'weight', 'driverName', 'invoiceNumber'],
            );
        }
        return result;
    }, [exits, debouncedSearchTerm, farmers, productMap, sortConfig, productOrderMap]);

    // --- Dedicated page title, visible in the UI (not only in the print preview) -------------
    const [titleDraft, setTitleDraft] = useState(settings.exitPrintTitle || '');
    const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { setTitleDraft(settings.exitPrintTitle || ''); }, [settings.exitPrintTitle]);
    useEffect(() => () => { if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current); }, []);

    const commitTitle = (value: string, immediate = false) => {
        setTitleDraft(value);
        if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
        const persist = () => saveSettings({ ...settings, exitPrintTitle: value });
        if (immediate) persist();
        else titleSaveTimer.current = setTimeout(persist, 800);
    };

    const effectiveTitle = (pageSettings[0]?.title || '').trim() || titleDraft.trim() || 'فرم خروج روزانه';

    // --- Per-product totals of the rendered (filtered) view ----------------------------------
    const productTotals = useMemo(() => {
        const map = new Map<string, { name: string; total: number; rows: number }>();
        filteredExits.forEach(e => {
            const key = e.productId || '-';
            const bucket = map.get(key) || { name: productMap.get(key) || key, total: 0, rows: 0 };
            bucket.total += Number(e.weight || 0);
            bucket.rows += 1;
            map.set(key, bucket);
        });
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }, [filteredExits, productMap]);

    // --- Per-page print titles, editable INLINE in the main UI -------------------------------
    // Same rule as the print engine (calculatePrintPages): a row flagged `isPageBreak` starts a new
    // page. Page 1 keeps the master bar above the table; later pages get their own input in place.
    const pageTitleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (pageTitleSaveTimer.current) clearTimeout(pageTitleSaveTimer.current); }, []);

    const pageStarts = useMemo(() => {
        const map = new Map<number, number>(); // rowIndex -> pageIndex (pages 2..n only)
        calculatePrintPages(filteredExits).forEach((page, pageIndex) => {
            if (pageIndex > 0 && page.offset < filteredExits.length) map.set(page.offset, pageIndex);
        });
        return map;
    }, [filteredExits]);

    const pageTitleValue = (pageIndex: number): string => {
        const live = pageSettings[pageIndex]?.title;
        if (live !== undefined) return live;
        return settings.exitPageTitles?.[pageIndex] || '';
    };

    const setPageTitle = (pageIndex: number, value: string, immediate = false) => {
        const next = [...pageSettings];
        if (!next[pageIndex]) next[pageIndex] = { title: '', description: '' };
        next[pageIndex] = { ...next[pageIndex], title: value };
        setPageSettings(next);

        const titles = next.map(p => p?.title || '');
        if (pageTitleSaveTimer.current) clearTimeout(pageTitleSaveTimer.current);
        if (immediate) saveSettings({ ...settings, exitPageTitles: titles });
        else pageTitleSaveTimer.current = setTimeout(() => saveSettings({ ...settings, exitPageTitles: titles }), 800);
    };

    const totalWeight = useMemo(() => {
        return filteredExits.reduce((sum, item) => sum + (item.weight || 0), 0);
    }, [filteredExits]);

    useEffect(() => {
        if (tableBodyRef.current) {
            if (sortableInstance.current) sortableInstance.current.destroy();
            // A sorted table is a VIEW: manual reordering stays disabled while a sort is active so
            // the on-screen (sorted) order can never be written back into the stored list.
            const isDnDDisabled = pageBreakMode || !!debouncedSearchTerm.trim() || isViewer || sortConfig.length > 0;

            sortableInstance.current = Sortable.create(tableBodyRef.current, {
                animation: 150,
                handle: '.cursor-move',
                // Per-page title rows live inside this body too: they are filtered out of dragging
                // and the reorder math uses the DRAggable indices, so they cannot shift row order.
                filter: '.page-title-row',
                disabled: isDnDDisabled,
                onEnd: (evt: any) => {
                    // Defensive guard: never reorder while a sort config exists.
                    if (sortConfig.length > 0) return;
                    const oldIndex = evt.oldDraggableIndex !== undefined ? evt.oldDraggableIndex : evt.oldIndex;
                    const newIndex = evt.newDraggableIndex !== undefined ? evt.newDraggableIndex : evt.newIndex;
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    
                    // Reorder the WHOLE stored list (row objects) - never the filtered view.
                    const newOrdered = [...exits];
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
        return () => {
            if (sortableInstance.current) {
                sortableInstance.current.destroy();
                sortableInstance.current = null;
            }
        };
    }, [exits, filteredExits, debouncedSearchTerm, pageBreakMode, sortConfig]);

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
        } catch (e: any) { showToast(e?.message || 'خطا در ذخیره', 'error'); }
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
            isCrumble: e.isCrumble || false,
            notes: e.notes ?? ''
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
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-slate-700">مدیریت حواله‌های خروج</h1>
                        {isViewer && (
                            <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">فقط‌خواند</span>
                        )}
                    </div>
                    <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
                        <input type="text" placeholder="جستجو..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="p-2 border rounded-lg w-32" />
                        <div className="flex items-center gap-2 bg-slate-100 p-1 px-2 rounded-lg border border-slate-200">
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز بعد" type="button">{'<'}</button>
                             <DatePicker id="exit-date-picker" value={currentDate} onChange={setCurrentDate} className="w-32" />
                             <span className="text-sm font-bold text-sky-700 whitespace-nowrap min-w-[120px] text-center">{formatDateWithWeekday(currentDate)}</span>
                             <button onClick={() => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 1); return d; })} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 font-bold" title="روز قبل" type="button">{'>'}</button>
                        </div>
                        {!isViewer && (
                            <button onClick={() => { setFormData({ ...initialFormState, productId: settings.products.find(p => p.type === 'finishedGood')?.id || '' }); setEditMode({ active: false, id: null }); setIsFormVisible(!isFormVisible); if(!isFormVisible) setTimeout(() => firstInputRef.current?.focus(), 100); }} className="bg-sky-500 text-white px-4 py-2 rounded-lg">افزودن</button>
                        )}
                        {!isViewer && (
                            <button onClick={() => setIsImageImportModalOpen(true)} className="bg-pink-600 text-white px-4 py-2 rounded-lg" title="وارد کردن از تصویر (AI)">پردازش تصویر هوش مصنوعی</button>
                        )}
                        {!isViewer && selectedIds.size > 0 && (
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
                        {!isViewer && (
                            <button 
                                disabled={!!searchTerm}
                                onClick={handleSaveOrder} 
                                className={`px-4 py-2 rounded-lg text-sm transition-all ${hasUnsavedChanges && !searchTerm ? 'bg-orange-500 text-white scale-105 shadow-lg' : 'bg-slate-200 text-slate-500'}`}
                            >
                                ذخیره ترتیب
                            </button>
                        )}
                        {sortConfig.length > 0 && (
                            <button onClick={() => setSortConfig([])} className="px-4 py-2 rounded-lg text-sm bg-red-100 text-red-600 hover:bg-red-200">
                                لغو مرتب‌سازی
                            </button>
                        )}
                        {!isViewer && (
                            <button onClick={() => setPageBreakMode(!pageBreakMode)} className={`px-4 py-2 rounded-lg text-sm ${pageBreakMode ? 'bg-red-500 text-white' : 'bg-slate-200'}`}>تعیین صفحه</button>
                        )}
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
                                            onChange={e => setPageTitle(index, e.target.value)}
                                            onBlur={e => setPageTitle(index, e.target.value, true)}
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

            {isFormVisible && !isViewer && (
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
                            {/* UX: an exit is a sale of FINISHED goods, so the final products come first
                                (grouped and labelled) and the raw materials are pushed below the divider. */}
                            <select onKeyDown={handleKeyDown} value={formData.productId} onChange={e => setFormData({...formData, productId: e.target.value})} className="w-full p-2 border rounded-lg h-[42px]">
                                <optgroup label="محصولات نهایی (محصول فروش)">
                                    {settings.products.filter(p => !p.isDeleted && p.type === 'finishedGood').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </optgroup>
                                <optgroup label="مواد اولیه">
                                    {settings.products.filter(p => !p.isDeleted && p.type === 'rawMaterial').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

            {/* Dedicated page title in the main UI, directly above the table (Task 4). */}
            <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-xl shadow-md border-r-4 border-emerald-500 no-print">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">عنوان صفحه ۱ (اعمال بر همه صفحات):</span>
                    <h2 className="text-lg font-bold text-slate-800">{effectiveTitle}</h2>
                </div>
                <div className="flex items-center gap-2 mr-auto">
                    <input
                        value={titleDraft}
                        onChange={e => commitTitle(e.target.value)}
                        onBlur={e => commitTitle(e.target.value, true)}
                        placeholder="عنوان اختصاصی این صفحه..."
                        className="p-2 border rounded-lg text-sm min-w-[260px]"
                    />
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">ذخیره خودکار</span>
                </div>
                <span className="text-sm font-bold text-slate-500 whitespace-nowrap">{formatDateWithWeekday(currentDate)}</span>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md overflow-x-auto">
                <div className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    برای مرتب‌سازی چند سطحی، کلید Shift را نگه دارید و روی سرستون‌ها کلیک کنید.
                </div>
                <table className="w-full min-w-[760px] whitespace-nowrap text-sm text-center border-collapse border border-slate-800">
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
                                <React.Fragment key={e.id}>
                                {pageStarts.has(idx) && (
                                    <tr className="page-title-row no-print">
                                        <td colSpan={8} className="p-2 bg-emerald-50 border-y-2 border-emerald-300">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-emerald-900 text-sm whitespace-nowrap">
                                                    شروع صفحه {toPersianNumerals((pageStarts.get(idx) as number) + 1)}:
                                                </span>
                                                <input
                                                    value={pageTitleValue(pageStarts.get(idx) as number)}
                                                    onChange={ev => setPageTitle(pageStarts.get(idx) as number, ev.target.value)}
                                                    onBlur={ev => setPageTitle(pageStarts.get(idx) as number, ev.target.value, true)}
                                                    placeholder="عنوان اختصاصی این صفحه..."
                                                    className="p-1.5 border rounded-lg text-sm min-w-[240px] flex-grow"
                                                />
                                                <span className="text-[11px] text-slate-500 whitespace-nowrap">ذخیره خودکار</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                <tr data-id={e.id} onClick={() => pageBreakMode && handleTogglePageBreak(e.id)} className={`hover:bg-slate-50 transition-all ${e.isPageBreak ? 'page-break-indicator' : ''}`}>
                                    <td className="p-2 border border-slate-400 no-print">
                                        {!pageBreakMode && <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelection(e.id)} onClick={ev => ev.stopPropagation()} />}
                                    </td>
                                    <td className={`p-2 border border-slate-400 font-bold text-lg ${(!pageBreakMode && !searchTerm && sortConfig.length === 0 && !isViewer) ? 'cursor-move' : ''}`}>{toPersianNumerals(idx + 1)}</td>
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
                                            {!isViewer && (
                                                <>
                                                    <button onClick={(ev) => { ev.stopPropagation(); startEditing(e); }} className="text-blue-600 hover:font-bold">ویرایش</button>
                                                    <button onClick={(ev) => { ev.stopPropagation(); handleSingleMove(e.id); }} className="text-orange-600 hover:font-bold">انتقال</button>
                                                    <button onClick={(ev) => { ev.stopPropagation(); Swal.fire({ title: 'حذف حواله؟', icon: 'warning', showCancelButton: true }).then(async (r:any) => { if (r.isConfirmed) { await dataService.deleteInvoice(e.id); fetchExits(); } }); }} className="text-red-500 hover:font-bold">حذف</button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                </React.Fragment>
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

            {productTotals.length > 0 && (
                <div className="mt-3 mb-2 bg-white border border-slate-300 rounded-xl shadow-sm px-4 py-2 no-print">
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                        <span className="font-bold text-slate-700">جمع محصولات روز:</span>
                        {productTotals.map(p => (
                            <span key={p.name} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-2 py-1">
                                <span className="font-bold">{p.name}</span>
                                <span className="font-mono">{toPersianNumerals(Math.round(p.total).toLocaleString())}</span>
                                <span className="text-[10px] text-slate-500">({toPersianNumerals(p.rows)} ردیف)</span>
                            </span>
                        ))}
                        <span className="mr-auto text-slate-500">تعداد اقلام: {toPersianNumerals(productTotals.length)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExitPage;
