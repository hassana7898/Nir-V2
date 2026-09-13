
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import Modal from './Modal';
import { useSettings } from '../contexts/SettingsContext';
import * as dataService from '../services/dataService';
import { showToast } from '../utils/helpers';
import { toPersianNumerals, formatToISODate } from '../utils/formatters';
import { Farmer, Product } from '../types';
import DatePicker from './DatePicker';

interface DataImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'entry' | 'exit';
    onSuccess: () => void;
    initialDate?: Date;
}

const DataImportModal: React.FC<DataImportModalProps> = ({ isOpen, onClose, type, onSuccess, initialDate }) => {
    const [fileData, setFileData] = useState<any[]>([]);
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [loading, setLoading] = useState(false);
    const [importDate, setImportDate] = useState(initialDate || new Date());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { settings, loadSettings } = useSettings();

    React.useEffect(() => {
        if (isOpen) {
            setImportDate(initialDate || new Date());
        }
    }, [isOpen, initialDate]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        const reader = new FileReader();
        
        reader.onload = (evt) => {
            try {
                const data = evt.target?.result;
                if (!data) throw new Error("اطلاعات فایل دریافت نشد.");

                const wb = XLSX.read(data, { type: 'array' });
                const wsname = wb.SheetNames[0];
                if (!wsname) throw new Error("فایل اکسل شیت ندارد.");

                const ws = wb.Sheets[wsname];
                const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
                
                if (!jsonData || jsonData.length < 2) {
                    showToast('فایل خالی یا نامعتبر است.', 'error');
                    setLoading(false);
                    return;
                }

                processExcelData(jsonData);
            } catch (error: any) {
                console.error("Excel Import Error:", error);
                const msg = error?.message || 'خطا در پردازش فایل اکسل.';
                showToast(msg, 'error');
                setLoading(false);
            }
        };

        reader.onerror = () => {
            showToast('خطا در خواندن فایل.', 'error');
            setLoading(false);
        };

        reader.readAsArrayBuffer(file);
    };

    const toEnglishDigits = (str: string) => {
        if (!str) return '';
        const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return str.toString().replace(/[۰-۹]/g, w => persianDigits.indexOf(w).toString());
    };

    const cleanString = (val: any) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return ''; 
        return toEnglishDigits(val.toString()).trim().replace(/\s+/g, ' ');
    };

    const parseNumber = (val: any) => {
        if (!val) return 0;
        const clean = cleanString(val).replace(/[^0-9.-]/g, '');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    };

    const processExcelData = (rows: any[][]) => {
        const mappedData: any[] = [];
        const farmers = dataService.getFarmers();
        const dateStr = formatToISODate(importDate);
        
        let headerIndex = -1;
        
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const row = rows[i];
            if (!Array.isArray(row)) continue;
            
            const rowStr = row.map((c: any) => cleanString(c)).join(' ');
            if (rowStr.includes('ردیف') || (rowStr.includes('وزن') && (rowStr.includes('نام') || rowStr.includes('محصول')))) {
                headerIndex = i;
                break;
            }
        }

        let idxName = 1;
        let idxProduct = 2;
        
        let idxBillWeight = 3;
        let idxScaleWeight = 4;
        let idxFactory = 5;
        let idxWastage = 6;
        let idxBillNumber = 7;
        let idxOrigin = 8;
        let idxCost = 9;
        let idxDriverEntry = 10;
        let idxPhone = 11;
        let idxIBAN = 12;

        let idxWeight = 3;
        let idxDriverExit = 4;
        let idxNumberExit = 5;

        let dataStartIndex = 0;

        if (headerIndex !== -1) {
            const headerRow = rows[headerIndex];
            dataStartIndex = headerIndex + 1;

            if (Array.isArray(headerRow)) {
                const header = headerRow.map((c: any) => cleanString(c));
                const find = (keywords: string[]) => header.findIndex((h: string) => keywords.some(k => h.includes(k)));

                const fName = find(['نام', 'مرغدار', 'فروشنده', 'خریدار']);
                if (fName !== -1) idxName = fName;

                const fProduct = find(['محصول', 'کالا', 'نوع']);
                if (fProduct !== -1) idxProduct = fProduct;

                if (type === 'exit') {
                    const fWeight = find(['وزن']);
                    if (fWeight !== -1) idxWeight = fWeight;

                    const fDriver = find(['راننده']);
                    if (fDriver !== -1) idxDriverExit = fDriver;

                    const fNumber = find(['شماره حواله', 'حواله', 'شماره']);
                    if (fNumber !== -1) idxNumberExit = fNumber;
                } else {
                    const fBillW = find(['وزن بارنامه', 'بارنامه']);
                    if (fBillW !== -1) idxBillWeight = fBillW;

                    const fScaleW = find(['وزن باسکول', 'باسکول', 'تخلیه']);
                    if (fScaleW !== -1) idxScaleWeight = fScaleW;

                    const fFactory = find(['کارخانه']);
                    if (fFactory !== -1) idxFactory = fFactory;

                    const fWastage = find(['افت']);
                    if (fWastage !== -1) idxWastage = fWastage;

                    const fBillNum = find(['شماره بارنامه']);
                    if (fBillNum !== -1) idxBillNumber = fBillNum;
                    
                    const fOrigin = find(['مبدا']);
                    if (fOrigin !== -1) idxOrigin = fOrigin;

                    const fCost = find(['کرایه']);
                    if (fCost !== -1) idxCost = fCost;

                    const fDriver = header.findIndex((h: string) => h.includes('راننده') && !h.includes('شماره') && !h.includes('شبا') && !h.includes('تلفن'));
                    if (fDriver !== -1) idxDriverEntry = fDriver;

                    const fPhone = find(['تلفن', 'موبایل', 'شماره راننده']);
                    if (fPhone !== -1) idxPhone = fPhone;

                    const fIBAN = find(['شبا', 'حساب', 'کارت']);
                    if (fIBAN !== -1) idxIBAN = fIBAN;
                }
            }
        } else {
             for (let i = 0; i < Math.min(rows.length, 20); i++) {
                 const firstCell = rows[i]?.[0];
                 if (typeof firstCell === 'number' || (firstCell && !isNaN(Number(firstCell)) && Number(firstCell) < 1000)) {
                     dataStartIndex = i;
                     break;
                 }
             }
        }

        const dataRows = rows.slice(dataStartIndex);

        dataRows.forEach((row: any) => {
            if (!row || !Array.isArray(row) || row.length === 0) return;
            const firstCellStr = cleanString(row[0]);
            
            if (firstCellStr.includes('جمع') || firstCellStr.includes('مجموع') || firstCellStr.includes('Total')) return;
            if (firstCellStr.includes('ردیف')) return;

            if (!row[idxName]) return;

            let name = cleanString(row[idxName]);
            let productNameRaw = cleanString(row[idxProduct]);
            
            // If product name is empty but they might have merged it in Excel, try to separate
            if (!productNameRaw && name) {
                const productKeywords = ['ذرت', 'سویا', 'پیش دان', 'میان دان', 'پس دان', 'پس دان یک', 'پس دان دو', 'دان', 'گندم', 'جو', 'مرغ', 'کنجاله', 'پودر', 'روغن', 'مکمل', 'سبوس', 'رول', 'پلت', 'کراش', 'پریمال', 'متیونین', 'لیزین', 'کربنات', 'صدف', 'نمک', 'جوجه', 'گوشتی', 'زنده', 'استارتر', 'ویتامین', 'کلسیم', 'فسفر', 'دی کلسیم', 'کنسانتره', 'رشد', 'آغازین', 'پایانی'];
                const kpArray = settings.products.filter(p => !p.isDeleted).map(p => p.name.trim());
                
                const allProducts = [...new Set([...productKeywords, ...kpArray])].sort((a, b) => b.length - a.length);
                
                for (let p of allProducts) {
                    if (p && name.includes(p)) {
                        let regex = new RegExp(`(?:^|\\s)(${p})(?:\\s|$)`);
                        let match = name.match(regex);
                        
                        if (match) {
                             productNameRaw = match[1];
                             name = name.replace(regex, ' ').trim();
                             break;
                        } else if (name.endsWith(p)) {
                             productNameRaw = p;
                             name = name.slice(0, name.length - p.length).trim();
                             break;
                        }
                    }
                }
            }
            
            let productId = null;
            // Robust check for product name
            const matchedProduct = settings.products.find(p => {
                const pName = p.name ? p.name.toString() : '';
                return pName === productNameRaw || pName.includes(productNameRaw);
            });
            if (matchedProduct) productId = matchedProduct.id;

            if (type === 'entry') {
                const billWeight = parseNumber(row[idxBillWeight]);
                const scaleWeight = parseNumber(row[idxScaleWeight]);
                const factory = cleanString(row[idxFactory]);
                const wastage = parseNumber(row[idxWastage]);
                
                const billNumber = cleanString(row[idxBillNumber]);
                const origin = cleanString(row[idxOrigin]);
                const transportCost = parseNumber(row[idxCost]);
                const driverName = cleanString(row[idxDriverEntry]);
                const driverPhone = cleanString(row[idxPhone]);
                const driverIBAN = cleanString(row[idxIBAN]);

                if (scaleWeight > 0 || billWeight > 0) {
                    mappedData.push({
                        date: dateStr,
                        sellerName: name,
                        productId,
                        productNameRaw,
                        productName: matchedProduct?.name || productNameRaw,
                        billWeight,
                        scaleWeight,
                        factory,
                        wastage,
                        billNumber,
                        origin,
                        transportCost,
                        driverName,
                        driverPhone,
                        driverIBAN
                    });
                }

            } else {
                const weight = parseNumber(row[idxWeight]);
                const driverName = cleanString(row[idxDriverExit]);
                const invoiceNumber = cleanString(row[idxNumberExit]);

                let farmerId = null;
                // Robust check for farmer name
                const matchedFarmer = farmers.find(f => {
                    const fName = f.name ? f.name.toString() : '';
                    return fName === name || fName.includes(name);
                });
                
                if (matchedFarmer) {
                    farmerId = matchedFarmer.id;
                }

                if (weight > 0) {
                    mappedData.push({
                        date: dateStr,
                        name, 
                        farmerId,
                        productId,
                        productNameRaw,
                        productName: matchedProduct?.name || productNameRaw,
                        weight,
                        driverName,
                        invoiceNumber
                    });
                }
            }
        });

        setFileData(mappedData);
        setStep('preview');
        setLoading(false);
    };

    const handleImportConfirm = async () => {
        setLoading(true);
        let count = 0;
        
        const currentFarmers = dataService.getFarmers();
        const farmersMap = new Map(currentFarmers.map(f => [f.name.trim(), f.id]));
        
        const newProductsToAdd = new Set<string>();
        fileData.forEach(row => {
            if (!row.productId && row.productNameRaw) {
                newProductsToAdd.add(row.productNameRaw);
            }
        });

        if (newProductsToAdd.size > 0) {
            const currentSettings = dataService.loadSettings();
            const newProducts: Product[] = [];
            newProductsToAdd.forEach(pName => {
                newProducts.push({
                    id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: pName,
                    type: type === 'entry' ? 'rawMaterial' : 'finishedGood'
                });
            });
            currentSettings.products = [...currentSettings.products, ...newProducts];
            dataService.saveSettings(currentSettings);
            loadSettings();
            
            const newProductMap = new Map(newProducts.map(p => [p.name, p.id]));
            fileData.forEach(row => {
                if (!row.productId && newProductMap.has(row.productNameRaw)) {
                    row.productId = newProductMap.get(row.productNameRaw);
                }
            });
        }

        const newFarmers: Farmer[] = [];
        if (type === 'exit') {
            const uniqueNewFarmerNames = new Set<string>();
            fileData.forEach(row => {
                if (!row.farmerId && row.name) uniqueNewFarmerNames.add(row.name.trim());
            });

            uniqueNewFarmerNames.forEach(fName => {
                if (!farmersMap.has(fName)) {
                    const newFarmer: Farmer = { 
                        id: `farmer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, 
                        name: fName, 
                        broods: [] 
                    };
                    newFarmers.push(newFarmer);
                    farmersMap.set(fName, newFarmer.id);
                }
            });

            if (newFarmers.length > 0) {
                dataService.saveFarmers([...currentFarmers, ...newFarmers]);
                await dataService.logAction('created', 'farmer', { count: newFarmers.length, names: newFarmers.map(f => f.name).join(', ') });
            }
        }

        const newDriversAddedSet = new Set<string>();
        const uniqueDriversArray = Array.from(new Set(fileData.map(r => r.driverName?.trim()).filter(Boolean)));
        
        const currentDrivers = dataService.getDrivers();
        const driversSet = new Set(currentDrivers);
        uniqueDriversArray.forEach(d => {
            if (!driversSet.has(d)) {
                newDriversAddedSet.add(d);
                currentDrivers.push(d);
            }
        });

        if (newDriversAddedSet.size > 0) {
            dataService.saveDrivers(currentDrivers);
            showToast(`${toPersianNumerals(newDriversAddedSet.size)} راننده جدید اضافه شد.`, 'info');
        }

        for (const row of fileData) {
            if (!row.productId) continue; 

            if (type === 'entry') {
                await dataService.addInvoice({
                    date: row.date,
                    sellerName: row.sellerName,
                    productId: row.productId,
                    billWeight: row.billWeight, 
                    scaleWeight: row.scaleWeight, 
                    factory: row.factory,
                    wastage: row.wastage !== 0 ? row.wastage : (row.scaleWeight - row.billWeight),
                    billNumber: row.billNumber,
                    origin: row.origin,
                    transportCost: row.transportCost,
                    driverName: row.driverName,
                    driverPhone: row.driverPhone,
                    driverIBAN: row.driverIBAN
                }, 'entry');
                count++;
            } else {
                let targetFarmerId = row.farmerId;
                if (!targetFarmerId && row.name && farmersMap.has(row.name.trim())) {
                    targetFarmerId = farmersMap.get(row.name.trim());
                }

                if (targetFarmerId) {
                    await dataService.addInvoice({
                        date: row.date,
                        farmerId: targetFarmerId,
                        productId: row.productId,
                        weight: row.weight,
                        driverName: row.driverName,
                        invoiceNumber: row.invoiceNumber,
                    }, 'exit');
                    count++;
                }
            }
        }

        setLoading(false);
        showToast(`${toPersianNumerals(count)} رکورد با موفقیت وارد شد.`);
        if (newProductsToAdd.size > 0) showToast(`${toPersianNumerals(newProductsToAdd.size)} محصول جدید ایجاد شد.`, 'info');
        if (newFarmers.length > 0) showToast(`${toPersianNumerals(newFarmers.length)} مرغدار جدید ایجاد شد.`, 'info');
        
        onSuccess();
        onClose();
        setStep('upload');
        setFileData([]);
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`وارد کردن ${type === 'entry' ? 'ورودی' : 'خروجی'} از اکسل`} footer={
            step === 'preview' ? (
                <>
                    <button onClick={() => { setStep('upload'); setFileData([]); }} className="px-4 py-2 text-slate-600">بازگشت</button>
                    <button onClick={handleImportConfirm} disabled={loading} className="bg-green-500 text-white px-4 py-2 rounded-lg">{loading ? 'در حال ثبت...' : 'تایید و ثبت نهایی'}</button>
                </>
            ) : null
        }>
            {step === 'upload' ? (
                <div className="space-y-4 text-center">
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-right">
                         <label className="block text-sm font-bold text-slate-700 mb-2">تاریخ ثبت برای این فایل:</label>
                         <DatePicker id="import-date" value={importDate} onChange={setImportDate} />
                         <p className="text-xs text-slate-500 mt-2">تمام رکوردهای این فایل با این تاریخ ثبت خواهند شد.</p>
                    </div>

                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50">
                        <p className="mb-4 text-slate-600">فایل اکسل (XLSX) خود را انتخاب کنید.</p>
                        <div className="text-xs text-slate-500 mb-4 text-right leading-loose">
                            <strong>ترتیب ستون‌ها برای {type === 'entry' ? 'ورود' : 'خروج'}:</strong><br/>
                            {type === 'entry' ? (
                                <span>ردیف | نام فروشنده | نام محصول | وزن بارنامه | وزن باسکول | کارخانه | افت | شماره بارنامه | مبدا | کرایه | نام راننده | شماره راننده | شبا راننده</span>
                            ) : (
                                <span>ردیف | نام مرغدار | نام محصول | وزن | نام راننده | شماره حواله</span>
                            )}
                        </div>
                        <input 
                            type="file" 
                            accept=".xlsx, .xls" 
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
                        />
                    </div>
                    {loading && <p className="text-sky-600">در حال پردازش فایل...</p>}
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm font-bold text-slate-700">پیش‌نمایش داده‌های شناسایی شده ({toPersianNumerals(fileData.length)} مورد):</p>
                    <div className="overflow-x-auto max-h-64 border rounded-lg">
                        <table className="w-full text-xs text-center">
                            <thead className="bg-slate-100 sticky top-0">
                                <tr>
                                    <th className="p-2">نام</th>
                                    <th className="p-2">محصول</th>
                                    {type === 'entry' ? (
                                        <>
                                            <th className="p-2">ت. باسکول</th>
                                            <th className="p-2">ت. بارنامه</th>
                                            <th className="p-2">کارخانه</th>
                                            <th className="p-2">افت (فایل)</th>
                                            <th className="p-2">راننده</th>
                                        </>
                                    ) : (
                                        <>
                                            <th className="p-2">وزن</th>
                                            <th className="p-2">راننده</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {fileData.map((row, i) => (
                                    <tr key={i} className="border-b hover:bg-slate-50">
                                        <td className="p-2">{type === 'entry' ? row.sellerName : row.name}</td>
                                        <td className="p-2">
                                            {row.productName}
                                            {!row.productId && <span className="text-red-500 font-bold mx-1">(جدید)</span>}
                                        </td>
                                        {type === 'entry' ? (
                                            <>
                                                <td className="p-2">{toPersianNumerals(row.scaleWeight)}</td>
                                                <td className="p-2">{toPersianNumerals(row.billWeight)}</td>
                                                <td className="p-2">{row.factory || '-'}</td>
                                                <td className="p-2">{toPersianNumerals(row.wastage)}</td>
                                                <td className="p-2">{row.driverName}</td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="p-2">{toPersianNumerals(row.weight)}</td>
                                                <td className="p-2">{row.driverName}</td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-red-500">* محصولاتی که با برچسب (جدید) مشخص شده‌اند، به طور خودکار به سیستم اضافه خواهند شد.</p>
                </div>
            )}
        </Modal>
    );
};

export default DataImportModal;
