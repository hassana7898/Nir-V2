
import React, { useMemo, useState } from 'react';
import { Farmer, Brood, Exit, ExceptionalFeed } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatDate, formatToISODate } from '../utils/formatters';
import * as dataService from '../services/dataService';
import { handlePrint } from '../utils/print';
import Modal from './Modal';
import DatePicker from './DatePicker';
import Swal from 'sweetalert2';

interface BroodDetailsCardProps {
    farmer: Farmer;
    brood: Brood;
    allExits: Exit[];
    onUpdate: (updatedBrood: Brood) => void;
    onDelete: (broodId: string) => void;
    onInvoiceUpdate?: () => void;
    showFarmerName?: boolean;
    isArchived?: boolean;
}

const safeParseFloat = (val: any): number => {
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
};

const BroodDetailsCard: React.FC<BroodDetailsCardProps> = ({ farmer, brood, allExits, onUpdate, onDelete, onInvoiceUpdate, showFarmerName = false, isArchived = false }) => {
    const { settings, productMap } = useSettings();
    const quotaMap = useMemo(() => new Map(settings.feedQuotas?.map(q => [q.productId, q.quotaPerChick])), [settings.feedQuotas]);

    // State for Edit Brood Modal
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editFormData, setEditFormData] = useState<{
        startDate: Date;
        endDate: Date | null;
        chickCount: number;
        finalChickenWeight: number;
        startInvoiceId: string;
    }>({
        startDate: new Date(),
        endDate: null,
        chickCount: 0,
        finalChickenWeight: 0,
        startInvoiceId: ''
    });

    // State for End/Archive Modal
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [archiveFormData, setArchiveFormData] = useState<{
        endDate: Date;
        finalChickenWeight: number;
    }>({
        endDate: new Date(),
        finalChickenWeight: 0
    });


    // State for Add Exceptional Feed Modal
    const [isFeedModalOpen, setIsFeedModalOpen] = useState(false);
    const [feedFormData, setFeedFormData] = useState<{
        productId: string;
        weight: number;
        reason: string;
        date: Date;
    }>({
        productId: '',
        weight: 0,
        reason: '',
        date: new Date()
    });

    // State for Edit Invoice Modal
    const [editingInvoice, setEditingInvoice] = useState<Exit | null>(null);
    const [editInvoiceForm, setEditInvoiceForm] = useState<{
        date: Date;
        farmerId: string;
        productId: string;
        weight: number;
        invoiceNumber: string;
    } | null>(null);

    // State for Expanded Product Details
    const [expandedProductId, setExpandedProductId] = useState<string | null>(null);


    const calculatedData = useMemo(() => {
        // all finished goods ever, so we dont lose past exit weights
        const finishedGoodProductIds = new Set(
            settings.products.filter(p => p.type === "finishedGood").map(p => p.id)
        );

        const sent = new Map<string, number>();
        
        const farmerExits = allExits.filter(exit => exit.farmerId === farmer.id);
        let baseInvoices: Exit[] = [];

        if (brood.startInvoiceId) {
            const startInvoice = farmerExits.find(e => e.id === brood.startInvoiceId);
            if (startInvoice) {
                baseInvoices = farmerExits.filter(e => e.createdAt >= startInvoice.createdAt);
                if (brood.endDate) {
                    const broodEnd = new Date(brood.endDate);
                    broodEnd.setHours(23, 59, 59, 999);
                    const broodEndTime = broodEnd.getTime();
                    baseInvoices = baseInvoices.filter(e => {
                        const exitDate = new Date(e.date);
                        exitDate.setHours(12, 0, 0, 0);
                        return exitDate.getTime() <= broodEndTime;
                    });
                }
            }
        } else {
            const broodStart = new Date(brood.startDate);
            broodStart.setHours(0, 0, 0, 0);
            const broodStartTime = broodStart.getTime();

            const broodEnd = brood.endDate ? new Date(brood.endDate) : new Date();
            broodEnd.setHours(23, 59, 59, 999);
            const broodEndTime = broodEnd.getTime();

            baseInvoices = farmerExits.filter(exit => {
                const exitDate = new Date(exit.date);
                exitDate.setHours(12, 0, 0, 0);
                const exitTime = exitDate.getTime();
                return exitTime >= broodStartTime && exitTime <= broodEndTime;
            });
        }
        
        const includedIds = new Set(brood.includedInvoiceIds || []);
        const excludedIds = new Set(brood.excludedInvoiceIds || []);

        let finalInvoices = baseInvoices.filter(inv => !excludedIds.has(inv.id));
        
        includedIds.forEach(id => {
            if (!finalInvoices.some(inv => inv.id === id)) {
                const invoiceToAdd = allExits.find(inv => inv.id === id);
                if (invoiceToAdd) finalInvoices.push(invoiceToAdd);
            }
        });
        
        finalInvoices.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        finalInvoices.forEach(exit => {
            sent.set(exit.productId, (sent.get(exit.productId) || 0) + safeParseFloat(exit.weight));
        });
            
        (brood.exceptionalFeed || []).forEach(feed => {
             sent.set(feed.productId, (sent.get(feed.productId) || 0) + safeParseFloat(feed.weight));
        });
        
        let totalFeedWeight = 0;
        sent.forEach((weight, productId) => {
            if (finishedGoodProductIds.has(productId)) {
                totalFeedWeight += weight;
            }
        });

        let calculatedTotalQuota = 0;
        settings.products
            .filter(p => {
                if (p.type !== "finishedGood") return false;
                if (brood.activeProductsAtCreation) {
                    return brood.activeProductsAtCreation.includes(p.id);
                }
                return !p.isDeleted;
            })
            .forEach(product => {
                calculatedTotalQuota += (quotaMap.get(product.id) || 0) * brood.chickCount / 1000;
            });

        // Metrics: Use setHours(0,0,0,0) to normalize dates for difference calculation
        const start = new Date(brood.startDate);
        start.setHours(0, 0, 0, 0);
        
        const end = brood.endDate ? new Date(brood.endDate) : new Date();
        end.setHours(0, 0, 0, 0);
        
        const oneDay = 24 * 60 * 60 * 1000;
        const timeDiff = end.getTime() - start.getTime();
        const daysOfBrood = Math.max(0, Math.round(timeDiff / oneDay)) + 1;

        const finalWeight = safeParseFloat(brood.finalChickenWeight);
        const conversionRate = (finalWeight > 0 && totalFeedWeight > 0) ? (totalFeedWeight / finalWeight).toFixed(3) : null;
        const perCapitaConsumption = brood.chickCount > 0 ? Math.round((totalFeedWeight * 1000) / brood.chickCount) : 0;

        return { 
            sentData: sent, 
            totalSentWeight: totalFeedWeight, 
            relevantInvoices: finalInvoices, 
            totalQuota: calculatedTotalQuota,
            daysOfBrood,
            perCapitaConsumption,
            conversionRate
        };
    }, [farmer.id, brood, allExits, settings.products, quotaMap]);

    const { sentData, totalSentWeight, relevantInvoices, totalQuota, daysOfBrood, perCapitaConsumption, conversionRate } = calculatedData;

    const progressPercentage = useMemo(() => {
        if (totalQuota === 0) return 0;
        return Math.min(100, (totalSentWeight / totalQuota) * 100);
    }, [totalSentWeight, totalQuota]);

    const progressColor = useMemo(() => {
        if (progressPercentage < 75) return 'bg-green-500';
        if (progressPercentage < 95) return 'bg-yellow-500';
        return 'bg-red-500';
    }, [progressPercentage]);

    const totalRemaining = totalQuota - totalSentWeight;


    const handleOpenEditModal = () => {
        setEditFormData({
            startDate: new Date(brood.startDate),
            endDate: brood.endDate ? new Date(brood.endDate) : null,
            chickCount: brood.chickCount,
            finalChickenWeight: brood.finalChickenWeight || 0,
            startInvoiceId: brood.startInvoiceId || ''
        });
        setIsEditModalOpen(true);
    };

    const handleConfirmEdit = () => {
        if (!editFormData.startDate) { Swal.showValidationMessage('تاریخ شروع الزامی است'); return; }
        if (!editFormData.chickCount || editFormData.chickCount <= 0) { Swal.showValidationMessage('تعداد جوجه باید عدد مثبت باشد'); return; }
        
        const updatedBrood = { 
            ...brood, 
            startDate: formatToISODate(editFormData.startDate),
            endDate: editFormData.endDate ? formatToISODate(editFormData.endDate) : undefined,
            chickCount: editFormData.chickCount,
            finalChickenWeight: editFormData.finalChickenWeight || undefined,
            startInvoiceId: editFormData.startInvoiceId || undefined,
        };
        onUpdate(updatedBrood);
        setIsEditModalOpen(false);
    };

    const handleOpenArchiveModal = () => {
        setArchiveFormData({
            endDate: new Date(),
            finalChickenWeight: brood.finalChickenWeight || 0
        });
        setIsArchiveModalOpen(true);
    };

    const handleConfirmArchive = () => {
        const updatedBrood = {
            ...brood,
            endDate: formatToISODate(archiveFormData.endDate),
            finalChickenWeight: archiveFormData.finalChickenWeight > 0 ? archiveFormData.finalChickenWeight : undefined
        };
        onUpdate(updatedBrood);
        setIsArchiveModalOpen(false);
        Swal.fire('بایگانی شد', 'دوره با موفقیت بسته و به لیست بایگانی منتقل شد.', 'success');
    };

    const handleReopenBrood = () => {
        Swal.fire({
            title: 'بازگشایی مجدد دوره؟',
            text: 'این دوره از حالت بایگانی خارج شده و به لیست فعال برمی‌گردد.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'بله، باز شود',
            cancelButtonText: 'لغو'
        }).then((result: any) => {
            if (result.isConfirmed) {
                const updatedBrood = { ...brood, endDate: undefined };
                onUpdate(updatedBrood);
            }
        });
    };

    const handleToggleInvoice = (invoiceId: string, action: 'include' | 'exclude') => {
        if (isArchived) return; // Prevent editing if archived
        let updatedBrood = { ...brood };
        const included = new Set(updatedBrood.includedInvoiceIds || []);
        const excluded = new Set(updatedBrood.excludedInvoiceIds || []);
        
        if (action === 'exclude') {
            excluded.add(invoiceId);
            included.delete(invoiceId);
        } else { // 'include' (re-include)
            excluded.delete(invoiceId);
        }
        
        updatedBrood.includedInvoiceIds = Array.from(included);
        updatedBrood.excludedInvoiceIds = Array.from(excluded);
        onUpdate(updatedBrood);
    };

    const handleAddInvoice = () => {
        if (isArchived) return;
        const allFarmers = dataService.getFarmers();
        const farmerMapForModal = new Map(allFarmers.map(f => [f.id, f.name]));

        const otherInvoices = allExits
            .filter(exit => !relevantInvoices.some(rel => rel.id === exit.id))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(exit => {
                const farmerName = farmerMapForModal.get(exit.farmerId) || 'ناشناس';
                const invoiceIdentifier = exit.invoiceNumber ? `حواله ${toPersianNumerals(exit.invoiceNumber)}` : `ID: ...${exit.id.slice(-4)}`;
                return `<option value="${exit.id}">${formatDate(exit.date)} - ${farmerName} - ${productMap.get(exit.productId)} - ${toPersianNumerals(exit.weight)}kg (${invoiceIdentifier})</option>`;
            })
            .join('');

        if (!otherInvoices) {
            Swal.fire('توجه', 'هیچ حواله دیگری برای افزودن به این دوره یافت نشد.', 'info');
            return;
        }

        Swal.fire({
            title: 'افزودن حواله به دوره',
            html: `
                <p class="text-sm text-slate-600 my-2">یک حواله را برای افزودن دستی به محاسبات این دوره انتخاب کنید.</p>
                <select id="swal-invoice-select" class="swal2-select">${otherInvoices}</select>
            `,
            preConfirm: () => (document.getElementById('swal-invoice-select') as HTMLSelectElement).value,
            showCancelButton: true,
            confirmButtonText: 'افزودن',
            cancelButtonText: 'لغو'
        }).then(result => {
            if (result.isConfirmed && result.value) {
                const included = new Set(brood.includedInvoiceIds || []);
                included.add(result.value);
                onUpdate({ ...brood, includedInvoiceIds: Array.from(included) });
            }
        });
    };

    const handleOpenFeedModal = () => {
        if (isArchived) return;
        const defaultProduct = settings.products.find(p => p.type === 'finishedGood')?.id || '';
        setFeedFormData({
            productId: defaultProduct,
            weight: 0,
            reason: '',
            date: new Date()
        });
        setIsFeedModalOpen(true);
    };

    const handleConfirmFeed = () => {
        if (!feedFormData.productId || feedFormData.weight <= 0) {
            Swal.fire('خطا', 'لطفا محصول و وزن معتبر را وارد کنید', 'error');
            return;
        }

        const newFeed: ExceptionalFeed = {
            productId: feedFormData.productId,
            weight: feedFormData.weight,
            reason: feedFormData.reason,
            date: formatToISODate(feedFormData.date)
        };
        const exceptionalFeed = brood.exceptionalFeed || [];
        onUpdate({ ...brood, exceptionalFeed: [...exceptionalFeed, newFeed] });
        setIsFeedModalOpen(false);
    };

    const handleDeleteFeed = (index: number) => {
        if (isArchived) return;
        const exceptionalFeed = brood.exceptionalFeed || [];
        const updatedFeed = exceptionalFeed.filter((_, i) => i !== index);
        onUpdate({ ...brood, exceptionalFeed: updatedFeed });
    };

    const farmerExitsForEdit = useMemo(() => {
        return allExits
            .filter(e => e.farmerId === farmer.id)
            .sort((a, b) => b.createdAt - a.createdAt);
    }, [allExits, farmer.id]);

    const toggleProductDetails = (productId: string) => {
        setExpandedProductId(prev => prev === productId ? null : productId);
    };

    const handleEditInvoiceClick = (invoice: Exit) => {
        if (isArchived) return;
        setEditingInvoice(invoice);
        setEditInvoiceForm({
            date: new Date(invoice.date),
            farmerId: invoice.farmerId,
            productId: invoice.productId,
            weight: invoice.weight,
            invoiceNumber: invoice.invoiceNumber
        });
    };

    const handleSaveInvoice = async () => {
        if (!editingInvoice || !editInvoiceForm) return;
        if (!editInvoiceForm.date || !editInvoiceForm.farmerId || !editInvoiceForm.productId) {
            Swal.fire('خطا', 'لطفا تمام فیلدها را پر کنید.', 'error');
            return;
        }

        const updatedData = {
            date: formatToISODate(editInvoiceForm.date),
            farmerId: editInvoiceForm.farmerId,
            productId: editInvoiceForm.productId,
            weight: editInvoiceForm.weight,
            invoiceNumber: editInvoiceForm.invoiceNumber
        };

        try {
            await dataService.updateInvoice(editingInvoice.id, updatedData);
            setEditingInvoice(null);
            setEditInvoiceForm(null);
            if (onInvoiceUpdate) onInvoiceUpdate();
            Swal.fire('موفق', 'حواله با موفقیت ویرایش شد.', 'success');
        } catch (error) {
            Swal.fire('خطا', 'مشکلی در ویرایش حواله رخ داد.', 'error');
        }
    };

    const handlePrintBrood = (e: React.MouseEvent) => {
        e.stopPropagation();
        handlePrint('brood', calculatedData, { farmer, brood });
    };

    // --- Phase Logic Calculation ---
    const getProductPhaseInfo = (currentProductId: string, productQuota: number, sentAmount: number) => {
        const getPhaseDuration = (prodId: string) => settings.productPhaseDurations?.[prodId] || 10;
        const finishedGoods = settings.products.filter(p => p.type === 'finishedGood');
        
        let startDay = 1;
        let endDay = 0;
        
        for (const prod of finishedGoods) {
            const duration = getPhaseDuration(prod.id);
            if (prod.id === currentProductId) {
                endDay = startDay + duration - 1;
                break;
            }
            startDay += duration;
        }
        
        if (endDay === 0) return { dailyRecommended: 0, statusMessage: 'نامشخص', statusColor: '', remainingDays: null };

        const currentPhaseDuration = endDay - startDay + 1;
        const dailyRecommended = currentPhaseDuration > 0 ? productQuota / currentPhaseDuration : 0;
        
        let expectedConsumption = 0;
        let statusMessage = '';
        let statusColor = 'text-slate-500';
        let remainingDays = 0;

        if (daysOfBrood < startDay) {
            expectedConsumption = 0;
            statusMessage = `شروع نشده (روز ${toPersianNumerals(startDay)} تا ${toPersianNumerals(endDay)})`;
        } else if (daysOfBrood > endDay) {
            expectedConsumption = productQuota;
            const diff = sentAmount - productQuota;
            if (diff > 0) {
                statusMessage = `${toPersianNumerals(Math.round(diff).toLocaleString())} kg اضافه مصرف شده`;
                statusColor = 'text-red-500';
            } else if (diff < 0 && Math.abs(diff) > (productQuota * 0.05)) {
                 statusMessage = `${toPersianNumerals(Math.abs(Math.round(diff)).toLocaleString())} kg کمتر از حد انتظار`;
                 statusColor = 'text-yellow-600';
            } else {
                statusMessage = 'مصرف تکمیل شده';
                statusColor = 'text-green-600';
            }
        } else {
            const daysInPhase = daysOfBrood - startDay + 1;
            expectedConsumption = dailyRecommended * daysInPhase;
            const diff = sentAmount - expectedConsumption;
            remainingDays = endDay - daysOfBrood;

            if (diff > dailyRecommended) {
                 const daysAhead = Math.round(diff / dailyRecommended);
                 statusMessage = `${toPersianNumerals(daysAhead)} روز جلوتر از برنامه`;
                 statusColor = 'text-orange-500';
            } else if (diff < -dailyRecommended) {
                 const daysBehind = Math.round(Math.abs(diff) / dailyRecommended);
                 statusMessage = `${toPersianNumerals(daysBehind)} روز عقب‌تر از برنامه`;
                 statusColor = 'text-yellow-600';
            } else {
                statusMessage = 'مطابق برنامه';
                statusColor = 'text-green-600';
            }
        }

        return { dailyRecommended, statusMessage, statusColor, remainingDays: (daysOfBrood >= startDay && daysOfBrood <= endDay) ? remainingDays : null };
    };


    return (
        <details className={`p-4 border rounded-xl shadow-sm hover:shadow-md transition-shadow group ${isArchived ? 'bg-slate-50 border-slate-300' : 'bg-white border-slate-200'}`} open>
            {/* --- Modals --- */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`ویرایش دوره ${formatDate(brood.startDate)}`}
                footer={
                    <>
                        <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">لغو</button>
                        <button onClick={handleConfirmEdit} className="px-4 py-2 bg-blue-500 text-white hover:bg-blue-600 rounded-lg">ذخیره تغییرات</button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ شروع جوجه‌ریزی</label>
                        <DatePicker id="edit-start-date" value={editFormData.startDate} onChange={(date) => setEditFormData({...editFormData, startDate: date})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ پایان دوره (اختیاری)</label>
                        <DatePicker id="edit-end-date" value={editFormData.endDate || undefined} onChange={(date) => setEditFormData({...editFormData, endDate: date})} placeholder="در صورت اتمام دوره انتخاب کنید" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تعداد جوجه</label>
                        <input type="number" value={editFormData.chickCount} onChange={(e) => setEditFormData({...editFormData, chickCount: parseInt(e.target.value) || 0})} className="w-full p-2 border rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">وزن نهایی مرغ (kg)</label>
                        <input type="number" value={editFormData.finalChickenWeight || ''} onChange={(e) => setEditFormData({...editFormData, finalChickenWeight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" placeholder="وزن کل بار فروخته شده" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">حواله شروع دوره (اختیاری)</label>
                        <select value={editFormData.startInvoiceId} onChange={(e) => setEditFormData({...editFormData, startInvoiceId: e.target.value})} className="w-full p-2 border rounded-lg">
                            <option value="">محاسبه بر اساس تاریخ شروع</option>
                            {farmerExitsForEdit.map(exit => (
                                <option key={exit.id} value={exit.id}>{formatDate(exit.date)} - #{toPersianNumerals(exit.invoiceNumber || exit.id.slice(-4))} - {productMap.get(exit.productId)}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </Modal>
            
            <Modal
                isOpen={isArchiveModalOpen}
                onClose={() => setIsArchiveModalOpen(false)}
                title="پایان دوره و بایگانی"
                footer={
                    <>
                         <button onClick={() => setIsArchiveModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">انصراف</button>
                         <button onClick={handleConfirmArchive} className="px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded-lg font-bold">تایید و بایگانی</button>
                    </>
                }
            >
                <div className="space-y-4">
                    <p className="text-sm text-slate-600">با بایگانی کردن دوره، محاسبه مصرف دان متوقف شده و این دوره به لیست بایگانی منتقل می‌شود.</p>
                    <div>
                         <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ پایان دوره</label>
                         <DatePicker id="archive-end-date" value={archiveFormData.endDate} onChange={(date) => setArchiveFormData({...archiveFormData, endDate: date})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">وزن نهایی کل مرغ‌ها (جهت محاسبه ضریب تبدیل)</label>
                        <input type="number" value={archiveFormData.finalChickenWeight || ''} onChange={(e) => setArchiveFormData({...archiveFormData, finalChickenWeight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" placeholder="اختیاری" />
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={isFeedModalOpen}
                onClose={() => setIsFeedModalOpen(false)}
                title="افزودن دان دستی / استثنائی"
                footer={
                    <>
                        <button onClick={() => setIsFeedModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">لغو</button>
                        <button onClick={handleConfirmFeed} className="px-4 py-2 bg-green-500 text-white hover:bg-green-600 rounded-lg">افزودن</button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">محصول</label>
                        <select value={feedFormData.productId} onChange={(e) => setFeedFormData({...feedFormData, productId: e.target.value})} className="w-full p-2 border rounded-lg">
                            {settings.products.filter(p => p.type === 'finishedGood').map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">وزن (کیلوگرم)</label>
                        <input type="number" value={feedFormData.weight || ''} onChange={(e) => setFeedFormData({...feedFormData, weight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">دلیل (مثلا: خرید آزاد)</label>
                        <input type="text" value={feedFormData.reason} onChange={(e) => setFeedFormData({...feedFormData, reason: e.target.value})} className="w-full p-2 border rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ</label>
                        <DatePicker id="feed-date" value={feedFormData.date} onChange={(date) => setFeedFormData({...feedFormData, date})} />
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={!!editingInvoice}
                onClose={() => { setEditingInvoice(null); setEditInvoiceForm(null); }}
                title="ویرایش حواله"
                footer={
                    <>
                        <button onClick={() => { setEditingInvoice(null); setEditInvoiceForm(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">لغو</button>
                        <button onClick={handleSaveInvoice} className="px-4 py-2 bg-blue-500 text-white hover:bg-blue-600 rounded-lg">ذخیره تغییرات</button>
                    </>
                }
            >
                {editInvoiceForm && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ</label>
                            <DatePicker id="edit-invoice-date" value={editInvoiceForm.date} onChange={(date) => setEditInvoiceForm({...editInvoiceForm, date})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">مرغدار</label>
                            <select 
                                value={editInvoiceForm.farmerId} 
                                onChange={(e) => setEditInvoiceForm({...editInvoiceForm, farmerId: e.target.value})} 
                                className="w-full p-2 border rounded-lg"
                            >
                                {dataService.getFarmers().filter(f => !f.isDeleted).map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                            <p className="text-xs text-red-500 mt-1">تغییر مرغدار باعث حذف این حواله از لیست دوره فعلی خواهد شد.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">محصول</label>
                            <select value={editInvoiceForm.productId} onChange={(e) => setEditInvoiceForm({...editInvoiceForm, productId: e.target.value})} className="w-full p-2 border rounded-lg">
                                {settings.products.filter(p => !p.isDeleted).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">وزن (کیلوگرم)</label>
                            <input type="number" value={editInvoiceForm.weight} onChange={(e) => setEditInvoiceForm({...editInvoiceForm, weight: parseFloat(e.target.value) || 0})} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">شماره حواله</label>
                            <input type="text" value={editInvoiceForm.invoiceNumber} onChange={(e) => setEditInvoiceForm({...editInvoiceForm, invoiceNumber: e.target.value})} className="w-full p-2 border rounded-lg" />
                        </div>
                    </div>
                )}
            </Modal>


            <summary className="list-none cursor-pointer select-none">
                <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                        <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg font-bold text-center min-w-[3.5rem] ${isArchived ? 'bg-slate-200 text-slate-500' : 'bg-sky-100 text-sky-700'}`}>
                                <span className="block text-xs font-normal opacity-70">{isArchived ? 'طول دوره' : 'سن گله'}</span>
                                <span className="text-xl">{toPersianNumerals(daysOfBrood)}</span>
                                <span className="text-xs font-normal opacity-70 block">روز</span>
                            </div>
                            <div>
                                {showFarmerName && <h3 className={`text-lg font-bold ${isArchived ? 'text-slate-500' : 'text-slate-800'}`}>{farmer.name} {isArchived && <span className="text-xs font-normal text-slate-400 border border-slate-300 rounded px-1">(بایگانی)</span>}</h3>}
                                <div className="text-sm text-slate-500 mt-1 flex gap-2">
                                    <span className="bg-slate-100 px-2 py-0.5 rounded">شروع: {formatDate(brood.startDate)}</span>
                                    {brood.endDate && <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded">پایان: {formatDate(brood.endDate)}</span>}
                                    <span className="bg-slate-100 px-2 py-0.5 rounded">{toPersianNumerals(brood.chickCount)} قطعه</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                             <button onClick={handlePrintBrood} className="p-2 hover:bg-slate-100 rounded-full text-emerald-600" title="چاپ گزارش تفصیلی">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
                                </svg>
                            </button>
                             <button onClick={(e) => { e.stopPropagation(); handleOpenEditModal(); }} className="p-2 hover:bg-slate-100 rounded-full text-blue-500" title="ویرایش">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                            </button>
                             <button onClick={(e) => { e.stopPropagation(); onDelete(brood.id); }} className="p-2 hover:bg-slate-100 rounded-full text-red-500" title="حذف">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            </button>
                            <span className="text-slate-300 group-open:rotate-180 transition-transform text-sm mr-2">▼</span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-slate-600 mb-1">
                            <span>پیشرفت مصرف سهمیه</span>
                            <span>
                                {toPersianNumerals(Math.round(progressPercentage))}% 
                                {' ('}
                                {totalRemaining < 0 
                                    ? <span className="text-red-500 font-bold">{toPersianNumerals(Math.abs(Math.round(totalRemaining)).toLocaleString())} kg اضافه</span>
                                    : <span>{toPersianNumerals(Math.round(totalRemaining).toLocaleString())} kg باقیمانده</span>
                                }
                                {')'}
                            </span>
                        </div>
                        <div className={`w-full rounded-full h-2.5 overflow-hidden ${isArchived ? 'bg-slate-200' : 'bg-slate-100'}`}>
                            <div className={`h-2.5 rounded-full ${isArchived ? 'bg-slate-400' : progressColor}`} style={{ width: `${Math.min(100, progressPercentage)}%` }}></div>
                        </div>
                    </div>
                    
                    <div className="flex justify-between text-sm mt-2 pt-2 border-t border-dashed">
                        <div className="text-center flex-1 border-l">
                            <span className="block text-xs text-slate-400">میانگین دان مصرفی</span>
                            <span className="font-bold text-slate-700">{toPersianNumerals(perCapitaConsumption)}</span> <span className="text-xs">گرم/قطعه</span>
                        </div>
                        <div className="text-center flex-1">
                            <span className="block text-xs text-slate-400">کل دان ارسالی</span>
                            <span className="font-bold text-slate-700">{toPersianNumerals(totalSentWeight.toLocaleString())}</span> <span className="text-xs">kg</span>
                        </div>
                    </div>
                </div>
            </summary>

            <div className="mt-6 space-y-6 animate-fade-in-up">
                
                {/* --- Section 1: Detailed Stats --- */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center bg-slate-50 p-4 rounded-lg">
                    <div><span className="block text-xs text-slate-500">جمع کل سهمیه</span><strong className="text-base text-slate-800">{toPersianNumerals(Math.round(totalQuota).toLocaleString())}</strong> <span className="text-xs">kg</span></div>
                    <div><span className="block text-xs text-slate-500">وزن نهایی مرغ</span><strong className="text-base text-slate-800">{brood.finalChickenWeight ? toPersianNumerals(brood.finalChickenWeight.toLocaleString()) : '-'}</strong> <span className="text-xs">kg</span></div>
                    <div><span className="block text-xs text-slate-500">ضریب تبدیل</span><strong className="text-base text-blue-700">{conversionRate ? toPersianNumerals(conversionRate) : '-'}</strong></div>
                    <div><span className="block text-xs text-slate-500">تاریخ تقریبی پایان</span><strong className="text-base text-slate-800">{brood.endDate ? formatDate(brood.endDate) : 'نامشخص'}</strong></div>
                </div>
                
                 {/* --- Archive Controls --- */}
                 {!isArchived ? (
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 flex items-center justify-between">
                         <div className="text-xs text-purple-800">
                             <p className="font-bold mb-1">اتمام دوره؟</p>
                             <p>برای محاسبه دقیق ضریب تبدیل و انتقال به بایگانی، دوره را ببندید.</p>
                         </div>
                         <button onClick={handleOpenArchiveModal} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 shadow-sm transition-colors">پایان دوره و بایگانی</button>
                    </div>
                 ) : (
                    <div className="bg-slate-100 p-4 rounded-lg border border-slate-200 flex items-center justify-between">
                         <div className="text-xs text-slate-600">
                             <p className="font-bold mb-1">این دوره بایگانی شده است.</p>
                             <p>اطلاعات فقط خواندنی هستند. برای ویرایش باید دوره را باز کنید.</p>
                         </div>
                         <button onClick={handleReopenBrood} className="bg-white text-slate-700 border border-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-200 transition-colors">بازگشایی مجدد</button>
                    </div>
                 )}

                {/* --- Section 2: Quota & Products --- */}
                <div>
                    <h5 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <span className={`w-1 h-4 rounded-full ${isArchived ? 'bg-slate-400' : 'bg-orange-500'}`}></span>
                        جزئیات سهمیه و ارسال
                        <span className="text-xs font-normal text-slate-400 mr-2">(برای مشاهده جزئیات روی هر محصول کلیک کنید)</span>
                    </h5>
                    <div className="grid grid-cols-1 gap-3">
                        {settings.products.filter(p => { if (p.type !== "finishedGood") return false; if ((sentData.get(p.id) || 0) > 0) return true; if (brood.activeProductsAtCreation) return brood.activeProductsAtCreation.includes(p.id); return !p.isDeleted; }).map((product, index) => {
                            const quota = (quotaMap.get(product.id) || 0) * brood.chickCount / 1000;
                            const sent = sentData.get(product.id) || 0;
                            const remaining = quota - sent;
                            const percent = quota > 0 ? (sent / quota) * 100 : 0;

                            const lastExit = relevantInvoices
                                .filter(inv => inv.productId === product.id)
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
                            
                            const isExpanded = expandedProductId === product.id;

                            // Filter invoices and manual feed for this product
                            const productInvoices = relevantInvoices
                                .filter(inv => inv.productId === product.id)
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                            
                            const productManualFeeds = (brood.exceptionalFeed || []).map((feed, idx) => ({ ...feed, originalIndex: idx }))
                                .filter(feed => feed.productId === product.id)
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                            // Phase Logic Calculation
                            const phaseInfo = getProductPhaseInfo(product.id, quota, sent);

                            return (
                                <div key={product.id} className={`border rounded-lg overflow-hidden shadow-sm transition-all ${isArchived ? 'bg-slate-50' : 'bg-white'}`}>
                                    <div 
                                        className={`p-3 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-100`}
                                        onClick={() => toggleProductDetails(product.id)}
                                    >
                                        <div className="w-full md:w-1/4 flex items-center gap-2">
                                            <span className={`transform transition-transform text-slate-400 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                                            <div>
                                                <p className="font-semibold text-sm">{product.name}</p>
                                                <div className="flex flex-col gap-1 mt-1">
                                                    <span className="text-xs text-slate-500">سهمیه: {toPersianNumerals(quota.toLocaleString())} kg</span>
                                                    <span className="text-xs text-blue-600 font-bold">ارسالی: {toPersianNumerals(sent.toLocaleString())} kg</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="w-full md:w-1/3 flex flex-col gap-1">
                                            <div className="flex justify-between text-xs">
                                                <span>{toPersianNumerals(Math.round(percent))}% ارسال شده</span>
                                                <span className={remaining < 0 ? 'text-red-500 font-bold' : 'text-slate-600'}>
                                                    {remaining < 0 
                                                        ? `${toPersianNumerals(Math.abs(Math.round(remaining)).toLocaleString())} kg اضافه` 
                                                        : `${toPersianNumerals(Math.round(remaining).toLocaleString())} kg مانده`
                                                    }
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-2">
                                                <div className={`h-2 rounded-full ${isArchived ? 'bg-slate-400' : (remaining < 0 ? 'bg-red-500' : 'bg-blue-500')}`} style={{ width: `${Math.min(100, percent)}%` }}></div>
                                            </div>
                                        </div>

                                        <div className="w-full md:w-auto text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded">
                                            {lastExit ? `آخرین بار: ${formatDate(lastExit.date)} (${toPersianNumerals(lastExit.weight)} kg)` : 'هنوز ارسال نشده'}
                                        </div>
                                    </div>

                                    {/* Detailed List Dropdown */}
                                    {isExpanded && (
                                        <div className="bg-slate-50 border-t p-3 text-sm animate-fade-in">
                                            
                                            {/* Daily Consumption Recommendation Block */}
                                            {quota > 0 && !isArchived && (
                                                <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 flex flex-wrap justify-between items-center text-xs md:text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-blue-800">نیاز روزانه این مرحله:</span>
                                                        <span className="bg-white px-2 py-1 rounded shadow-sm">{toPersianNumerals(Math.round(phaseInfo.dailyRecommended).toLocaleString())} کیلوگرم</span>
                                                    </div>
                                                    <div className={`mt-2 md:mt-0 font-semibold ${phaseInfo.statusColor}`}>
                                                        وضعیت: {phaseInfo.statusMessage}
                                                    </div>
                                                    {phaseInfo.remainingDays !== null && (
                                                        <div className="mt-2 md:mt-0 text-slate-600">
                                                            {toPersianNumerals(phaseInfo.remainingDays)} روز تا پایان این مرحله
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {productInvoices.length === 0 && productManualFeeds.length === 0 ? (
                                                <p className="text-center text-slate-400 py-2">هیچ ارسالی برای این محصول ثبت نشده است.</p>
                                            ) : (
                                                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                                                    <table className="w-full text-center text-xs">
                                                        <thead className="text-slate-500 border-b">
                                                            <tr>
                                                                <th className="pb-1 font-normal">نوع</th>
                                                                <th className="pb-1 font-normal">تاریخ</th>
                                                                <th className="pb-1 font-normal">وزن (kg)</th>
                                                                <th className="pb-1 font-normal">جزئیات</th>
                                                                {!isArchived && <th className="pb-1 font-normal">عملیات</th>}
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-200">
                                                            {productInvoices.map(inv => (
                                                                <tr key={inv.id} className="hover:bg-slate-100">
                                                                    <td className="py-2 text-slate-600">حواله</td>
                                                                    <td className="py-2">{formatDate(inv.date)}</td>
                                                                    <td className="py-2 font-bold">{toPersianNumerals(inv.weight)}</td>
                                                                    <td className="py-2 text-slate-500">#{toPersianNumerals(inv.invoiceNumber || inv.id.slice(-4))}</td>
                                                                    {!isArchived && (
                                                                        <td className="py-2 flex justify-center gap-1">
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); handleEditInvoiceClick(inv); }}
                                                                                className="text-blue-500 hover:bg-blue-100 p-1 rounded transition-colors"
                                                                                title="ویرایش"
                                                                            >
                                                                                ✎
                                                                            </button>
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); handleToggleInvoice(inv.id, 'exclude'); }} 
                                                                                className="text-red-500 hover:bg-red-100 p-1 rounded transition-colors"
                                                                                title="نادیده گرفتن این حواله"
                                                                            >
                                                                                ✕
                                                                            </button>
                                                                        </td>
                                                                    )}
                                                                </tr>
                                                            ))}
                                                            {productManualFeeds.map(feed => (
                                                                <tr key={`feed-${feed.originalIndex}`} className="hover:bg-orange-50 bg-orange-50/50">
                                                                    <td className="py-2 text-orange-600">دستی</td>
                                                                    <td className="py-2">{formatDate(feed.date)}</td>
                                                                    <td className="py-2 font-bold">{toPersianNumerals(feed.weight)}</td>
                                                                    <td className="py-2 text-slate-500">{feed.reason}</td>
                                                                    {!isArchived && (
                                                                        <td className="py-2">
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); handleDeleteFeed(feed.originalIndex); }} 
                                                                                className="text-red-500 hover:bg-red-100 p-1 rounded transition-colors"
                                                                                title="حذف دان دستی"
                                                                            >
                                                                                ✕
                                                                            </button>
                                                                        </td>
                                                                    )}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* --- Section 3: Management Tools (Hidden in Archive Mode) --- */}
                {!isArchived && (
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 border rounded-lg p-3">
                            <h6 className="font-semibold text-sm mb-2 text-slate-700">مدیریت حواله‌های ارسالی (کلی)</h6>
                            <div className="max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                                <ul className="text-xs space-y-1">
                                    {relevantInvoices.map(inv => (
                                        <li key={inv.id} className="flex justify-between items-center bg-slate-50 p-1 rounded hover:bg-slate-100">
                                            <span>{formatDate(inv.date)} - {productMap.get(inv.productId)} - {toPersianNumerals(inv.weight)}kg</span>
                                            <div className="flex items-center">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleEditInvoiceClick(inv); }}
                                                    className="text-blue-500 hover:bg-blue-100 p-1 rounded transition-colors mx-1"
                                                    title="ویرایش"
                                                >
                                                    ✎
                                                </button>
                                                <button onClick={() => handleToggleInvoice(inv.id, 'exclude')} className="text-red-500 hover:font-bold px-2">✕</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <button onClick={handleAddInvoice} className="w-full mt-2 text-xs bg-slate-100 text-slate-600 py-1.5 rounded hover:bg-slate-200">افزودن حواله جاافتاده</button>
                             {(brood.excludedInvoiceIds?.length || 0) > 0 && (
                                <div className="mt-2 pt-2 border-t">
                                    <p className="text-xs text-red-500 mb-1">حواله‌های نادیده گرفته شده:</p>
                                    <ul className="text-xs space-y-1">
                                        {brood.excludedInvoiceIds?.map(id => {
                                            const inv = allExits.find(e => e.id === id);
                                            if (!inv) return null;
                                            return (
                                                <li key={inv.id} className="flex justify-between items-center opacity-70">
                                                    <span>{formatDate(inv.date)} - {productMap.get(inv.productId)}</span>
                                                    <button onClick={() => handleToggleInvoice(inv.id, 'include')} className="text-green-600 text-[10px]">بازگردانی</button>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 border rounded-lg p-3">
                            <h6 className="font-semibold text-sm mb-2 text-slate-700">دان متفرقه / دستی (کلی)</h6>
                            <div className="max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                                 {(!brood.exceptionalFeed || brood.exceptionalFeed.length === 0) ? (
                                     <p className="text-xs text-slate-400 text-center py-4">موردی ثبت نشده است</p>
                                 ) : (
                                    <ul className="text-xs space-y-1">
                                        {(brood.exceptionalFeed || []).map((feed, index) => (
                                            <li key={index} className="flex justify-between items-center bg-orange-50 p-1 rounded border border-orange-100">
                                                <span>{formatDate(feed.date)} - {productMap.get(feed.productId)} - {toPersianNumerals(feed.weight)}kg</span>
                                                <button onClick={() => handleDeleteFeed(index)} className="text-red-500 hover:font-bold px-2">✕</button>
                                            </li>
                                        ))}
                                    </ul>
                                 )}
                            </div>
                            <button onClick={handleOpenFeedModal} className="w-full mt-2 text-xs bg-orange-100 text-orange-700 py-1.5 rounded hover:bg-orange-200">ثبت دان دستی</button>
                        </div>
                    </div>
                )}
            </div>
        </details>
    )
};

export default BroodDetailsCard;
