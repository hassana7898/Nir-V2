
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { Settings, Product, Farmer } from '../types';
import { showToast, fileToBase64 } from '../utils/helpers';
import * as dataService from '../services/dataService';
import * as authService from '../services/authService';
import { toPersianNumerals } from '../utils/formatters';
import { useAuth } from '../contexts/AuthContext';
import Swal from 'sweetalert2';
import Sortable from 'sortablejs';

const DragHandleIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
);

const SettingsPage: React.FC = () => {
    const { settings: initialSettings, saveSettings: saveSettingsContext, loadSettings } = useSettings();
    const { logout } = useAuth();
    const [formState, setFormState] = useState<Settings>(initialSettings);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialSettings.factoryLogo);
    const productListRef = useRef<HTMLDivElement>(null);

    // State for driver management
    const [drivers, setDrivers] = useState<string[]>([]);
    const [newDriverNameInput, setNewDriverNameInput] = useState('');
    const [selectedDriversForBulk, setSelectedDriversForBulk] = useState<Set<string>>(new Set());

    // State for data cleanup
    const [selectedDriver, setSelectedDriver] = useState('');
    const [newDriverName, setNewDriverName] = useState('');
    const [farmers, setFarmers] = useState<Farmer[]>([]);
    const [selectedFarmerId, setSelectedFarmerId] = useState('');
    const [newFarmerName, setNewFarmerName] = useState('');
    const [sourceFarmerId, setSourceFarmerId] = useState('');
    const [targetFarmerId, setTargetFarmerId] = useState('');
    
    // State for Product Merge
    const [sourceProductId, setSourceProductId] = useState('');
    const [targetProductId, setTargetProductId] = useState('');
    // State for Driver Merge
    const [sourceDriverName, setSourceDriverName] = useState('');
    const [targetDriverName, setTargetDriverName] = useState('');


    // State for password change
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');


    const finishedGoods = useMemo(() => {
        return formState.products.filter(p => p.type === 'finishedGood' && !p.isDeleted);
    }, [formState.products]);

    const refreshPageData = () => {
        // For driver management and data cleanup
        const managedDrivers = dataService.getDrivers();
        setDrivers(managedDrivers);
        if (managedDrivers.length > 0) {
            if (!managedDrivers.includes(selectedDriver)) setSelectedDriver(managedDrivers[0]);
            if (!managedDrivers.includes(sourceDriverName)) setSourceDriverName(managedDrivers[0]);
            if (!managedDrivers.includes(targetDriverName)) setTargetDriverName(managedDrivers[1] || managedDrivers[0]);
        }
    
        // For farmer cleanup section
        const farmersData = dataService.getFarmers();
        setFarmers(farmersData);
        if (farmersData.length > 0) {
            if (!farmersData.some(f => f.id === selectedFarmerId)) {
                setSelectedFarmerId(farmersData[0].id);
                setNewFarmerName(farmersData[0].name);
            }
            // Reset merge dropdowns after data change
            setSourceFarmerId(farmersData[0]?.id || '');
            setTargetFarmerId(farmersData[1]?.id || farmersData[0]?.id || '');

        } else {
            // Clear farmer related states if no farmers
            setSelectedFarmerId('');
            setNewFarmerName('');
            setSourceFarmerId('');
            setTargetFarmerId('');
        }
        
        // Reset Product Merge Dropdowns
        if (formState.products.length > 0) {
            setSourceProductId(formState.products[0].id);
            setTargetProductId(formState.products[1]?.id || formState.products[0].id);
        }
    };

    useEffect(() => {
        setFormState(initialSettings);
        setLogoPreview(initialSettings.factoryLogo);
        refreshPageData();
    }, [initialSettings]);

    useEffect(() => {
        if (productListRef.current) {
            Sortable.create(productListRef.current, {
                animation: 150,
                handle: '.drag-handle',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                onEnd: (evt) => {
                    if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
                    
                    setFormState(prev => {
                        const visibleProducts = prev.products.filter(p => !p.isDeleted);
                        const deletedProducts = prev.products.filter(p => p.isDeleted);
                        
                        const [movedItem] = visibleProducts.splice(evt.oldIndex!, 1);
                        visibleProducts.splice(evt.newIndex!, 0, movedItem);
                        
                        return { ...prev, products: [...visibleProducts, ...deletedProducts] };
                    });
                },
            });
        }
    }, []);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleSignatureChange = (type: 'entry' | 'exit', index: number, value: string, isName: boolean = false) => {
        const key = type === 'entry' ? (isName ? 'entrySignatureNames' : 'entrySignatures') : (isName ? 'exitSignatureNames' : 'exitSignatures');
        const currentArr = formState[key] || ["", "", "", ""];
        const newArr = [...currentArr];
        newArr[index] = value;
        setFormState(prev => ({ ...prev, [key]: newArr }));
    };
    
    const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await fileToBase64(file);
                setLogoPreview(base64);
                setFormState(prev => ({ ...prev, factoryLogo: base64 }));
            } catch (error) {
                showToast('خطا در بارگذاری لوگو', 'error');
            }
        }
    };

    const handleSave = () => {
        saveSettingsContext(formState);
        showToast('تنظیمات با موفقیت ذخیره شد.');
    };
    
    const handleEditProduct = async (product: Product) => {
        const { value: newName } = await Swal.fire({
            title: 'ویرایش محصول',
            input: 'text',
            inputValue: product.name,
            text: 'توجه: برای حفظ یکپارچگی سوابق گذشته، نام قبلی در سوابق حفظ می‌شود و این نام جدید برای حواله‌های جدید استفاده خواهد شد.',
            showCancelButton: true,
            confirmButtonText: 'ذخیره',
            cancelButtonText: 'لغو',
            inputValidator: (value) => {
                if (!value || !value.trim()) return 'نام محصول نمی‌تواند خالی باشد';
            }
        });

        if (newName && newName.trim() !== product.name) {
            setFormState(prev => {
                // Soft delete the old product
                const newProducts = prev.products.map(p => p.id === product.id ? { ...p, isDeleted: true } : p);
                
                // Create a new product with the new name
                const newProduct: Product = {
                    id: `prod_${Date.now()}`,
                    name: newName.trim(),
                    type: product.type
                };
                newProducts.push(newProduct);

                let newQuotas = [...(prev.feedQuotas || [])];
                const oldQuotaIndex = newQuotas.findIndex(q => q.productId === product.id);
                if (oldQuotaIndex > -1) {
                    newQuotas.push({ productId: newProduct.id, quotaPerChick: newQuotas[oldQuotaIndex].quotaPerChick });
                }

                let newDurations = { ...(prev.productPhaseDurations || {}) };
                if (newDurations[product.id]) {
                    newDurations[newProduct.id] = newDurations[product.id];
                }

                return { ...prev, products: newProducts, feedQuotas: newQuotas, productPhaseDurations: newDurations };
            });
            showToast('نام محصول تغییر یافت. سوابق قبلی با همان نام حفظ شدند.');
        }
    };

    const handleProductTypeChange = (id: string, type: ProductType) => {
        setFormState(prev => ({
            ...prev,
            products: prev.products.map(p => p.id === id ? { ...p, type } : p)
        }));
    };
    
    const handleAddProduct = async () => {
        const { value: newName } = await Swal.fire({
            title: 'نام محصول جدید',
            input: 'text',
            showCancelButton: true,
            confirmButtonText: 'افزودن',
            cancelButtonText: 'لغو',
            inputValidator: (value) => {
                if (!value || !value.trim()) return 'نام محصول نمی‌تواند خالی باشد';
            }
        });

        if (newName && newName.trim()) {
            const newProduct: Product = {
                id: `prod_${Date.now()}`,
                name: newName.trim(),
                type: 'rawMaterial'
            };
            setFormState(prev => ({...prev, products: [...prev.products, newProduct]}));
        }
    };
    
    const handleRemoveProduct = (id: string) => {
        Swal.fire({
            title: 'آیا مطمئن هستید؟',
            text: 'این محصول از لیست انتخاب حذف می‌شود اما در سوابق قبلی باقی می‌ماند.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو'
        }).then((result: any) => {
            if (result.isConfirmed) {
                setFormState(prev => ({
                    ...prev, 
                    products: prev.products.map(p => p.id === id ? { ...p, isDeleted: true } : p)
                }));
            }
        });
    };
    
    const handleQuotaChange = (productId: string, value: string) => {
        const newQuotas = [...(formState.feedQuotas || [])];
        const quotaIndex = newQuotas.findIndex(q => q.productId === productId);
        const quotaValue = parseInt(value, 10) || 0;

        if (quotaIndex > -1) {
            newQuotas[quotaIndex].quotaPerChick = quotaValue;
        } else {
            newQuotas.push({ productId, quotaPerChick: quotaValue });
        }
        setFormState(prev => ({ ...prev, feedQuotas: newQuotas }));
    };

    const handleDurationChange = (productId: string, value: string) => {
        const durationValue = parseInt(value, 10) || 0;
        setFormState(prev => ({
            ...prev,
            productPhaseDurations: {
                ...(prev.productPhaseDurations || {}),
                [productId]: durationValue
            }
        }));
    };

    const handleTotalDaysChange = (value: string) => {
        const days = parseInt(value, 10) || 0;
        setFormState(prev => ({ ...prev, totalBroodDays: days }));
    };

    const handleAddDriver = async () => {
        const trimmedName = newDriverNameInput.trim();
        if (!trimmedName) {
            showToast('نام راننده نمی‌تواند خالی باشد.', 'warning');
            return;
        }
        if (drivers.includes(trimmedName)) {
            showToast('این راننده قبلا اضافه شده است.', 'info');
            return;
        }
        await dataService.addDriver(trimmedName);
        showToast(`راننده '${trimmedName}' اضافه شد.`);
        setNewDriverNameInput('');
        refreshPageData();
    };

    const handleDeleteDriver = async (name: string) => {
        const result = await Swal.fire({
            title: `حذف راننده '${name}'`,
            text: `آیا مطمئن هستید؟ این راننده از لیست پیشنهادات حذف می‌شود اما در حواله‌های قبلی باقی می‌ماند.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو'
        });

        if (result.isConfirmed) {
            await dataService.deleteDriver(name);
            showToast(`راننده '${name}' حذف شد.`);
            refreshPageData();
        }
    };

    const handleBulkDeleteDrivers = async () => {
        if (selectedDriversForBulk.size === 0) return;
        const result = await Swal.fire({
            title: `حذف ${selectedDriversForBulk.size} راننده`,
            text: `آیا مطمئن هستید؟ این رانندگان از لیست پیشنهادات حذف می‌شوند اما در حواله‌های قبلی باقی می‌مانند.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، حذف کن',
            cancelButtonText: 'لغو'
        });

        if (result.isConfirmed) {
            await dataService.deleteDrivers(Array.from(selectedDriversForBulk));
            showToast(`${selectedDriversForBulk.size} راننده حذف شدند.`);
            setSelectedDriversForBulk(new Set());
            refreshPageData();
        }
    };


    const handleExport = () => {
        try {
            const jsonData = dataService.exportData();
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-havaleh-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('فایل پشتیبان با موفقیت دانلود شد.');
        } catch (error) {
            Swal.fire('خطا', 'خطایی در هنگام تهیه فایل پشتیبان رخ داد.', 'error');
        }
    };
    
    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const jsonData = event.target?.result as string;
                Swal.fire({
                    title: 'آیا مطمئن هستید؟',
                    html: `این عملیات تمام اطلاعات فعلی شما را <strong class="text-red-500">حذف</strong> و با اطلاعات فایل پشتیبان جایگزین می‌کند. این عمل غیرقابل بازگشت است.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'بله، جایگزین کن!',
                    cancelButtonText: 'انصراف'
                }).then((result) => {
                    if (result.isConfirmed) {
                        dataService.importData(jsonData);
                        Swal.fire({
                            title: 'موفق',
                            text: 'اطلاعات با موفقیت بازیابی شد. برنامه مجددا بارگذاری می‌شود...',
                            icon: 'success',
                            timer: 2000,
                            timerProgressBar: true,
                            showConfirmButton: false,
                        }).then(() => {
                            // After import, reload to apply all new data
                            window.location.reload();
                        });
                    }
                });
            } catch (error) {
                 Swal.fire('خطا', 'فایل پشتیبان نامعتبر است.', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    };

    const handleDriverRename = async () => {
        if (!selectedDriver || !newDriverName.trim()) {
            showToast('لطفا نام راننده و نام جدید را مشخص کنید.', 'warning');
            return;
        }
        if (selectedDriver === newDriverName.trim()) {
            showToast('نام جدید نمی‌تواند با نام فعلی یکسان باشد.', 'info');
            return;
        }
        const result = await Swal.fire({
            title: 'تایید عملیات',
            html: `آیا از تغییر نام راننده <strong class="text-blue-600">"${selectedDriver}"</strong> به <strong class="text-green-600">"${newDriverName.trim()}"</strong> در تمام حواله‌ها مطمئن هستید؟ این عملیات غیرقابل بازگشت است.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'بله، تغییر بده',
            cancelButtonText: 'لغو'
        });
        if (result.isConfirmed) {
            const count = await dataService.renameDriver(selectedDriver, newDriverName);
            showToast(`${toPersianNumerals(count)} مورد با موفقیت به‌روزرسانی شد.`);
            refreshPageData();
            setNewDriverName('');
        }
    };

    const handleFarmerRename = async () => {
        if (!selectedFarmerId || !newFarmerName.trim()) {
            showToast('لطفا مرغدار و نام جدید را مشخص کنید.', 'warning');
            return;
        }
        const selectedFarmer = farmers.find(f => f.id === selectedFarmerId);
        if (selectedFarmer && selectedFarmer.name === newFarmerName.trim()) {
             showToast('نام جدید نمی‌تواند با نام فعلی یکسان باشد.', 'info');
            return;
        }
         const result = await Swal.fire({
            title: 'تایید عملیات',
            html: `آیا از تغییر نام مرغدار <strong class="text-blue-600">"${selectedFarmer?.name}"</strong> به <strong class="text-green-600">"${newFarmerName.trim()}"</strong> مطمئن هستید؟`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'بله، تغییر بده',
            cancelButtonText: 'لغو'
        });
        if (result.isConfirmed) {
            await dataService.renameFarmer(selectedFarmerId, newFarmerName);
            showToast(`نام مرغدار با موفقیت به‌روزرسانی شد.`);
            refreshPageData();
        }
    };

    const handleFarmerMerge = async () => {
        if (!sourceFarmerId || !targetFarmerId) {
            showToast('لطفا هر دو مرغدار را انتخاب کنید.', 'warning');
            return;
        }
        if (sourceFarmerId === targetFarmerId) {
            showToast('مرغدار مبدا و مقصد نمی‌توانند یکسان باشند.', 'warning');
            return;
        }
        
        const sourceFarmer = farmers.find(f => f.id === sourceFarmerId);
        const targetFarmer = farmers.find(f => f.id === targetFarmerId);

        if (!sourceFarmer || !targetFarmer) {
            showToast('مرغدار یافت نشد.', 'error');
            return;
        }

        const result = await Swal.fire({
            title: 'تایید عملیات ادغام',
            html: `
                <div class="text-right">
                    <p>شما در حال ادغام مرغدار هستید:</p>
                    <p class="my-2">
                        <strong class="text-red-600">"${sourceFarmer.name}"</strong> (حذف خواهد شد)
                    </p>
                    <p>در</p>
                    <p class="my-2">
                        <strong class="text-green-600">"${targetFarmer.name}"</strong> (باقی می‌ماند)
                    </p>
                    <p class="mt-4">تمام حواله‌ها و دوره‌های جوجه‌ریزی از مرغدار اول به دوم منتقل می‌شود. <strong>این عملیات غیرقابل بازگشت است.</strong></p>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، ادغام کن',
            cancelButtonText: 'لغو'
        });

        if (result.isConfirmed) {
            try {
                const { invoiceCount } = await dataService.mergeFarmers(sourceFarmerId, targetFarmerId);
                showToast(`ادغام با موفقیت انجام شد. ${toPersianNumerals(invoiceCount)} حواله منتقل شد.`);
                refreshPageData();
            } catch(e) {
                console.error(e);
                showToast('خطا در هنگام ادغام.', 'error');
            }
        }
    };
    
    const handleProductMerge = async () => {
        if (!sourceProductId || !targetProductId) {
            showToast('لطفا هر دو محصول را انتخاب کنید.', 'warning');
            return;
        }
        if (sourceProductId === targetProductId) {
            showToast('محصول مبدا و مقصد نمی‌توانند یکسان باشند.', 'warning');
            return;
        }
        
        const sourceProduct = formState.products.find(p => p.id === sourceProductId);
        const targetProduct = formState.products.find(p => p.id === targetProductId);

        if (!sourceProduct || !targetProduct) return;

        const result = await Swal.fire({
            title: 'تایید ادغام محصول',
            html: `
                <div class="text-right">
                    <p>آیا مطمئن هستید که می‌خواهید محصول:</p>
                    <p class="my-2 text-red-600 font-bold">"${sourceProduct.name}"</p>
                    <p>را در محصول زیر ادغام کنید؟</p>
                    <p class="my-2 text-green-600 font-bold">"${targetProduct.name}"</p>
                    <p class="text-sm mt-3 text-red-500">توجه: محصول مبدا حذف شده و تمام سوابق تولید، انبار و فرمول‌ها به محصول مقصد منتقل می‌شود.</p>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، ادغام کن',
            cancelButtonText: 'لغو'
        });

        if (result.isConfirmed) {
            await dataService.mergeProducts(sourceProductId, targetProductId);
            loadSettings(); // Reload settings context
            refreshPageData();
            showToast('محصولات با موفقیت ادغام شدند.');
        }
    };

    const handleDriverMerge = async () => {
        if (!sourceDriverName || !targetDriverName) {
            showToast('لطفا هر دو راننده را انتخاب کنید.', 'warning');
            return;
        }
        if (sourceDriverName === targetDriverName) {
            showToast('راننده مبدا و مقصد نمی‌توانند یکسان باشند.', 'warning');
            return;
        }

        const result = await Swal.fire({
            title: 'تایید ادغام راننده',
            html: `
                <div class="text-right">
                    <p>آیا مطمئن هستید که می‌خواهید سوابق:</p>
                    <p class="my-2 text-red-600 font-bold">"${sourceDriverName}"</p>
                    <p>را به نام زیر منتقل کنید؟</p>
                    <p class="my-2 text-green-600 font-bold">"${targetDriverName}"</p>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'بله، ادغام کن',
            cancelButtonText: 'لغو'
        });

        if (result.isConfirmed) {
            const count = await dataService.mergeDrivers(sourceDriverName, targetDriverName);
            refreshPageData();
            showToast(`${toPersianNumerals(count)} حواله به‌روزرسانی و رانندگان ادغام شدند.`);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 4) {
            showToast('رمز عبور جدید باید حداقل ۴ کاراکتر باشد.', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showToast('رمزهای عبور جدید یکسان نیستند.', 'error');
            return;
        }

        const isVerified = await authService.verifyPassword(currentPassword);
        if (!isVerified) {
            showToast('رمز عبور فعلی اشتباه است.', 'error');
            return;
        }

        await authService.setPassword(newPassword);
        showToast('رمز عبور با موفقیت تغییر کرد.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
    };

    
    useEffect(() => {
        const farmer = farmers.find(f => f.id === selectedFarmerId);
        if (farmer) setNewFarmerName(farmer.name);
    }, [selectedFarmerId, farmers]);


    return (
        <div className="bg-white p-5 rounded-xl shadow-md">
            <h1 className="text-2xl font-bold text-slate-700 mb-6">تنظیمات نرم‌افزار</h1>
            <div className="space-y-8">
                <div>
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">اطلاعات کارخانه و چاپ</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block mb-1 text-sm font-medium">نام کارخانه</label>
                            <input type="text" name="factoryName" value={formState.factoryName} onChange={handleChange} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div className="flex flex-col">
                             <label className="block mb-1 text-sm font-medium">انتخاب لوگو (محلی)</label>
                             <input type="file" accept="image/*" onChange={handleLogoChange} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"/>
                             {logoPreview && <img src={logoPreview} alt="پیش‌نمایش لوگو" className="mt-2 h-16 w-auto rounded-md border p-1" />}
                             <p className="text-xs text-slate-500 mt-1">این لوگو به عنوان واترمارک در پس‌زمینه صفحات چاپی استفاده خواهد شد.</p>
                        </div>
                        <div>
                             <label className="block mb-1 text-sm font-medium">عنوان چاپ فرم ورود</label>
                             <input type="text" name="entryPrintTitle" value={formState.entryPrintTitle} onChange={handleChange} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div>
                             <label className="block mb-1 text-sm font-medium">عنوان چاپ فرم خروج</label>
                             <input type="text" name="exitPrintTitle" value={formState.exitPrintTitle} onChange={handleChange} className="w-full p-2 border rounded-lg" />
                        </div>
                        <div className="md:col-span-2 mt-2">
                             <label className="inline-flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-lg border border-slate-200 w-full hover:bg-slate-100">
                                <input 
                                    type="checkbox" 
                                    name="printBoldText" 
                                    checked={!!formState.printBoldText} 
                                    onChange={(e) => setFormState(prev => ({ ...prev, printBoldText: e.target.checked }))} 
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                />
                                <span className="text-sm font-bold text-slate-700">فعال‌سازی چاپ پررنگ (Bold) برای تمام گزارش‌ها و حواله‌ها</span>
                            </label>
                        </div>
                    </div>
                </div>

                 <div>
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">مدیریت و ترتیب محصولات</h3>
                    <div ref={productListRef} className="space-y-2">
                        {formState.products.filter(p => !p.isDeleted).map((product, index) => (
                            <div key={product.id} className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-1 flex justify-center items-center cursor-grab drag-handle text-slate-400 hover:text-slate-700">
                                    <DragHandleIcon className="w-5 h-5" />
                                </div>
                                <div className="col-span-5 p-2 border rounded-lg bg-slate-50 flex justify-between items-center">
                                    <span>{product.name}</span>
                                    <button onClick={() => handleEditProduct(product)} className="text-sky-500 hover:text-sky-700 text-sm">ویرایش</button>
                                </div>
                                <select 
                                    value={product.type} 
                                    onChange={e => handleProductTypeChange(product.id, e.target.value as ProductType)}
                                    className="col-span-4 p-2 border rounded-lg"
                                >
                                    <option value="rawMaterial">ماده اولیه</option>
                                    <option value="finishedGood">محصول نهایی</option>
                                </select>
                                <button onClick={() => handleRemoveProduct(product.id)} className="col-span-2 bg-red-500 text-white p-2 rounded-lg hover:bg-red-600">حذف</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleAddProduct} className="mt-3 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">افزودن محصول جدید</button>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">مدیریت سهمیه و طول دوره</h3>
                    <div className="mb-4">
                        <label className="block mb-1 text-sm font-medium">طول کل دوره پرورش (روز)</label>
                        <input 
                            type="number" 
                            value={formState.totalBroodDays || 50} 
                            onChange={e => handleTotalDaysChange(e.target.value)} 
                            className="w-full md:w-1/3 p-2 border rounded-lg" 
                            placeholder="مثلا ۵۰"
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        {finishedGoods.map(product => {
                            const quota = formState.feedQuotas?.find(q => q.productId === product.id)?.quotaPerChick || 0;
                            const duration = formState.productPhaseDurations?.[product.id] || 10;
                            return (
                                <div key={product.id} className="flex flex-col md:flex-row gap-4 items-end bg-slate-50 p-3 rounded-lg border">
                                    <div className="flex-1 w-full">
                                        <label className="block mb-1 text-sm font-bold text-slate-700">{product.name}</label>
                                        <div className="text-xs text-slate-500 mb-1">تنظیمات این محصول را وارد کنید</div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <label className="block mb-1 text-xs font-medium">سهمیه (گرم بر جوجه)</label>
                                        <input 
                                            type="number" 
                                            value={quota} 
                                            onChange={e => handleQuotaChange(product.id, e.target.value)} 
                                            className="w-full p-2 border rounded-lg text-center" 
                                            placeholder="گرم"
                                        />
                                    </div>
                                    <div className="flex-1 w-full">
                                        <label className="block mb-1 text-xs font-medium">مدت زمان مصرف (روز)</label>
                                        <input 
                                            type="number" 
                                            value={duration} 
                                            onChange={e => handleDurationChange(product.id, e.target.value)} 
                                            className="w-full p-2 border rounded-lg text-center" 
                                            placeholder="روز"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                        {finishedGoods.length === 0 && <p className="text-sm text-slate-500">برای تعریف سهمیه، ابتدا یک محصول از نوع "محصول نهایی" ثبت کنید.</p>}
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">عناوین امضا (حواله ورود)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <input type="text" value={formState.entrySignatures[0] || ''} onChange={e => handleSignatureChange('entry', 0, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای اول (مثلا تایید کننده)" />
                            <input type="text" value={formState.entrySignatureNames?.[0] || ''} onChange={e => handleSignatureChange('entry', 0, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.entrySignatures[1] || ''} onChange={e => handleSignatureChange('entry', 1, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای دوم" />
                            <input type="text" value={formState.entrySignatureNames?.[1] || ''} onChange={e => handleSignatureChange('entry', 1, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.entrySignatures[2] || ''} onChange={e => handleSignatureChange('entry', 2, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای سوم" />
                            <input type="text" value={formState.entrySignatureNames?.[2] || ''} onChange={e => handleSignatureChange('entry', 2, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.entrySignatures[3] || ''} onChange={e => handleSignatureChange('entry', 3, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای چهارم" />
                            <input type="text" value={formState.entrySignatureNames?.[3] || ''} onChange={e => handleSignatureChange('entry', 3, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                    </div>
                </div>
                
                <div>
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">عناوین امضا (حواله خروج)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <input type="text" value={formState.exitSignatures[0] || ''} onChange={e => handleSignatureChange('exit', 0, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای اول" />
                            <input type="text" value={formState.exitSignatureNames?.[0] || ''} onChange={e => handleSignatureChange('exit', 0, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.exitSignatures[1] || ''} onChange={e => handleSignatureChange('exit', 1, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای دوم" />
                            <input type="text" value={formState.exitSignatureNames?.[1] || ''} onChange={e => handleSignatureChange('exit', 1, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.exitSignatures[2] || ''} onChange={e => handleSignatureChange('exit', 2, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای سوم" />
                            <input type="text" value={formState.exitSignatureNames?.[2] || ''} onChange={e => handleSignatureChange('exit', 2, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                        <div className="space-y-2">
                            <input type="text" value={formState.exitSignatures[3] || ''} onChange={e => handleSignatureChange('exit', 3, e.target.value)} className="w-full p-2 border rounded-lg" placeholder="عنوان امضای چهارم" />
                            <input type="text" value={formState.exitSignatureNames?.[3] || ''} onChange={e => handleSignatureChange('exit', 3, e.target.value, true)} className="w-full p-2 border rounded-lg text-sm bg-slate-50" placeholder="نام شخص (اختیاری)" />
                        </div>
                    </div>
                </div>

                <div className="mt-8 text-center border-t pt-6">
                    <button onClick={handleSave} className="bg-green-500 text-white px-8 py-3 rounded-lg hover:bg-green-600 text-base font-bold">ذخیره تمام تنظیمات</button>
                </div>

                 <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">مدیریت حساب کاربری</h3>
                    <div className="max-w-md mx-auto">
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div>
                                <label className="block text-sm mb-1">رمز عبور فعلی</label>
                                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full p-2 border rounded-lg" required />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">رمز عبور جدید</label>
                                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full p-2 border rounded-lg" required />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">تکرار رمز عبور جدید</label>
                                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full p-2 border rounded-lg" required />
                            </div>
                            <button type="submit" className="w-full bg-indigo-500 text-white px-4 py-2 rounded-lg hover:bg-indigo-600">تغییر رمز عبور</button>
                        </form>
                    </div>
                </div>

                <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">مدیریت لیست رانندگان</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        در این بخش می‌توانید لیست رانندگانی که در فرم‌های ورود و خروج به عنوان پیشنهاد نمایش داده می‌شوند را مدیریت کنید.
                        <br/>
                        حذف یک راننده از این لیست، نام او را از حواله‌های قبلی حذف <strong>نمی‌کند</strong> و فقط از لیست پیشنهادات آینده حذف می‌شود.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4 p-4 border rounded-lg">
                            <h4 className="font-bold text-slate-700">افزودن راننده جدید</h4>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={newDriverNameInput} 
                                    onChange={e => setNewDriverNameInput(e.target.value)} 
                                    className="w-full p-2 border rounded-lg" 
                                    placeholder="نام کامل راننده"
                                />
                                <button onClick={handleAddDriver} className="bg-sky-500 text-white px-4 py-2 rounded-lg hover:bg-sky-600 whitespace-nowrap">افزودن</button>
                            </div>
                        </div>
                        <div className="p-4 border rounded-lg flex flex-col h-full">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer"
                                        checked={selectedDriversForBulk.size === drivers.length && drivers.length > 0}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedDriversForBulk(new Set(drivers));
                                            else setSelectedDriversForBulk(new Set());
                                        }}
                                        title="انتخاب همه"
                                    />
                                    <h4 className="font-bold text-slate-700">لیست رانندگان فعال</h4>
                                </div>
                                {selectedDriversForBulk.size > 0 && (
                                    <button onClick={handleBulkDeleteDrivers} className="text-xs text-red-500 hover:font-bold">حذف ({selectedDriversForBulk.size})</button>
                                )}
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 flex-grow">
                                {drivers.length === 0 ? (
                                    <p className="text-sm text-slate-400">راننده‌ای یافت نشد.</p>
                                ) : (
                                    drivers.map(driver => (
                                        <div key={driver} className="flex justify-between items-center bg-slate-50 p-2 rounded">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer"
                                                    checked={selectedDriversForBulk.has(driver)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedDriversForBulk);
                                                        if (e.target.checked) newSet.add(driver);
                                                        else newSet.delete(driver);
                                                        setSelectedDriversForBulk(newSet);
                                                    }}
                                                />
                                                <span className="text-sm">{driver}</span>
                                            </div>
                                            <button onClick={() => handleDeleteDriver(driver)} className="text-red-500 hover:text-red-700 text-xs font-semibold">حذف</button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">اصلاح و یکپارچه‌سازی داده‌ها</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                         <div className="space-y-4 p-4 border rounded-lg">
                            <h4 className="font-bold text-slate-700">اصلاح نام راننده</h4>
                            <p className="text-xs text-slate-500">یک نام را از لیست انتخاب کرده و نام صحیح جدید را وارد کنید. این تغییر در تمام حواله‌ها اعمال خواهد شد.</p>
                            <div>
                                <label className="block text-sm mb-1">نام فعلی راننده</label>
                                <select value={selectedDriver} onChange={e => setSelectedDriver(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {drivers.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                            </div>
                             <div>
                                <label className="block text-sm mb-1">نام جدید</label>
                                <input type="text" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} className="w-full p-2 border rounded-lg" placeholder="نام صحیح را وارد کنید"/>
                            </div>
                            <button onClick={handleDriverRename} className="w-full bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600">به‌روزرسانی نام راننده</button>
                         </div>
                         <div className="space-y-4 p-4 border rounded-lg">
                              <h4 className="font-bold text-slate-700">اصلاح نام مرغدار</h4>
                              <p className="text-xs text-slate-500">مرغدار مورد نظر را انتخاب و نام او را اصلاح کنید.</p>
                             <div>
                                <label className="block text-sm mb-1">مرغدار فعلی</label>
                                <select value={selectedFarmerId} onChange={e => setSelectedFarmerId(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {farmers.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            </div>
                             <div>
                                <label className="block text-sm mb-1">نام جدید</label>
                                <input type="text" value={newFarmerName} onChange={e => setNewFarmerName(e.target.value)} className="w-full p-2 border rounded-lg" placeholder="نام صحیح را وارد کنید"/>
                            </div>
                            <button onClick={handleFarmerRename} className="w-full bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600">به‌روزرسانی نام مرغدار</button>
                         </div>
                         
                         {/* Merge Farmers */}
                         <div className="space-y-4 p-4 border border-yellow-300 rounded-lg bg-yellow-50">
                            <h4 className="font-bold text-slate-700">ادغام مرغداران تکراری</h4>
                            <p className="text-xs text-slate-500">
                                اگر به اشتباه یک مرغدار را با دو نام مختلف ثبت کرده‌اید، از این بخش برای یکی کردن آن‌ها استفاده کنید.
                            </p>
                            <div>
                                <label className="block text-sm mb-1 text-red-700 font-semibold">مرغدار تکراری (حذف خواهد شد)</label>
                                <select value={sourceFarmerId} onChange={e => setSourceFarmerId(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {farmers.map(f => <option key={f.id} value={f.id} disabled={f.id === targetFarmerId}>{f.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-green-700 font-semibold">مرغدار اصلی (باقی می‌ماند)</label>
                                <select value={targetFarmerId} onChange={e => setTargetFarmerId(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {farmers.map(f => <option key={f.id} value={f.id} disabled={f.id === sourceFarmerId}>{f.name}</option>)}
                                </select>
                            </div>
                            <button onClick={handleFarmerMerge} className="w-full bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">ادغام مرغداران</button>
                        </div>

                        {/* Merge Products */}
                        <div className="space-y-4 p-4 border border-blue-300 rounded-lg bg-blue-50">
                            <h4 className="font-bold text-slate-700">ادغام محصولات تکراری</h4>
                            <p className="text-xs text-slate-500">
                                محصولات تکراری را یکی کنید. تمام سوابق تولید، انبار و فرمول‌ها منتقل می‌شوند.
                            </p>
                            <div>
                                <label className="block text-sm mb-1 text-red-700 font-semibold">محصول تکراری (حذف خواهد شد)</label>
                                <select value={sourceProductId} onChange={e => setSourceProductId(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {formState.products.filter(p => !p.isDeleted).map(p => <option key={p.id} value={p.id} disabled={p.id === targetProductId}>{p.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-green-700 font-semibold">محصول اصلی (باقی می‌ماند)</label>
                                <select value={targetProductId} onChange={e => setTargetProductId(e.target.value)} className="w-full p-2 border rounded-lg">
                                    {formState.products.filter(p => !p.isDeleted).map(p => <option key={p.id} value={p.id} disabled={p.id === sourceProductId}>{p.name}</option>)}
                                </select>
                            </div>
                            <button onClick={handleProductMerge} className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600">ادغام محصولات</button>
                        </div>

                        {/* Merge Drivers */}
                        <div className="md:col-span-2 space-y-4 p-4 border border-purple-300 rounded-lg bg-purple-50">
                            <h4 className="font-bold text-slate-700">ادغام رانندگان تکراری</h4>
                            <p className="text-xs text-slate-500">
                                اگر نام یک راننده به چند شکل مختلف (مثلا با فاصله یا پسوند) ثبت شده است، آن‌ها را یکی کنید.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm mb-1 text-red-700 font-semibold">راننده تکراری (حذف خواهد شد)</label>
                                    <select value={sourceDriverName} onChange={e => setSourceDriverName(e.target.value)} className="w-full p-2 border rounded-lg">
                                        {drivers.map(d => <option key={d} value={d} disabled={d === targetDriverName}>{d}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1 text-green-700 font-semibold">راننده اصلی (باقی می‌ماند)</label>
                                    <select value={targetDriverName} onChange={e => setTargetDriverName(e.target.value)} className="w-full p-2 border rounded-lg">
                                        {drivers.map(d => <option key={d} value={d} disabled={d === sourceDriverName}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                            <button onClick={handleDriverMerge} className="w-full bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 mt-2">ادغام رانندگان</button>
                        </div>

                     </div>
                </div>
                
                <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-slate-600 border-b pb-2 mb-3">پشتیبان‌گیری و بازیابی</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                         <div>
                             <p className="text-sm text-slate-500 mb-2">برای تهیه نسخه پشتیبان از تمام اطلاعات روی دکمه زیر کلیک کنید.</p>
                             <button onClick={handleExport} className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600">دریافت فایل پشتیبان (Export)</button>
                         </div>
                         <div>
                              <p className="text-sm text-slate-500 mb-2">برای بازیابی اطلاعات از یک فایل پشتیبان، فایل JSON را انتخاب کنید. <strong className="text-red-500">توجه: تمام اطلاعات فعلی حذف خواهد شد.</strong></p>
                              <label htmlFor="import-file-input" className="w-full cursor-pointer text-center block bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600">بارگذاری فایل پشتیبان (Import)</label>
                             <input type="file" id="import-file-input" className="hidden" accept="application/json,.json" onChange={handleImport}/>
                         </div>
                     </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;
