
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Farmer, Brood, Exit } from '../types';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatDate, formatToISODate } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import BroodDetailsCard from '../components/BroodDetailsCard';
import Modal from '../components/Modal';
import DatePicker from '../components/DatePicker';
import Swal from 'sweetalert2';

const FarmersPage: React.FC = () => {
    const [farmers, setFarmers] = useState<Farmer[]>([]);
    const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null);
    const [allExits, setAllExits] = useState<Exit[]>([]);
    const [showHiddenFarmers, setShowHiddenFarmers] = useState(false);
    const [selectedFarmerIdsForBulk, setSelectedFarmerIdsForBulk] = useState<Set<string>>(new Set());
    
    // Add Brood Modal State
    const [isAddBroodModalOpen, setIsAddBroodModalOpen] = useState(false);
    const [newBroodStartDate, setNewBroodStartDate] = useState(new Date());
    const [newBroodChickCount, setNewBroodChickCount] = useState<number>(0);
    const [newBroodStartInvoiceId, setNewBroodStartInvoiceId] = useState('');

    const { settings, productMap } = useSettings();

    const fetchData = useCallback(() => {
        const farmersData = dataService.getFarmers();
        setFarmers(farmersData);
        setAllExits(dataService.getAllInvoices().filter(i => 'farmerId' in i) as Exit[]);
        
        if (selectedFarmer) {
            setSelectedFarmer(farmersData.find(f => f.id === selectedFarmer.id) || null);
        } else if (farmersData.length > 0) {
            const firstVisibleFarmer = farmersData.find(f => !f.isHidden);
            setSelectedFarmer(firstVisibleFarmer || farmersData[0]);
        }
    }, [selectedFarmer]);

    useEffect(() => {
        fetchData();
    }, []);

    const handleSaveFarmers = async (updatedFarmers: Farmer[], logActionType?: 'created' | 'updated' | 'deleted', farmerForLog?: Farmer) => {
        dataService.saveFarmers(updatedFarmers);
        if (logActionType && farmerForLog) {
            await dataService.logAction(logActionType, 'farmer', farmerForLog);
        }
        fetchData();
    };

    const handleAddFarmer = () => {
        Swal.fire({
            title: 'افزودن مرغدار جدید',
            input: 'text',
            inputLabel: 'نام مرغدار',
            inputPlaceholder: 'نام کامل را وارد کنید',
            showCancelButton: true,
            confirmButtonText: 'افزودن',
            cancelButtonText: 'لغو',
            preConfirm: (name: string) => {
                if (!name) {
                    Swal.showValidationMessage('نام مرغدار نمی‌تواند خالی باشد');
                }
                return name;
            }
        }).then((result: any) => {
            if (result.isConfirmed) {
                const newFarmer: Farmer = {
                    id: `farmer_${Date.now()}`,
                    name: result.value,
                    broods: [],
                };
                const updatedFarmers = [...farmers, newFarmer];
                handleSaveFarmers(updatedFarmers, 'created', newFarmer);
                showToast('مرغدار جدید با موفقیت اضافه شد');
            }
        });
    };

    const handleEditFarmer = (farmer: Farmer) => {
        Swal.fire({
            title: 'ویرایش نام مرغدار',
            input: 'text',
            inputLabel: 'نام جدید',
            inputValue: farmer.name,
            showCancelButton: true,
            confirmButtonText: 'ذخیره',
            cancelButtonText: 'لغو',
        }).then((result: any) => {
            if (result.isConfirmed) {
                const updatedFarmers = farmers.map(f => f.id === farmer.id ? { ...f, name: result.value } : f);
                handleSaveFarmers(updatedFarmers, 'updated', { ...farmer, name: result.value });
                showToast('نام مرغدار ویرایش شد');
            }
        });
    };

    const handleDeleteFarmer = (farmer: Farmer) => {
        Swal.fire({
            title: `آیا از حذف ${farmer.name} مطمئن هستید؟`,
            text: 'این مرغدار از لیست فعال حذف خواهد شد، اما سوابق قبلی او باقی می‌ماند.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو',
        }).then((result: any) => {
            if (result.isConfirmed) {
                const updatedFarmers = farmers.map(f => f.id === farmer.id ? { ...f, isDeleted: true } : f);
                handleSaveFarmers(updatedFarmers, 'updated', farmer);
                setSelectedFarmer(null);
                showToast('مرغدار با موفقیت حذف شد');
            }
        });
    };

    const handleBulkDeleteFarmers = () => {
        if (selectedFarmerIdsForBulk.size === 0) return;
        Swal.fire({
            title: `آیا از حذف ${selectedFarmerIdsForBulk.size} مرغدار مطمئن هستید؟`,
            text: 'این مرغداران از لیست فعال حذف خواهند شد، اما سوابق قبلی آن‌ها باقی می‌ماند.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو',
        }).then((result: any) => {
            if (result.isConfirmed) {
                const updatedFarmers = farmers.map(f => selectedFarmerIdsForBulk.has(f.id) ? { ...f, isDeleted: true } : f);
                handleSaveFarmers(updatedFarmers);
                setSelectedFarmer(null);
                setSelectedFarmerIdsForBulk(new Set());
                showToast(`${selectedFarmerIdsForBulk.size} مرغدار با موفقیت حذف شدند`);
            }
        });
    };
    
    const handleToggleFarmerVisibility = (farmerId: string) => {
        const updatedFarmers = farmers.map(f =>
            f.id === farmerId ? { ...f, isHidden: !f.isHidden } : f
        );
        handleSaveFarmers(updatedFarmers);
    };

    const filteredFarmers = useMemo(() => {
        let list = farmers.filter(f => !f.isDeleted);
        if (showHiddenFarmers) return list;
        return list.filter(f => !f.isHidden);
    }, [farmers, showHiddenFarmers]);


    const handleOpenAddBroodModal = () => {
        if (!selectedFarmer) return;
        setNewBroodStartDate(new Date());
        setNewBroodChickCount(0);
        setNewBroodStartInvoiceId('');
        setIsAddBroodModalOpen(true);
    };

    const handleConfirmAddBrood = () => {
        if (!selectedFarmer) return;
        if (!newBroodChickCount || newBroodChickCount <= 0) {
            showToast('تعداد جوجه باید عدد مثبت باشد', 'error');
            return;
        }

        const newBrood: Brood = {
            id: `brood_${Date.now()}`,
            startDate: formatToISODate(newBroodStartDate),
            chickCount: newBroodChickCount,
            startInvoiceId: newBroodStartInvoiceId || undefined,
            exceptionalFeed: [],
            activeProductsAtCreation: settings.products.filter(p => p.type === 'finishedGood' && !p.isDeleted).map(p => p.id)
        };
        const updatedFarmers = farmers.map(f => 
            f.id === selectedFarmer.id 
                ? { ...f, broods: [...f.broods, newBrood].sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()) } 
                : f
        );
        handleSaveFarmers(updatedFarmers, 'updated', selectedFarmer);
        showToast('دوره جدید با موفقیت ثبت شد');
        setIsAddBroodModalOpen(false);
    };
    
    const handleUpdateBrood = (updatedBrood: Brood) => {
        if (!selectedFarmer) return;
         const updatedFarmers = farmers.map(f => {
            if (f.id === selectedFarmer.id) {
                return {
                    ...f,
                    broods: f.broods.map(b => b.id === updatedBrood.id ? updatedBrood : b)
                };
            }
            return f;
        });
        handleSaveFarmers(updatedFarmers, 'updated', selectedFarmer);
        showToast('اطلاعات دوره به‌روزرسانی شد');
    };
    
    const handleDeleteBrood = (broodId: string) => {
        if (!selectedFarmer) return;

        Swal.fire({
            title: 'آیا از حذف این دوره مطمئن هستید؟',
            text: 'این عملیات غیرقابل بازگشت است.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو'
        }).then((result: any) => {
            if (result.isConfirmed) {
                const updatedFarmers = farmers.map(f => {
                    if (f.id === selectedFarmer.id) {
                        return { ...f, broods: f.broods.filter(b => b.id !== broodId) };
                    }
                    return f;
                });
                handleSaveFarmers(updatedFarmers, 'updated', selectedFarmer); 
                showToast('دوره با موفقیت حذف شد.');
            }
        });
    };

    const FarmerListItem: React.FC<{ farmer: Farmer }> = ({ farmer }) => {
        const lastExit = useMemo(() => {
            return allExits
                .filter(e => e.farmerId === farmer.id)
                .sort((a, b) => b.createdAt - a.createdAt)[0];
        }, [farmer.id, allExits]);

        return (
            <li 
                onClick={() => setSelectedFarmer(farmer)}
                className={`p-3 rounded-lg cursor-pointer mb-1 ${selectedFarmer?.id === farmer.id ? 'bg-sky-100' : 'hover:bg-slate-50'}`}
            >
               <div className="flex justify-between items-start">
                   <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer"
                            checked={selectedFarmerIdsForBulk.has(farmer.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                                const newSet = new Set(selectedFarmerIdsForBulk);
                                if (e.target.checked) newSet.add(farmer.id);
                                else newSet.delete(farmer.id);
                                setSelectedFarmerIdsForBulk(newSet);
                            }}
                        />
                        <div>
                            <span className="font-semibold">{farmer.name}</span>
                            {lastExit && (
                                <p className="text-xs text-slate-500 mt-1">
                                    آخرین ارسال: {productMap.get(lastExit.productId)} در تاریخ {formatDate(lastExit.date)}
                                </p>
                            )}
                        </div>
                   </div>
                   <div className="flex items-center gap-3 text-slate-500">
                        <button onClick={(e) => { e.stopPropagation(); handleToggleFarmerVisibility(farmer.id); }} title={farmer.isHidden ? 'نمایش' : 'مخفی کردن'}>
                            {farmer.isHidden ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}
                        </button>
                       <button onClick={(e) => {e.stopPropagation(); handleEditFarmer(farmer);}} className="text-xs text-blue-500 hover:font-bold">ویرایش</button>
                       <button onClick={(e) => {e.stopPropagation(); handleDeleteFarmer(farmer);}} className="text-xs text-red-500 hover:font-bold">حذف</button>
                   </div>
               </div>
            </li>
        );
    };

    // Prepare invoice options for modal
    const farmerExitsForModal = useMemo(() => {
        if (!selectedFarmer) return [];
        return allExits
            .filter(e => e.farmerId === selectedFarmer.id)
            .sort((a, b) => b.createdAt - a.createdAt);
    }, [selectedFarmer, allExits]);


    return (
        <div className="flex h-full gap-6">
             <Modal
                isOpen={isAddBroodModalOpen}
                onClose={() => setIsAddBroodModalOpen(false)}
                title={`ثبت دوره جدید برای ${selectedFarmer?.name}`}
                footer={
                    <>
                        <button onClick={() => setIsAddBroodModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">لغو</button>
                        <button onClick={handleConfirmAddBrood} className="px-4 py-2 bg-green-500 text-white hover:bg-green-600 rounded-lg">ثبت دوره</button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تاریخ شروع جوجه‌ریزی</label>
                        <DatePicker id="new-brood-start-date" value={newBroodStartDate} onChange={setNewBroodStartDate} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تعداد جوجه</label>
                        <input 
                            type="number" 
                            className="w-full p-2 border rounded-lg"
                            value={newBroodChickCount || ''}
                            onChange={e => setNewBroodChickCount(parseInt(e.target.value) || 0)}
                            placeholder="تعداد جوجه"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">حواله شروع دوره (اختیاری)</label>
                        <select 
                            className="w-full p-2 border rounded-lg"
                            value={newBroodStartInvoiceId}
                            onChange={e => setNewBroodStartInvoiceId(e.target.value)}
                        >
                            <option value="">محاسبه بر اساس تاریخ شروع</option>
                            {farmerExitsForModal.map(exit => (
                                <option key={exit.id} value={exit.id}>
                                    {formatDate(exit.date)} - #{toPersianNumerals(exit.invoiceNumber || exit.id.slice(-4))} - {productMap.get(exit.productId)}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-slate-500 mt-1">با انتخاب یک حواله، تمام ارسال‌های بعد از آن به طور خودکار برای این دوره محاسبه می‌شود.</p>
                    </div>
                </div>
            </Modal>

            <div className="w-1/3 bg-white p-4 rounded-xl shadow-md flex flex-col">
                <div className="flex justify-between items-center mb-2 pb-2 border-b">
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer"
                            checked={selectedFarmerIdsForBulk.size === filteredFarmers.length && filteredFarmers.length > 0}
                            onChange={(e) => {
                                if (e.target.checked) {
                                    setSelectedFarmerIdsForBulk(new Set(filteredFarmers.map(f => f.id)));
                                } else {
                                    setSelectedFarmerIdsForBulk(new Set());
                                }
                            }}
                            title="انتخاب همه"
                        />
                        <h2 className="text-xl font-bold text-slate-700">مرغداران</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        {selectedFarmerIdsForBulk.size > 0 && (
                            <button onClick={handleBulkDeleteFarmers} className="text-xs text-red-500 hover:font-bold">حذف ({selectedFarmerIdsForBulk.size})</button>
                        )}
                        <button onClick={() => setShowHiddenFarmers(!showHiddenFarmers)} className="text-xs text-slate-600 hover:text-black">
                            {showHiddenFarmers ? 'نمایش فعال‌ها' : 'نمایش همه'}
                        </button>
                        <button onClick={handleAddFarmer} className="bg-sky-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-sky-600">+</button>
                    </div>
                </div>
                <ul className="overflow-y-auto flex-grow">
                    {filteredFarmers.map(farmer => <FarmerListItem key={farmer.id} farmer={farmer} />)}
                </ul>
            </div>

            <div className="w-2/3 bg-white p-5 rounded-xl shadow-md overflow-y-auto">
                {selectedFarmer ? (
                    <div>
                         <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-slate-800">{selectedFarmer.name}</h2>
                            <button onClick={handleOpenAddBroodModal} className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">ثبت دوره جوجه‌ریزی جدید</button>
                        </div>
                        <div className="space-y-4">
                            {selectedFarmer.broods.length === 0 ? (
                                <p className="text-center text-slate-500 pt-10">هنوز دوره‌ای برای این مرغدار ثبت نشده است.</p>
                            ) : (
                                selectedFarmer.broods.map(brood => (
                                    <BroodDetailsCard 
                                        key={brood.id} 
                                        farmer={selectedFarmer} 
                                        brood={brood} 
                                        allExits={allExits} 
                                        onUpdate={handleUpdateBrood} 
                                        onDelete={handleDeleteBrood} 
                                        isArchived={!!brood.endDate}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-slate-500">یک مرغدار را از لیست انتخاب کنید یا یک مرغدار جدید اضافه کنید.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const EyeIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const EyeSlashIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
);

export default FarmersPage;
