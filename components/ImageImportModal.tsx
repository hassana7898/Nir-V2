
import React, { useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import Modal from './Modal';
import { useSettings } from '../contexts/SettingsContext';
import * as dataService from '../services/dataService';
import { showToast, fileToBase64 } from '../utils/helpers';
import { toPersianNumerals, formatToISODate } from '../utils/formatters';
import { Farmer, Driver } from '../types';
import DatePicker from './DatePicker';

// Handle PDF.js import compatibility (ESM vs CommonJS interop)
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// Initialize PDF.js worker using Vite asset URL
if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
}

interface ImageImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    type: 'entry' | 'exit';
    initialDate?: Date;
}

import { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';

interface ExtractedRow {
    dateStr?: string;
    productName: string;
    driverName: string;
    
    // Exit specific
    farmerName?: string;
    weight?: number;
    invoiceNumber?: string;

    // Entry specific
    sellerName?: string;
    factory?: string;
    billWeight?: number;
    scaleWeight?: number;
    billNumber?: string;
    origin?: string;
    transportCost?: number;
    driverPhone?: string;
    driverIBAN?: string;
}

const ImageImportModal: React.FC<ImageImportModalProps> = ({ isOpen, onClose, onSuccess, type, initialDate }) => {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [extractedData, setExtractedData] = useState<ExtractedRow[]>([]);
    const [importDate, setImportDate] = useState(initialDate || new Date());
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [loading, setLoading] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(true);
    
    const { settings, loadSettings } = useSettings();

    useEffect(() => {
        if (isOpen) {
            setImportDate(initialDate || new Date());
        }
    }, [isOpen, initialDate]);

    useEffect(() => {
        // Backend handles key checking now
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            
            try {
                const base64 = await fileToBase64(selectedFile);
                setPreview(base64);
            } catch (err) {
                showToast('خطا در خواندن فایل', 'error');
            }
        }
    };

    const toEnglishDigits = (str: string | number | null | undefined) => {
        if (!str) return '';
        const s = str.toString();
        const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return s.replace(/[۰-۹]/g, w => persianDigits.indexOf(w).toString());
    };

    // --- Local PDF Processing Logic ---
    const processPdfLocally = async (file: File) => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            // Use the resolved pdfjs instance
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            const rows: ExtractedRow[] = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                
                // 1. Group text items by Y coordinate (lines)
                // Coordinates in PDF: (0,0) is bottom-left. Higher Y means higher on page.
                const rowBuckets = new Map<number, {str: string, x: number}[]>();
                
                textContent.items.forEach((item: any) => {
                    const y = Math.round(item.transform[5]); // Round to handle slight misalignments
                    const x = item.transform[4];
                    const str = item.str.trim();
                    if (!str) return;

                    // Find a bucket within tolerance
                    let bucketY = [...rowBuckets.keys()].find(key => Math.abs(key - y) < 5);
                    if (bucketY === undefined) {
                        bucketY = y;
                        rowBuckets.set(bucketY, []);
                    }
                    rowBuckets.get(bucketY)?.push({ str, x });
                });

                // 2. Sort rows by Y (Top to Bottom -> Descending Y)
                const sortedY = [...rowBuckets.entries()].sort((a, b) => b[0] - a[0]);

                // 3. Process each row
                for (const [_, items] of sortedY) {
                    // Sort items by X Descending (Right to Left for Persian Table)
                    const cols = items.sort((a, b) => b.x - a.x);

                    if (type === 'exit') {
                        const lineText = cols.map(c => c.str).join(' ');
                        const normalizedLine = toEnglishDigits(lineText);
                        const match = normalizedLine.match(/^(\d+)\s+(.+)\s+(\d+)\s+(.+)\s+(\d+)$/);
                        
                        if (match) {
                            let farmerAndProduct = match[2].trim();
                            const weight = parseInt(match[3]);
                            let driverName = match[4].trim();
                            const invoiceNumber = match[5];

                            let productName = '';
                            let farmerName = farmerAndProduct;

                            const knownProduct = settings.products.find(p => farmerAndProduct.includes(p.name));
                            if (knownProduct) {
                                productName = knownProduct.name;
                                farmerName = farmerAndProduct.replace(productName, '').trim();
                            }
                            driverName = driverName.replace(/[()]/g, '').trim();

                            rows.push({
                                farmerName,
                                productName,
                                weight,
                                driverName,
                                invoiceNumber
                            });
                        } else {
                            const numbers = normalizedLine.match(/\d+/g);
                            if (numbers && numbers.length >= 3) {
                                const rowIndex = numbers[0];
                                const invoice = numbers[numbers.length - 1];
                                const possibleWeight = numbers.find(n => parseInt(n) > 100 && n !== invoice && n !== rowIndex);
                                
                                if (possibleWeight) {
                                    const weightIndex = normalizedLine.indexOf(possibleWeight);
                                    const invoiceIndex = normalizedLine.lastIndexOf(invoice);
                                    const prefix = normalizedLine.substring(numbers[0].length, weightIndex).trim();
                                    const driver = normalizedLine.substring(weightIndex + possibleWeight.length, invoiceIndex).trim();
                                    
                                    let prodName = '';
                                    let farmName = prefix;
                                    const kp = settings.products.find(p => prefix.includes(p.name));
                                    if (kp) {
                                        prodName = kp.name;
                                        farmName = prefix.replace(prodName, '').trim();
                                    }

                                    rows.push({
                                        farmerName: farmName,
                                        productName: prodName,
                                        weight: parseInt(possibleWeight),
                                        driverName: driver.replace(/[()]/g, '').trim(),
                                        invoiceNumber: invoice
                                    });
                                }
                            }
                        }
                    } else {
                        // --- Entry local PDF parsing logic ---
                        const tokens = cols.map(c => ({ str: c.str.trim(), x: c.x })).filter(t => t.str !== '');
                        if (tokens.length < 3) continue;

                        let startIndex = 0;
                        const firstEng = toEnglishDigits(tokens[0].str);
                        if (/^\d+$/.test(firstEng) && parseInt(firstEng) < 100) {
                            startIndex = 1;
                        }

                        const remainingTokens = tokens.slice(startIndex);
                        
                        let parts: { type: 'str' | 'num', text: string }[] = [];
                        remainingTokens.forEach(tok => {
                            const normStr = toEnglishDigits(tok.str).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
                            if (!normStr) return;
                            const t = /^\d+$/.test(normStr) ? 'num' : 'str';
                            if (parts.length > 0 && parts[parts.length - 1].type === t) {
                                parts[parts.length - 1].text += ' ' + tok.str;
                            } else {
                                parts.push({ type: t, text: tok.str });
                            }
                        });

                        if (parts.length >= 2) {
                            let sellerAndProd = parts[0].text;
                            let sellerName = sellerAndProd;
                            let productName = '';

                            const knownProduct = settings.products.find(p => sellerAndProd.includes(p.name));
                            if (knownProduct) {
                                productName = knownProduct.name;
                                sellerName = sellerAndProd.replace(productName, '').replace(/-|\s+/g, ' ').trim();
                            }

                            let billWeight = 0;
                            let scaleWeight = 0;
                            if (parts[1] && parts[1].type === 'num') {
                                const nums = toEnglishDigits(parts[1].text).split(/\s+/).map(n => parseInt(n)).filter(n => !isNaN(n));
                                if (nums.length >= 2) {
                                    billWeight = nums[0];
                                    scaleWeight = nums[1];
                                } else if (nums.length === 1) {
                                    billWeight = nums[0];
                                    scaleWeight = nums[0];
                                }
                            }

                            let driverName = '';
                            if (parts[2] && parts[2].type === 'str') {
                                driverName = parts[2].text.replace(/[()]/g, '').trim();
                            }

                            let billNumber = '';
                            if (parts[3] && parts[3].type === 'num') {
                                const billNums = toEnglishDigits(parts[3].text).split(/\s+/).filter(Boolean);
                                if (billNums.length > 0) {
                                    billNumber = billNums[0];
                                }
                            }

                            let origin = '';
                            let transportCost = 0;
                            if (parts[4] && parts[4].type === 'str') {
                                origin = parts[4].text.trim();
                            }
                            if (parts[5] && parts[5].type === 'num') {
                                transportCost = parseInt(toEnglishDigits(parts[5].text)) || 0;
                            }

                            rows.push({
                                sellerName,
                                productName,
                                billWeight,
                                scaleWeight,
                                driverName,
                                billNumber,
                                origin,
                                transportCost,
                                driverPhone: '',
                                driverIBAN: ''
                            });
                        }
                    }
                }
            }
            return rows;
        } catch (e) {
            console.error(e);
            throw new Error("خطا در پردازش فایل PDF");
        }
    };

    const handleAnalyze = async () => {
        if (!file || !preview) return;
        
        const emptyRow = type === 'entry' ? {
            sellerName: '', productName: '', billWeight: 0, scaleWeight: 0, driverName: '', billNumber: '', origin: '', transportCost: 0, driverPhone: '', driverIBAN: ''
        } : {
            farmerName: '', productName: '', weight: 0, driverName: '', invoiceNumber: ''
        };

        const performAiExtraction = async () => {
            const base64Data = preview.split(',')[1];
            const mimeType = file.type || 'application/pdf';

            const knownFarmers = dataService.getFarmers().map(f => f.name);
            const knownProducts = settings.products.filter(p => !p.isDeleted).map(p => p.name);
            const knownDrivers = dataService.getDrivers();

            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base64Data, mimeType, type, knownFarmers, knownProducts, knownDrivers })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "خطا در برقراری ارتباط با سرور");
            }

            const rawData = await response.json();
            
            let processedData: ExtractedRow[] = [];
            if (Array.isArray(rawData)) {
                if (type === 'entry') {
                    processedData = rawData.map((row: any) => ({
                        sellerName: row.sellerName?.trim() || '',
                        productName: row.productName?.trim() || '',
                        billWeight: Number(row.billWeight || 0),
                        scaleWeight: Number(row.scaleWeight || 0),
                        driverName: row.driverName?.trim() || '',
                        billNumber: row.billNumber ? toEnglishDigits(row.billNumber).replace(/[^0-9]/g, '') : '',
                        origin: row.origin?.trim() || '',
                        transportCost: Number(row.transportCost || 0),
                        driverPhone: row.driverPhone ? toEnglishDigits(row.driverPhone).trim() : '',
                        driverIBAN: row.driverIBAN ? toEnglishDigits(row.driverIBAN).trim() : ''
                    }));
                } else {
                    processedData = rawData.map((row: any) => ({
                        farmerName: row.farmerName?.trim() || '',
                        productName: row.productName?.trim() || '',
                        weight: Number(row.weight || 0),
                        driverName: row.driverName?.trim() || '',
                        invoiceNumber: row.invoiceNumber ? toEnglishDigits(row.invoiceNumber).replace(/[^0-9]/g, '') : '',
                    }));
                }
            }

            setExtractedData(processedData.length > 0 ? processedData : Array(5).fill(emptyRow));
            setStep('preview');
            showToast("اطلاعات پی‌دی‌اف با موفقیت توسط هوش مصنوعی استخراج شد.", 'success');
        };

        // Use Local PDF Parser if it's a PDF
        if (file.type === 'application/pdf') {
            setLoading(true);
            try {
                const rows = await processPdfLocally(file);
                if (rows.length === 0) {
                    if (hasApiKey) {
                        showToast('در حال تلاش برای استخراج داده‌ها با هوش مصنوعی...', 'info');
                        await performAiExtraction();
                    } else {
                        showToast('هیچ داده‌ای در فایل یافت نشد یا فرمت جدول متفاوت است.', 'warning');
                        setExtractedData(Array(5).fill(emptyRow));
                        setStep('preview');
                    }
                } else {
                    setExtractedData(rows);
                    showToast(`${rows.length} ردیف استخراج شد.`, 'success');
                    setStep('preview');
                }
            } catch (error) {
                console.error("Local parsing failed, trying AI fallback...", error);
                if (hasApiKey) {
                    showToast('در حال استخراج داده‌ها با هوش مصنوعی کمکی...', 'info');
                    try {
                        await performAiExtraction();
                    } catch (aiErr) {
                        console.error("AI Fallback failed too:", aiErr);
                        showToast('خطا در هوش مصنوعی. لطفا دستی وارد کنید.', 'error');
                        setExtractedData(Array(5).fill(emptyRow));
                        setStep('preview');
                    }
                } else {
                    const errMsg = (error as any)?.message || String(error);
                    showToast(`خطا در خواندن PDF: ${errMsg}. لطفا دستی وارد کنید.`, 'error');
                    setExtractedData(Array(5).fill(emptyRow));
                    setStep('preview');
                }
            } finally {
                setLoading(false);
            }
            return;
        }

        // --- AI Image Fallback (Original Logic) ---
        // If no API Key and not PDF, switch to manual
        if (!hasApiKey) {
            setExtractedData(Array(10).fill(emptyRow));
            setStep('preview');
            showToast('حالت ورود دستی فعال شد (کلید API یافت نشد).', 'info');
            return;
        }

        setLoading(true);
        try {
            await performAiExtraction();
        } catch (error: any) {
            console.error("AI Error:", error);
            setExtractedData(Array(5).fill(emptyRow));
            setStep('preview');
            showToast("خطا در هوش مصنوعی. لطفاً دستی وارد کنید.", 'warning');
        } finally {
            setLoading(false);
        }
    };

    const handleRowChange = (index: number, field: keyof ExtractedRow, value: any) => {
        const newData = [...extractedData];
        newData[index] = { ...newData[index], [field]: value };
        setExtractedData(newData);
    };

    const handleAddRow = () => {
        const emptyRow = type === 'entry' ? {
            sellerName: '', productName: '', billWeight: 0, scaleWeight: 0, driverName: '', billNumber: '', origin: '', transportCost: 0, driverPhone: '', driverIBAN: ''
        } : {
            farmerName: '', productName: '', weight: 0, driverName: '', invoiceNumber: ''
        };
        setExtractedData([...extractedData, emptyRow]);
    };

    const handleRemoveRow = (index: number) => {
        setExtractedData(extractedData.filter((_, i) => i !== index));
    };

    const handleConfirm = async () => {
        setLoading(true);
        let count = 0;
        const currentFarmers = dataService.getFarmers();
        const farmersMap = new Map(currentFarmers.map(f => [f.name.trim(), f.id]));
        const currentSettings = dataService.loadSettings();
        const currentDrivers = dataService.getDrivers();
        const driversSet = new Set(currentDrivers.map(d => d.trim()));
        let newProductsAdded = false;
        let newFarmersAdded = false;
        let newDriversAdded = false;

        const newFarmers: Farmer[] = [];
        const defaultDateStr = formatToISODate(importDate);

        // Pre-process drivers
        const addDriverIfNeeded = (dName: string | undefined) => {
             const name = dName?.trim();
             if (name && !driversSet.has(name)) {
                 driversSet.add(name);
                 currentDrivers.push(name);
                 newDriversAdded = true;
             }
        };

        if (type === 'exit') {
            const validRows = extractedData.filter(row => (row.weight || 0) > 0 || (row.farmerName || '').trim() !== '');

            for (const row of validRows) {
                const fName = row.farmerName?.trim();
                if (fName && !farmersMap.has(fName)) {
                     const newFarmer: Farmer = { 
                        id: `farmer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, 
                        name: fName, 
                        broods: [] 
                    };
                    newFarmers.push(newFarmer);
                    farmersMap.set(fName, newFarmer.id);
                    newFarmersAdded = true;
                }
                
                const pName = row.productName?.trim();
                if (pName) {
                    const exists = currentSettings.products.some(p => p.name === pName);
                    if (!exists) {
                        currentSettings.products.push({
                             id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                             name: pName,
                             type: 'finishedGood'
                        });
                        newProductsAdded = true;
                    }
                }
                
                addDriverIfNeeded(row.driverName);
            }

            if (newFarmersAdded) {
                dataService.saveFarmers([...currentFarmers, ...newFarmers]);
                await dataService.logAction('created', 'farmer', { count: newFarmers.length, names: newFarmers.map(f => f.name).join(', ') });
            }
            if (newProductsAdded) {
                dataService.saveSettings(currentSettings);
                loadSettings();
            }
            if (newDriversAdded) {
                dataService.saveDrivers(currentDrivers);
            }

            for (const row of validRows) {
                 const fName = row.farmerName?.trim();
                 const farmerId = farmersMap.get(fName);
                 const pName = row.productName?.trim();
                 const product = currentSettings.products.find(p => p.name === pName);
                 
                 if (farmerId) {
                     await dataService.addInvoice({
                        date: row.dateStr || defaultDateStr,
                        farmerId: farmerId,
                        productId: product?.id || 'unknown',
                        weight: row.weight || 0,
                        driverName: row.driverName,
                        invoiceNumber: row.invoiceNumber,
                        productVariant: !product ? pName : undefined
                     }, 'exit');
                     count++;
                 }
            }
        } else {
            // --- Entry Confirmation ---
            const validRows = extractedData.filter(row => (row.sellerName || '').trim() !== '' || (row.scaleWeight || 0) > 0);

            for (const row of validRows) {
                const pName = row.productName?.trim();
                if (pName) {
                    const exists = currentSettings.products.some(p => p.name === pName);
                    if (!exists) {
                        currentSettings.products.push({
                             id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                             name: pName,
                             type: 'rawMaterial'
                        });
                        newProductsAdded = true;
                    }
                }
                addDriverIfNeeded(row.driverName);
            }

            if (newProductsAdded) {
                dataService.saveSettings(currentSettings);
                loadSettings();
            }
            if (newDriversAdded) {
                dataService.saveDrivers(currentDrivers);
            }

            for (const row of validRows) {
                const pName = row.productName?.trim();
                const product = currentSettings.products.find(p => p.name === pName);

                await dataService.addInvoice({
                    date: row.dateStr || defaultDateStr,
                    sellerName: row.sellerName?.trim() || '',
                    productId: product?.id || 'unknown',
                    billWeight: Number(row.billWeight || 0),
                    scaleWeight: Number(row.scaleWeight || 0),
                    driverName: row.driverName || '',
                    billNumber: row.billNumber || '',
                    origin: row.origin || '',
                    transportCost: Number(row.transportCost || 0),
                    driverPhone: row.driverPhone || '',
                    driverIBAN: row.driverIBAN || ''
                }, 'entry');
                count++;
            }
        }

        setLoading(false);
        showToast(`${toPersianNumerals(count)} رکورد با موفقیت ثبت شد.`);
        if (newFarmersAdded) showToast('مرغداران جدید ایجاد شدند.', 'info');
        if (newDriversAdded) showToast('رانندگان جدید به لیست افزوده شدند.', 'info');
        if (newProductsAdded) showToast('محصولات جدید به تنظیمات افزوده شدند.', 'info');
        
        onSuccess();
        onClose();
        setStep('upload');
        setExtractedData([]);
        setFile(null);
        setPreview(null);
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={step === 'preview' ? "بررسی و ویرایش داده‌ها" : (type === 'entry' ? "وارد کردن حواله ورود (تصویر/PDF)" : "وارد کردن حواله خروج (تصویر/PDF)")} footer={
            step === 'preview' ? (
                 <>
                    <button onClick={() => setStep('upload')} className="px-4 py-2 text-slate-600">بازگشت</button>
                    <button onClick={handleAddRow} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">+ سطر جدید</button>
                    <button onClick={handleConfirm} disabled={loading} className="bg-green-500 text-white px-4 py-2 rounded-lg">{loading ? 'در حال ثبت...' : 'تایید و ثبت نهایی'}</button>
                </>
            ) : null
        }>
            {step === 'upload' ? (
                 <div className="space-y-4 text-center">
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-right">
                         <label className="block text-sm font-bold text-slate-700 mb-2">تاریخ ثبت:</label>
                         <DatePicker id="img-import-date" value={importDate} onChange={setImportDate} />
                    </div>
                    
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 bg-slate-50">
                        {preview ? (
                            <div className="mb-4">
                                {file?.type === 'application/pdf' ? (
                                    <div className="flex flex-col items-center justify-center p-4 bg-gray-100 rounded text-gray-600">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 text-red-500 mb-2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                        </svg>
                                        <span className="font-bold">{file.name}</span>
                                        <span className="text-xs mt-1">فایل PDF آماده پردازش</span>
                                    </div>
                                ) : (
                                    <img src={preview} alt="Preview" className="max-h-64 mx-auto rounded shadow" />
                                )}
                                <button onClick={() => { setFile(null); setPreview(null); }} className="text-red-500 text-sm mt-2">حذف فایل</button>
                            </div>
                        ) : (
                            <div className="py-8">
                                <p className="mb-2 text-slate-600">تصویر یا فایل PDF جدول حواله‌ها را انتخاب کنید</p>
                                <input type="file" accept=".jpg, .jpeg, .png, .webp, .pdf" onChange={handleFileChange} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"/>
                            </div>
                        )}
                    </div>
                    
                    {preview && (
                        <button onClick={handleAnalyze} disabled={loading} className={`w-full text-white p-3 rounded-lg font-bold hover:opacity-90 disabled:opacity-50 ${file?.type === 'application/pdf' ? 'bg-blue-600' : (hasApiKey ? 'bg-purple-600' : 'bg-slate-600')}`}>
                            {loading ? 'در حال پردازش...' : (file?.type === 'application/pdf' ? 'پردازش PDF (آفلاین)' : (hasApiKey ? 'تحلیل تصویر (AI)' : 'ورود دستی (نمایش فایل)'))}
                        </button>
                    )}
                 </div>
            ) : (
                 <div className="flex flex-col md:flex-row gap-4 h-[80vh]">
                    <div className="w-full md:w-5/12 bg-slate-100 rounded-lg overflow-hidden border border-slate-300 flex flex-col">
                         <div className="bg-slate-200 p-2 text-xs font-bold text-slate-600 text-center border-b">فایل اصلی</div>
                         <div className="flex-grow relative bg-slate-500">
                             {file?.type === 'application/pdf' ? (
                                 <embed src={preview!} type="application/pdf" className="w-full h-full" />
                             ) : (
                                 <div className="w-full h-full overflow-auto flex items-start justify-center">
                                     <img src={preview!} alt="Source" className="max-w-full h-auto" />
                                 </div>
                             )}
                         </div>
                    </div>

                    <div className="w-full md:w-7/12 flex flex-col">
                        <div className="bg-slate-100 p-2 text-xs font-bold text-slate-600 text-center border rounded-t-lg">داده‌های استخراج شده / فرم ورود</div>
                        
                        {/* Auto-complete datalists */}
                        <datalist id="farmers-list">
                            {dataService.getFarmers().filter(f => !f.isDeleted).map(f => <option key={f.id} value={f.name} />)}
                        </datalist>
                        <datalist id="drivers-list">
                            {dataService.getDrivers().map(d => <option key={d} value={d} />)}
                        </datalist>
                        <datalist id="products-list">
                            {settings.products.filter(p => !p.isDeleted).map(p => <option key={p.id} value={p.name} />)}
                        </datalist>

                        <div className="overflow-auto flex-grow border border-t-0 rounded-b-lg">
                            <table className="w-full text-xs text-center border-collapse">
                                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                    {type === 'exit' ? (
                                        <tr>
                                            <th className="p-2 border">نام مرغدار</th>
                                            <th className="p-2 border">محصول</th>
                                            <th className="p-2 border w-20">وزن</th>
                                            <th className="p-2 border">راننده</th>
                                            <th className="p-2 border w-24">شماره حواله</th>
                                            <th className="p-2 border w-10"></th>
                                        </tr>
                                    ) : (
                                        <tr>
                                            <th className="p-2 border">فروشنده</th>
                                            <th className="p-2 border">محصول</th>
                                            <th className="p-2 border w-20">وزن بارنامه</th>
                                            <th className="p-2 border w-20">وزن باسکول</th>
                                            <th className="p-2 border">راننده</th>
                                            <th className="p-2 border w-24">شماره بارنامه</th>
                                            <th className="p-2 border">مبدا</th>
                                            <th className="p-2 border">کرایه</th>
                                            <th className="p-2 border">تلفن</th>
                                            <th className="p-2 border">شبا</th>
                                            <th className="p-2 border w-10"></th>
                                        </tr>
                                    )}
                                </thead>
                                <tbody>
                                    {extractedData.map((row, i) => (
                                        <tr key={i} className="border-b hover:bg-slate-50">
                                            {type === 'exit' ? (
                                                <>
                                                    <td className="p-1 border mt-1">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.farmerName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'farmerName', e.target.value)} 
                                                            placeholder="نام مرغدار"
                                                            list="farmers-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.productName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'productName', e.target.value)}
                                                            placeholder="نوع محصول"
                                                            list="products-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            type="number"
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr font-bold" 
                                                            value={row.weight || ''} 
                                                            onChange={(e) => handleRowChange(i, 'weight', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.driverName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'driverName', e.target.value)}
                                                            list="drivers-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr" 
                                                            value={row.invoiceNumber || ''} 
                                                            onChange={(e) => handleRowChange(i, 'invoiceNumber', e.target.value)}
                                                        />
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="p-1 border mt-1">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.sellerName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'sellerName', e.target.value)} 
                                                            placeholder="فروشنده"
                                                            list="farmers-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.productName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'productName', e.target.value)}
                                                            placeholder="نوع محصول"
                                                            list="products-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            type="number"
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr font-bold w-16" 
                                                            value={row.billWeight || ''} 
                                                            onChange={(e) => handleRowChange(i, 'billWeight', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            type="number"
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr font-bold w-16" 
                                                            value={row.scaleWeight || ''} 
                                                            onChange={(e) => handleRowChange(i, 'scaleWeight', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.driverName || ''} 
                                                            onChange={(e) => handleRowChange(i, 'driverName', e.target.value)}
                                                            placeholder="راندده"
                                                            list="drivers-list"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr w-16" 
                                                            value={row.billNumber || ''} 
                                                            onChange={(e) => handleRowChange(i, 'billNumber', e.target.value)}
                                                            placeholder="بارنامه"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded" 
                                                            value={row.origin || ''} 
                                                            onChange={(e) => handleRowChange(i, 'origin', e.target.value)}
                                                            placeholder="مبدا"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            type="number"
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr w-16" 
                                                            value={row.transportCost || ''} 
                                                            onChange={(e) => handleRowChange(i, 'transportCost', parseFloat(e.target.value) || 0)}
                                                            placeholder="کرایه"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr text-xs w-20" 
                                                            value={row.driverPhone || ''} 
                                                            onChange={(e) => handleRowChange(i, 'driverPhone', e.target.value)}
                                                            placeholder="تلفنی"
                                                        />
                                                    </td>
                                                    <td className="p-1 border">
                                                        <input 
                                                            className="w-full p-1 bg-transparent focus:bg-white rounded text-center dir-ltr text-xs w-24" 
                                                            value={row.driverIBAN || ''} 
                                                            onChange={(e) => handleRowChange(i, 'driverIBAN', e.target.value)}
                                                            placeholder="شبا / کارت"
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            <td className="p-1 border">
                                                <button onClick={() => handleRemoveRow(i)} className="text-red-500 hover:text-red-700 font-bold text-lg px-1">&times;</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                 </div>
            )}
        </Modal>
    );
};

export default ImageImportModal;
