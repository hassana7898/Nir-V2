
import React, { useState, useMemo, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { Formula, FormulaItem, Product, ProductionRecord } from '../types';
import * as dataService from '../services/dataService';
import { showToast } from '../utils/helpers';
import { toPersianNumerals, formatToISODate } from '../utils/formatters';
import Swal from 'sweetalert2';
import DatePicker from '../components/DatePicker';

const ProductionPage: React.FC = () => {
    const { settings, productMap } = useSettings();
    const [formulas, setFormulas] = useState<Formula[]>([]);
    
    // State for creating/editing a formula
    const [editingFormula, setEditingFormula] = useState<Formula | null>(null);
    const [selectedFinishedGood, setSelectedFinishedGood] = useState<string>('');
    const [formulaItems, setFormulaItems] = useState<FormulaItem[]>([]);
    const [selectedRawMaterial, setSelectedRawMaterial] = useState<string>('');
    const [rawMaterialQty, setRawMaterialQty] = useState<number>(0);

    // State for recording production
    const [productionDate, setProductionDate] = useState(new Date());
    const [prodFinishedGood, setProdFinishedGood] = useState('');
    const [prodQty, setProdQty] = useState(0);
    const [dailyProductions, setDailyProductions] = useState<ProductionRecord[]>([]);


    const { rawMaterials, finishedGoods } = useMemo(() => {
        const raw: Product[] = [];
        const finished: Product[] = [];
        settings.products.forEach(p => {
            if (p.isDeleted) return;
            p.type === 'rawMaterial' ? raw.push(p) : finished.push(p);
        });
        return { rawMaterials: raw, finishedGoods: finished };
    }, [settings.products]);

    useEffect(() => {
        setFormulas(dataService.getFormulas());
        const productions = dataService.getProductionRecordsByDate(productionDate);
        setDailyProductions(productions);

        if (finishedGoods.length > 0) {
            if (!selectedFinishedGood) setSelectedFinishedGood(finishedGoods[0].id);
            if (!prodFinishedGood) setProdFinishedGood(finishedGoods[0].id);
        }
        if (rawMaterials.length > 0 && !selectedRawMaterial) {
            setSelectedRawMaterial(rawMaterials[0].id);
        }
    }, [finishedGoods, rawMaterials, productionDate]);

    const handleAddFormulaItem = () => {
        if (!selectedRawMaterial || rawMaterialQty <= 0) {
            showToast('لطفا ماده اولیه و مقدار معتبر را وارد کنید', 'warning');
            return;
        }
        if (formulaItems.some(item => item.productId === selectedRawMaterial)) {
            showToast('این ماده قبلا اضافه شده است', 'warning');
            return;
        }
        setFormulaItems([...formulaItems, { productId: selectedRawMaterial, quantity: rawMaterialQty / 1000 }]);
        setRawMaterialQty(0);
    };
    
    const handleRemoveFormulaItem = (productId: string) => {
        setFormulaItems(formulaItems.filter(item => item.productId !== productId));
    };

    const ingredientsSum = useMemo(() => {
        return formulaItems.reduce((acc, item) => acc + (item.quantity * 1000), 0);
    }, [formulaItems]);
    
    const handleSaveFormula = async () => {
        if (!selectedFinishedGood || formulaItems.length === 0) {
            showToast('لطفا محصول نهایی و حداقل یک ماده اولیه را انتخاب کنید', 'error');
            return;
        }

        if (Math.abs(ingredientsSum - 1000) > 0.01) { // Tolerance for float issues
            const result = await Swal.fire({
                title: 'هشدار',
                text: `مجموع مواد اولیه (${toPersianNumerals(ingredientsSum.toFixed(2))} کیلوگرم) برابر با ۱۰۰۰ کیلوگرم نیست. آیا از ذخیره فرمول مطمئن هستید؟`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'بله، ذخیره کن',
                cancelButtonText: 'خیر، اصلاح می‌کنم'
            });
            if (!result.isConfirmed) {
                return;
            }
        }
        
        if (editingFormula) {
            const updatedFormula = { ...editingFormula, items: formulaItems };
            dataService.updateFormula(updatedFormula);
            showToast('فرمول با موفقیت ویرایش شد.');
        } else {
            const existingFormula = formulas.find(f => f.finishedGoodId === selectedFinishedGood);
            if (existingFormula) {
                showToast('برای این محصول قبلا فرمول ثبت شده است. برای ویرایش، از دکمه ویرایش استفاده کنید.', 'error');
                return;
            }
            dataService.saveFormula({ finishedGoodId: selectedFinishedGood, items: formulaItems });
            showToast('فرمول با موفقیت ذخیره شد');
        }

        setFormulas(dataService.getFormulas());
        handleCancelEdit(); // Reset form
    };

    const handleDeleteFormula = (id: string) => {
        Swal.fire({
            title: 'آیا از حذف فرمول مطمئن هستید؟',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'بله، حذف کن!',
            cancelButtonText: 'انصراف'
        }).then(result => {
            if (result.isConfirmed) {
                dataService.deleteFormula(id);
                setFormulas(dataService.getFormulas());
                showToast('فرمول حذف شد');
            }
        });
    };
    
    const handleEditClick = (formula: Formula) => {
        setEditingFormula(formula);
        setSelectedFinishedGood(formula.finishedGoodId);
        setFormulaItems(formula.items);
        const formElement = document.getElementById('formula-form-section');
        formElement?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingFormula(null);
        setFormulaItems([]);
        setRawMaterialQty(0);
        if (finishedGoods.length > 0) {
            setSelectedFinishedGood(finishedGoods[0].id);
        }
    };

    const handleCopyFormula = () => {
        if (formulas.length === 0) {
            showToast('هیچ فرمولی برای کپی کردن وجود ندارد.', 'info');
            return;
        }
        const formulaOptions = formulas
            .map(f => `<option value="${f.id}">${productMap.get(f.finishedGoodId)}</option>`)
            .join('');
        
        Swal.fire({
            title: 'کپی مواد اولیه از فرمول دیگر',
            html: `<p class="text-sm my-2">یک فرمول را برای کپی کردن مواد آن انتخاب کنید.</p><select id="swal-formula-select" class="swal2-select">${formulaOptions}</select>`,
            preConfirm: () => (document.getElementById('swal-formula-select') as HTMLSelectElement).value,
            showCancelButton: true,
            confirmButtonText: 'کپی کن',
            cancelButtonText: 'لغو',
        }).then(result => {
            if (result.isConfirmed && result.value) {
                const sourceFormula = formulas.find(f => f.id === result.value);
                if (sourceFormula) {
                    setFormulaItems(sourceFormula.items);
                    showToast('مواد اولیه با موفقیت کپی شد.');
                }
            }
        });
    };


    const handleRecordProduction = () => {
        if (!prodFinishedGood || prodQty <= 0) {
            showToast('لطفا محصول و مقدار تولید معتبر را وارد کنید', 'warning');
            return;
        }
        if (!formulas.some(f => f.finishedGoodId === prodFinishedGood)) {
            showToast('برای این محصول فرمولی تعریف نشده است!', 'error');
            return;
        }
        dataService.addProductionRecord({
            date: formatToISODate(productionDate),
            finishedGoodId: prodFinishedGood,
            quantityProduced: prodQty,
        });
        showToast('تولید با موفقیت ثبت شد');
        setProdQty(0);
        setDailyProductions(dataService.getProductionRecordsByDate(productionDate));
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-md">
                <h1 className="text-2xl font-bold text-slate-700">مدیریت تولید</h1>
                <p className="text-sm text-slate-500 mt-1">در این بخش می‌توانید تولیدات روزانه را ثبت کرده و فرمول‌های ساخت را مدیریت کنید.</p>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md">
                <details open>
                    <summary className="text-xl font-bold text-slate-700 cursor-pointer">ثبت تولید دستی</summary>
                     <div className="mt-4 border-t pt-4 space-y-4">
                        <div className="flex items-end gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-600">تاریخ تولید</label>
                                <DatePicker id="production-date" value={productionDate} onChange={setProductionDate} />
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-slate-600">محصول تولید شده</label>
                                <select value={prodFinishedGood} onChange={e => setProdFinishedGood(e.target.value)} className="w-full p-2 border rounded-lg mt-1 h-11">
                                    {finishedGoods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                             </div>
                              <div>
                                <label className="block text-sm font-medium text-slate-600">مقدار تولید (kg)</label>
                                <input type="number" value={prodQty} onChange={e => setProdQty(parseFloat(e.target.value) || 0)} className="w-full p-2 border rounded-lg mt-1 h-11" />
                             </div>
                             <button onClick={handleRecordProduction} className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 h-11">ثبت تولید</button>
                        </div>

                         <div className="mt-4">
                            <h3 className="font-semibold text-slate-600">تولیدات ثبت شده در این روز:</h3>
                             {dailyProductions.length === 0 ? (
                                <p className="text-sm text-center text-slate-400 mt-2">موردی ثبت نشده است.</p>
                             ) : (
                                <ul className="list-disc list-inside mt-2 text-sm">
                                     {dailyProductions.map(p => (
                                         <li key={p.id}>{productMap.get(p.finishedGoodId)}: {toPersianNumerals(p.quantityProduced)} کیلوگرم</li>
                                     ))}
                                </ul>
                             )}
                        </div>
                     </div>
                </details>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md">
                 <details>
                    <summary className="text-xl font-bold text-slate-700 cursor-pointer">مدیریت فرمول‌های ساخت</summary>
                    <div className="mt-4 border-t pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Create/Edit formula */}
                             <div id="formula-form-section">
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-lg font-bold text-slate-700">
                                        {editingFormula ? `ویرایش فرمول برای ${productMap.get(editingFormula.finishedGoodId)}` : 'تعریف فرمول جدید'}
                                    </h2>
                                    {!editingFormula && <button onClick={handleCopyFormula} className="text-xs bg-slate-200 px-2 py-1 rounded-md hover:bg-slate-300">کپی از...</button>}
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-600">محصول نهایی</label>
                                        <select value={selectedFinishedGood} onChange={e => setSelectedFinishedGood(e.target.value)} className="w-full p-2 border rounded-lg mt-1" disabled={!!editingFormula}>
                                            {finishedGoods.length > 0 ? 
                                                finishedGoods.map(p => <option key={p.id} value={p.id}>{p.name}</option>) :
                                                <option disabled>محصول نهایی تعریف نشده است</option>
                                            }
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-600">مواد اولیه مورد نیاز</label>
                                        <div className="p-2 border rounded-lg mt-1 bg-slate-50 min-h-[80px] space-y-1">
                                            {formulaItems.length === 0 && <p className="text-xs text-slate-400 p-2 text-center">هنوز ماده‌ای اضافه نشده است.</p>}
                                            {formulaItems.map(item => (
                                                <div key={item.productId} className="flex justify-between items-center bg-white p-1.5 rounded my-1 text-sm">
                                                    <span>{productMap.get(item.productId)}: {toPersianNumerals(item.quantity * 1000)} کیلوگرم</span>
                                                    <button onClick={() => handleRemoveFormulaItem(item.productId)} className="text-red-500 text-xs px-2">حذف</button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className={`text-center mt-2 font-bold text-sm ${ingredientsSum === 1000 ? 'text-green-600' : 'text-red-600'}`}>
                                            مجموع مواد: {toPersianNumerals(ingredientsSum.toFixed(2))} / ۱۰۰۰ کیلوگرم
                                        </div>
                                    </div>
                                    <div className="flex items-end gap-2 p-2 border-t">
                                        <div className="flex-1">
                                            <label className="text-sm">ماده اولیه</label>
                                            <select value={selectedRawMaterial} onChange={e => setSelectedRawMaterial(e.target.value)} className="w-full p-2 border rounded-lg">
                                                {rawMaterials.length > 0 ? 
                                                    rawMaterials.map(p => <option key={p.id} value={p.id}>{p.name}</option>) :
                                                    <option disabled>ماده اولیه‌ای تعریف نشده است</option>
                                                }
                                            </select>
                                        </div>
                                        <div style={{maxWidth: '200px'}}>
                                            <label className="text-sm">مقدار برای ۱ تن تولید (kg)</label>
                                            <input type="number" value={rawMaterialQty} onChange={e => setRawMaterialQty(parseFloat(e.target.value) || 0)} className="w-full p-2 border rounded-lg" />
                                        </div>
                                        <button onClick={handleAddFormulaItem} className="bg-sky-500 text-white px-4 py-2 rounded-lg hover:bg-sky-600 h-10">افزودن</button>
                                    </div>
                                    <div className="flex gap-2">
                                        {editingFormula && <button onClick={handleCancelEdit} className="w-full bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">لغو ویرایش</button>}
                                        <button onClick={handleSaveFormula} className="w-full bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">{editingFormula ? 'ذخیره تغییرات' : 'ذخیره فرمول'}</button>
                                    </div>
                                </div>
                            </div>
                             {/* Existing formulas */}
                             <div>
                                <h2 className="text-lg font-bold text-slate-700 mb-4">فرمول‌های موجود</h2>
                                 <div className="space-y-2 max-h-96 overflow-y-auto">
                                     {formulas.length === 0 && <p className="text-sm text-slate-500 text-center">هنوز فرمولی تعریف نشده است.</p>}
                                     {formulas.map(f => (
                                         <div key={f.id} className="p-3 border rounded-lg">
                                            <div className="flex justify-between items-center">
                                                <span className="font-semibold text-slate-800">{productMap.get(f.finishedGoodId)}</span>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleEditClick(f)} className="text-blue-500 hover:text-blue-700 text-sm font-semibold">ویرایش</button>
                                                    <button onClick={() => handleDeleteFormula(f.id)} className="text-red-500 hover:text-red-700 text-sm font-semibold">حذف</button>
                                                </div>
                                            </div>
                                            <ul className="list-disc list-inside mt-2 text-sm text-slate-600">
                                                {f.items.map(item => (
                                                    <li key={item.productId}>{productMap.get(item.productId)}: {toPersianNumerals(item.quantity * 1000)} کیلوگرم</li>
                                                ))}
                                            </ul>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
};

export default ProductionPage;
