
import React, { useState, useEffect, useCallback } from 'react';
import DatePicker from '../components/DatePicker';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatToISODate } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import Swal from 'sweetalert2';

const InventoryPage: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [inventory, setInventory] = useState<Map<string, number>>(new Map());
    
    const { settings } = useSettings();

    const fetchInventory = useCallback(() => {
        const inventoryData = dataService.getInventoryStatus(currentDate);
        setInventory(inventoryData);
    }, [currentDate]);

    useEffect(() => {
        fetchInventory();
    }, [fetchInventory]);

    const getProductTypeLabel = (type: 'rawMaterial' | 'finishedGood') => {
        return type === 'rawMaterial' ? 'ماده اولیه' : 'محصول نهایی';
    };
    
    const handleAdjustInventory = (productId: string, productName: string, currentStock: number) => {
        Swal.fire({
            title: `اصلاح موجودی ${productName}`,
            html: `
                <p class="text-sm mb-2">موجودی فعلی: <strong>${toPersianNumerals(currentStock.toLocaleString())}</strong> کیلوگرم</p>
                <input type="number" id="newQuantity" class="swal2-input" placeholder="مقدار جدید (کیلوگرم)">
                <input type="text" id="reason" class="swal2-input" placeholder="دلیل اصلاح (مثلا: انبارگردانی)">
            `,
            confirmButtonText: 'ثبت اصلاحیه',
            showCancelButton: true,
            cancelButtonText: 'لغو',
            preConfirm: () => {
                const newQuantity = (document.getElementById('newQuantity') as HTMLInputElement).value;
                const reason = (document.getElementById('reason') as HTMLInputElement).value;
                if (!newQuantity || isNaN(parseFloat(newQuantity))) {
                    Swal.showValidationMessage('لطفا مقدار عددی جدید را وارد کنید');
                    return false;
                }
                if (!reason) {
                    Swal.showValidationMessage('لطفا دلیل اصلاح را وارد کنید');
                    return false;
                }
                return { newQuantity: parseFloat(newQuantity), reason };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const { newQuantity, reason } = result.value;
                dataService.addInventoryAdjustment({
                    date: formatToISODate(new Date()),
                    productId,
                    newQuantity,
                    reason,
                });
                showToast('موجودی با موفقیت اصلاح شد.');
                fetchInventory(); // Refresh inventory data
            }
        });
    };


    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-md">
                <div className="flex justify-between items-center flex-wrap gap-4">
                    <h1 className="text-2xl font-bold text-slate-700">موجودی انبار</h1>
                    <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
                        <label>موجودی لحظه‌ای در تاریخ:</label>
                        <DatePicker id="inventory-date-picker" value={currentDate} onChange={setCurrentDate} />
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md">
                 <h2 className="text-xl font-bold text-slate-700 mb-4">جدول موجودی لحظه‌ای</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-center">
                        <thead className="bg-slate-100">
                            <tr>
                                <th className="p-3">نام محصول</th>
                                <th className="p-3">نوع محصول</th>
                                <th className="p-3">موجودی (kg)</th>
                                <th className="p-3">عملیات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {settings.products.length === 0 ? (
                                <tr><td colSpan={4} className="text-center p-4 text-slate-500">محصولی در تنظیمات تعریف نشده است.</td></tr>
                            ) : (
                                settings.products.filter(p => !p.isDeleted).map(product => {
                                    const stock = inventory.get(product.id) || 0;
                                    return (
                                        <tr key={product.id} className="border-b hover:bg-slate-50">
                                            <td className="p-3">{product.name}</td>
                                            <td className="p-3">{getProductTypeLabel(product.type)}</td>
                                            <td className={`p-3 font-semibold ${stock < 0 ? 'text-red-500' : 'text-slate-800'}`}>
                                                {toPersianNumerals(stock.toLocaleString('fa-IR'))}
                                            </td>
                                            <td className="p-3">
                                                <button onClick={() => handleAdjustInventory(product.id, product.name, stock)} className="bg-yellow-500 text-white px-3 py-1 text-xs rounded-lg hover:bg-yellow-600">اصلاح</button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default InventoryPage;
