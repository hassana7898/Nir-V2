import React, { useState, useEffect, useMemo } from 'react';
import DatePicker from '../components/DatePicker';
import { Remittance, Entry, Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { showToast } from '../utils/helpers';
import { toPersianNumerals, formatToISODate } from '../utils/formatters';
import { useSettings } from '../contexts/SettingsContext';
import { handlePrint } from '../utils/print';

const InventoryAnalysisPage: React.FC = () => {
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(1);
        return d;
    });
    const [endDate, setEndDate] = useState(new Date());
    const [startEntryId, setStartEntryId] = useState('');
    const [startExitId, setStartExitId] = useState('');
    const [reportData, setReportData] = useState<any[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [remittancesInRange, setRemittancesInRange] = useState<Remittance[]>([]);
    const [farmers, setFarmers] = useState<Farmer[]>([]);
    
    const { settings } = useSettings();
    const farmerMap = useMemo(() => new Map(farmers.map(f => [f.id, f.name])), [farmers]);

    useEffect(() => {
        const start = formatToISODate(startDate);
        const end = formatToISODate(endDate);
        const remittances = dataService.getInvoicesByDateRange(start, end);
        setRemittancesInRange(remittances.sort((a,b) => a.createdAt - b.createdAt));
        setFarmers(dataService.getFarmers());
    }, [startDate, endDate]);

    const handleGenerateReport = async () => {
        setLoading(true);
        try {
            const data = await dataService.getAdvancedInventoryReport(startDate, endDate, startEntryId, startExitId);
            setReportData(data);
            showToast('گزارش با موفقیت ایجاد شد.');
        } catch (error) {
            console.error(error);
            showToast('خطا در ایجاد گزارش', 'error');
        } finally {
            setLoading(false);
        }
    };
    
    const renderNumber = (num: number) => {
        const fixedNum = parseFloat(num.toFixed(2));
        const formatted = toPersianNumerals(fixedNum.toLocaleString('fa-IR'));
        if (fixedNum < 0) return <span className="text-red-600">{formatted}</span>;
        if (fixedNum > 0) return <span className="text-slate-800">{formatted}</span>;
        return <span className="text-slate-400">{formatted}</span>;
    }

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-md no-print">
                <h1 className="text-2xl font-bold text-slate-700 mb-4">آنالیز و گزارش جامع انبار</h1>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="mb-1 text-sm font-semibold text-slate-600">از تاریخ</label>
                        <DatePicker id="analysis-start-date" value={startDate} onChange={setStartDate} />
                    </div>
                    <div>
                        <label className="mb-1 text-sm font-semibold text-slate-600">تا تاریخ</label>
                        <DatePicker id="analysis-end-date" value={endDate} onChange={setEndDate} />
                    </div>
                    <div className="col-span-2">
                        <button onClick={handleGenerateReport} disabled={loading} className="w-full bg-blue-500 text-white p-2.5 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300">
                           {loading ? 'در حال پردازش...' : 'ایجاد گزارش'}
                        </button>
                    </div>
                    <details className="col-span-full">
                        <summary className="text-sm font-semibold text-slate-600 cursor-pointer">تنظیمات پیشرفته (اختیاری)</summary>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 p-4 bg-slate-50 rounded-lg">
                           <div>
                                <label className="mb-1 text-xs font-semibold text-slate-500">شروع محاسبه از حواله ورود شماره</label>
                                <select value={startEntryId} onChange={e => setStartEntryId(e.target.value)} className="w-full p-2 border rounded-lg text-sm">
                                    <option value="">-- از ابتدا --</option>
                                    {remittancesInRange.filter(r => 'sellerName' in r).map(r => {
                                        const entry = r as Entry;
                                        const optionText = entry.billNumber ? `بارنامه ${toPersianNumerals(entry.billNumber)} (${entry.sellerName})` : `ID: ${entry.id.slice(-6)} (${entry.sellerName})`;
                                        return <option key={entry.id} value={entry.id}>{optionText}</option>;
                                    })}
                                </select>
                           </div>
                            <div>
                                <label className="mb-1 text-xs font-semibold text-slate-500">شروع محاسبه از حواله خروج شماره</label>
                                <select value={startExitId} onChange={e => setStartExitId(e.target.value)} className="w-full p-2 border rounded-lg text-sm">
                                    <option value="">-- از ابتدا --</option>
                                    {/* Fix: Check for 'farmerId' to identify Exit remittances and use farmerMap to get the name */}
                                    {remittancesInRange.filter(r => 'farmerId' in r).map(r => {
                                        const exit = r as Exit;
                                        const farmerName = farmerMap.get(exit.farmerId) || '؟';
                                        const optionText = exit.invoiceNumber ? `حواله ${toPersianNumerals(exit.invoiceNumber)} (${farmerName})` : `ID: ${exit.id.slice(-6)} (${farmerName})`;
                                        return <option key={exit.id} value={exit.id}>{optionText}</option>
                                    })}
                                </select>
                           </div>
                           <p className="text-xs text-slate-500 col-span-full">با انتخاب یک حواله، محاسبات فقط برای تراکنش‌های بعد از آن انجام می‌شود.</p>
                        </div>
                    </details>
                </div>
            </div>

            {reportData && (
                <div className="bg-white p-5 rounded-xl shadow-md">
                     <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-slate-600">نتایج گزارش</h2>
                        <button onClick={() => handlePrint('analysis', reportData, { startDate, endDate })} className="no-print bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors">چاپ گزارش</button>
                     </div>
                     <div className="overflow-x-auto">
                        <table id="analysis-table" className="w-full text-sm text-center">
                            <thead className="bg-slate-100">
                                <tr>
                                    <th className="p-2" rowSpan={2}>نام محصول</th>
                                    <th className="p-2" rowSpan={2}>موجودی اولیه</th>
                                    <th className="p-2 text-green-600" colSpan={2}>ورودی‌ها</th>
                                    <th className="p-2 text-red-600" colSpan={2}>خروجی‌ها</th>
                                    <th className="p-2 text-blue-600" rowSpan={2}>اصلاحات</th>
                                    <th className="p-2" rowSpan={2}>موجودی نهایی</th>
                                </tr>
                                <tr>
                                    <th className="p-2 bg-green-50">خرید</th>
                                    <th className="p-2 bg-green-50">تولید</th>
                                    <th className="p-2 bg-red-50">فروش</th>
                                    <th className="p-2 bg-red-50">مصرف در تولید</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map(item => (
                                    <tr key={item.productId} className="border-b">
                                        <td className="p-2 font-semibold">{item.productName}</td>
                                        <td className="p-2 font-mono">{renderNumber(item.opening)}</td>
                                        <td className="p-2 font-mono bg-green-50">{renderNumber(item.entries)}</td>
                                        <td className="p-2 font-mono bg-green-50">{renderNumber(item.produced)}</td>
                                        <td className="p-2 font-mono bg-red-50">{renderNumber(item.exits)}</td>
                                        <td className="p-2 font-mono bg-red-50">{renderNumber(item.consumed)}</td>
                                        <td className="p-2 font-mono">{renderNumber(item.adjustments)}</td>
                                        <td className="p-2 font-mono font-bold">{renderNumber(item.closing)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                     </div>
                </div>
            )}
        </div>
    );
};

export default InventoryAnalysisPage;