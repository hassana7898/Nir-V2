
import React, { useState, useMemo, useEffect } from 'react';
import DatePicker from '../components/DatePicker';
import { Remittance, Entry, Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { showToast } from '../utils/helpers';
import { formatDate, toPersianNumerals, formatToISODate, formatCurrency, formatWastage } from '../utils/formatters';
import { useSettings } from '../contexts/SettingsContext';
import { handlePrint } from '../utils/print';
import { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';

type GroupedResults = Map<string, {
    items: Remittance[];
    summary: {
        totalRemittances: number;
        totalWeight: number;
        productSummary: Map<string, { count: number, totalWeight: number }>;
    };
}>;

const safeParseFloat = (val: any): number => {
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
};

interface Filter {
    id: number;
    field: string;
    value: string;
}

const ReportsPage: React.FC = () => {
    const [startDate, setStartDate] = useState(new Date());
    const [endDate, setEndDate] = useState(new Date());
    const [reportType, setReportType] = useState('all');
    const [groupBy, setGroupBy] = useState('none');
    const [results, setResults] = useState<Remittance[] | GroupedResults | null>(null);
    const [loading, setLoading] = useState(false);
    const [farmers, setFarmers] = useState<Farmer[]>([]);

    const [filters, setFilters] = useState<Filter[]>([{ id: Date.now(), field: 'all', value: '' }]);

    const { productMap } = useSettings();
    const farmerMap = useMemo(() => new Map(farmers.map(f => [f.id, f.name])), [farmers]);

    useEffect(() => {
        setFarmers(dataService.getFarmers());
    }, []);

    // Helper to set range based on Persian Calendar
    const setDateRange = (type: 'daily' | 'weekly' | 'monthly') => {
        const today = new DateObject({ calendar: persian, locale: persian_fa });
        
        if (type === 'daily') {
            const start = today.toDate();
            const end = today.toDate();
            setStartDate(start);
            setEndDate(end);
            showToast('بازه زمانی روی امروز تنظیم شد.');
        } else if (type === 'weekly') {
            // Start of week in Persian calendar is usually Saturday
            // DateObject.toFirstOfWeek() depends on locale. persian_fa usually sets Saturday as first day.
            const start = new DateObject(today).toFirstOfWeek(); 
            const end = new DateObject(today).toLastOfWeek();
            setStartDate(start.toDate());
            setEndDate(end.toDate());
            showToast('بازه زمانی روی هفته جاری تنظیم شد.');
        } else if (type === 'monthly') {
            const start = new DateObject(today).toFirstOfMonth();
            const end = new DateObject(today).toLastOfMonth();
            setStartDate(start.toDate());
            setEndDate(end.toDate());
            showToast('بازه زمانی روی ماه جاری تنظیم شد.');
        }
    };
    
    const filterOptions = [
        { value: 'all', label: 'همه موارد' },
        { value: 'customerName', label: 'نام فروشنده/مرغدار' },
        { value: 'driverName', label: 'نام راننده' },
        { value: 'productName', label: 'محصول' },
        { value: 'invoiceNumber', label: 'شماره حواله/بارنامه' },
    ];
    
    const handleAddFilter = () => {
        setFilters(prev => [...prev, { id: Date.now(), field: 'all', value: '' }]);
    };

    const handleRemoveFilter = (idToRemove: number) => {
        setFilters(prev => prev.length > 1 ? prev.filter(f => f.id !== idToRemove) : prev);
    };

    const handleFilterChange = (idToChange: number, key: 'field' | 'value', newValue: string) => {
        setFilters(prev => prev.map(f => f.id === idToChange ? { ...f, [key]: newValue } : f));
    };

    const reportSummary = useMemo(() => {
        if (!results || !Array.isArray(results)) return null;

        const summary = {
            entryCount: 0,
            exitCount: 0,
            totalBillWeight: 0,
            totalScaleWeight: 0,
            totalExitWeight: 0,
            totalTransportCost: 0,
        };

        for (const item of results) {
            if ('sellerName' in item) {
                const entry = item as Entry;
                summary.entryCount++;
                summary.totalBillWeight += safeParseFloat(entry.billWeight);
                summary.totalScaleWeight += safeParseFloat(entry.scaleWeight);
                summary.totalTransportCost += safeParseFloat(entry.transportCost);
            } else {
                const exit = item as Exit;
                summary.exitCount++;
                summary.totalExitWeight += safeParseFloat(exit.weight);
            }
        }
        return summary;
    }, [results]);


    const handleGenerateReport = () => {
        setLoading(true);
        const start = formatToISODate(startDate);
        const end = formatToISODate(endDate);
        const allData = dataService.getInvoicesByDateRange(start, end);

        let filteredData = allData;

        // Filter by report type
        if (reportType !== 'all') {
            filteredData = filteredData.filter(item => ('sellerName' in item ? 'entry' : 'exit') === reportType);
        }

        const applyFilter = (data: Remittance[], field: string, value: string): Remittance[] => {
            if (!value || field === 'all') return data;
            const term = value.toLowerCase().trim();
            if (term === '') return data;
    
            return data.filter(item => {
                const isEntry = 'sellerName' in item;
                const productName = (productMap.get(item.productId) || '').toLowerCase();
    
                switch(field) {
                    case 'customerName':
                        const customer = isEntry ? (item as Entry).sellerName : farmerMap.get((item as Exit).farmerId);
                        return (customer || '').toLowerCase().includes(term);
                    case 'driverName':
                        return (item.driverName || '').toLowerCase().includes(term);
                    case 'productName':
                        return productName.includes(term);
                    case 'invoiceNumber':
                        const invoice = isEntry ? (item as Entry).billNumber : (item as Exit).invoiceNumber;
                        return (invoice || '').toLowerCase().includes(term);
                    default:
                        return true;
                }
            });
        };
        
        // General Search (if 'all' is selected for a filter)
        const applyGeneralSearch = (data: Remittance[], value: string): Remittance[] => {
            if (!value) return data;
            const term = value.toLowerCase().trim();
            if (term === '') return data;
            
             return data.filter(item => {
                const isEntry = 'sellerName' in item;
                const productName = (productMap.get(item.productId) || '').toLowerCase();
                const customer = isEntry ? (item as Entry).sellerName : farmerMap.get((item as Exit).farmerId);
                const invoice = isEntry ? (item as Entry).billNumber : (item as Exit).invoiceNumber;
                return (
                    (item.driverName || '').toLowerCase().includes(term) ||
                    productName.includes(term) ||
                    (customer || '').toLowerCase().includes(term) ||
                    (invoice || '').toLowerCase().includes(term)
                );
            });
        }

        for (const filter of filters) {
            const value = filter.value.trim();
            if (value) {
                if (filter.field === 'all') {
                    filteredData = applyGeneralSearch(filteredData, value);
                } else {
                    filteredData = applyFilter(filteredData, filter.field, value);
                }
            }
        }
        
        filteredData.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.createdAt - b.createdAt);

        if (groupBy === 'none') {
            setResults(filteredData);
        } else {
            const grouped: GroupedResults = new Map();
            for (const item of filteredData) {
                let key: string | undefined;
                const isEntry = 'sellerName' in item;
                
                if (groupBy === 'customerName') key = isEntry ? (item as Entry).sellerName : farmerMap.get((item as Exit).farmerId);
                else if (groupBy === 'driverName') key = item.driverName;
                else if (groupBy === 'productName') key = productMap.get(item.productId);

                if (key) {
                    if (!grouped.has(key)) {
                         grouped.set(key, { 
                            items: [], 
                            summary: {
                                totalRemittances: 0,
                                totalWeight: 0,
                                productSummary: new Map()
                            } 
                        });
                    }
                    grouped.get(key)!.items.push(item);
                }
            }

            // Calculate summaries for each group
            for (const groupData of grouped.values()) {
                groupData.items.forEach(item => {
                    // Use billWeight for entries, weight for exits
                    const weight = 'sellerName' in item 
                        ? safeParseFloat((item as Entry).billWeight) 
                        : safeParseFloat((item as Exit).weight);
                        
                    const productName = productMap.get(item.productId) || 'نامشخص';
                    
                    groupData.summary.totalRemittances++;
                    groupData.summary.totalWeight += weight;

                    const prod = groupData.summary.productSummary.get(productName) || { count: 0, totalWeight: 0 };
                    prod.count++;
                    prod.totalWeight += weight;
                    groupData.summary.productSummary.set(productName, prod);
                });
            }
            setResults(grouped);
        }

        setLoading(false);
    };
    
    const handlePrintClick = () => {
        if (!results) {
            showToast('داده‌ای برای چاپ وجود ندارد.', 'info');
            return;
        }
        handlePrint('report', results, { startDate, endDate, reportSummary, groupBy });
    };

    const renderFlatTable = (data: Remittance[]) => (
        <table className="w-full text-sm text-center">
            <thead className="bg-slate-100">
                <tr>
                    <th className="p-2">تاریخ</th>
                    <th className="p-2">نوع</th>
                    <th className="p-2">فروشنده/مرغدار</th>
                    <th className="p-2">محصول</th>
                    <th className="p-2">توضیحات/نوع</th>
                    <th className="p-2">وزن بارنامه</th>
                    <th className="p-2">وزن باسکول/خروج</th>
                    <th className="p-2">افت</th>
                    <th className="p-2">کرایه</th>
                    <th className="p-2">راننده</th>
                    <th className="p-2">شماره</th>
                </tr>
            </thead>
            <tbody>
                {data.map(item => {
                    const isEntry = 'sellerName' in item;
                    const entry = isEntry ? (item as Entry) : null;
                    const exit = !isEntry ? (item as Exit) : null;
                    return (
                        <tr key={item.id} className="border-b">
                            <td className="p-2">{formatDate(item.date)}</td>
                            <td className="p-2">{isEntry ? <span className="text-green-600">ورود</span> : <span className="text-red-600">خروج</span>}</td>
                            <td className="p-2">{entry?.sellerName || (exit ? farmerMap.get(exit.farmerId) : '')}</td>
                            <td className="p-2">{productMap.get(item.productId)}</td>
                            <td className="p-2 text-xs">{(!isEntry && exit?.productVariant) ? exit.productVariant : '-'}</td>
                            <td className="p-2">{entry ? toPersianNumerals((safeParseFloat(entry.billWeight)).toLocaleString()) : '-'}</td>
                            <td className="p-2 font-semibold">{toPersianNumerals((safeParseFloat(entry?.scaleWeight) || safeParseFloat(exit?.weight)).toLocaleString())}</td>
                            <td className="p-2">{entry ? formatWastage(entry.wastage) : '-'}</td>
                            <td className="p-2">{entry ? formatCurrency(entry.transportCost) : '-'}</td>
                            <td className="p-2">{item.driverName}</td>
                            <td className="p-2">{toPersianNumerals(entry?.billNumber || exit?.invoiceNumber || '-')}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
    
    const renderGroupedResults = (data: GroupedResults) => (
        <div className="space-y-6">
            {Array.from(data.entries()).map(([groupKey, groupData]) => (
                <div key={groupKey} className="border rounded-lg overflow-hidden">
                    <div className="bg-slate-100 p-3">
                        <h3 className="text-lg font-bold text-slate-800">{groupKey}</h3>
                        <div className="text-xs text-slate-600 mt-1">
                           <span>تعداد کل سرویس‌ها: {toPersianNumerals(groupData.summary.totalRemittances)}</span>
                           <span className="mx-2">|</span>
                           <span>جمع کل وزن: {toPersianNumerals(groupData.summary.totalWeight.toLocaleString())} کیلوگرم</span>
                        </div>
                         <div className="mt-2 pt-2 border-t border-slate-200">
                            <h4 className="text-sm font-semibold">خلاصه محصولات:</h4>
                            <div className="text-xs mt-1 space-y-1">
                                {Array.from(groupData.summary.productSummary.entries()).map(([productName, summary]) => (
                                    <div key={productName}>
                                        <strong>{productName}:</strong> {toPersianNumerals(summary.totalWeight.toLocaleString())} کیلوگرم ({toPersianNumerals(summary.count)} سرویس)
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="p-2">{renderFlatTable(groupData.items)}</div>
                </div>
            ))}
        </div>
    );


    return (
        <div>
            <div className="bg-white p-5 rounded-xl shadow-md">
                <div className="flex justify-between items-center mb-4">
                     <h1 className="text-2xl font-bold text-slate-700">گزارش‌گیری پیشرفته</h1>
                     <div className="flex gap-2">
                        <button onClick={() => setDateRange('daily')} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded text-sm transition-colors">گزارش روزانه</button>
                        <button onClick={() => setDateRange('weekly')} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded text-sm transition-colors">گزارش هفتگی</button>
                        <button onClick={() => setDateRange('monthly')} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded text-sm transition-colors">گزارش ماهانه</button>
                     </div>
                </div>
               
                <div className="grid grid-cols-1 md:grid-cols-8 gap-4 items-end">
                    <div className="md:col-span-2"><label className="block mb-1 text-sm font-semibold text-slate-600">از تاریخ</label><DatePicker id="report-start-date" value={startDate} onChange={setStartDate} /></div>
                    <div className="md:col-span-2"><label className="block mb-1 text-sm font-semibold text-slate-600">تا تاریخ</label><DatePicker id="report-end-date" value={endDate} onChange={setEndDate} /></div>
                    <div className="md:col-span-2"><label className="block mb-1 text-sm font-semibold text-slate-600">نوع گزارش</label><select value={reportType} onChange={e => setReportType(e.target.value)} className="p-2 border rounded-lg bg-white h-11 w-full"><option value="all">همه موارد</option><option value="exit">خروجی‌ها</option><option value="entry">ورودی‌ها</option></select></div>
                    <div className="md:col-span-2"><label className="block mb-1 text-sm font-semibold text-slate-600">گروه‌بندی</label><select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="p-2 border rounded-lg bg-white h-11 w-full"><option value="none">بدون گروه‌بندی</option><option value="customerName">نام مرغدار/فروشنده</option><option value="driverName">نام راننده</option><option value="productName">نام محصول</option></select></div>
                    
                    <div className="md:col-span-full border-t pt-4 mt-4">
                        <label className="block mb-2 text-sm font-semibold text-slate-600">فیلترهای گزارش</label>
                        <div className="space-y-2">
                            {filters.map((filter) => (
                                <div key={filter.id} className="grid grid-cols-10 gap-2 items-center">
                                    <select 
                                        value={filter.field} 
                                        onChange={e => handleFilterChange(filter.id, 'field', e.target.value)}
                                        className="col-span-4 p-2 border rounded-lg bg-white h-11"
                                    >
                                        {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                    <input 
                                        value={filter.value} 
                                        onChange={e => handleFilterChange(filter.id, 'value', e.target.value)} 
                                        type="text" 
                                        className="col-span-5 p-2 border rounded-lg h-11" 
                                        placeholder="مقدار فیلتر..."
                                    />
                                    <div className="col-span-1 flex justify-center">
                                        {filters.length > 1 && (
                                            <button onClick={() => handleRemoveFilter(filter.id)} className="bg-red-500 text-white rounded-full h-8 w-8 flex items-center justify-center hover:bg-red-600 font-bold">-</button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={handleAddFilter} className="mt-2 text-sm bg-slate-200 text-slate-700 px-3 py-1 rounded-md hover:bg-slate-300">افزودن فیلتر +</button>
                    </div>

                    <div className="md:col-span-full mt-4">
                        <button onClick={handleGenerateReport} className="w-full bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition-colors h-11">ایجاد گزارش</button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md mt-4">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-600">نتایج گزارش</h2>
                    {results && ((Array.isArray(results) && results.length > 0) || (!Array.isArray(results) && results.size > 0)) && (
                        <button onClick={handlePrintClick} className="no-print bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors">
                            چاپ گزارش
                        </button>
                    )}
                 </div>

                {reportSummary && (
                    <div className="mb-6 p-4 bg-slate-50 rounded-lg text-sm">
                        <h3 className="text-base font-bold text-slate-800 mb-2">خلاصه کلی گزارش</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                           <div><strong>حواله ورود:</strong> {toPersianNumerals(reportSummary.entryCount)}</div>
                           <div><strong>حواله خروج:</strong> {toPersianNumerals(reportSummary.exitCount)}</div>
                           <div><strong>جمع کل بارنامه:</strong> {toPersianNumerals(reportSummary.totalBillWeight.toLocaleString())} kg</div>
                           <div><strong>جمع کل باسکول:</strong> {toPersianNumerals(reportSummary.totalScaleWeight.toLocaleString())} kg</div>
                           <div><strong>جمع کل افت:</strong> {formatWastage(reportSummary.totalScaleWeight - reportSummary.totalBillWeight)} kg</div>
                           <div><strong>جمع کل خروج:</strong> {toPersianNumerals(reportSummary.totalExitWeight.toLocaleString())} kg</div>
                           <div className="col-span-2"><strong>جمع کل کرایه:</strong> {formatCurrency(reportSummary.totalTransportCost)}</div>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto">
                     {loading && <p className="text-center">در حال دریافت اطلاعات...</p>}
                     {!loading && results === null && <p className="text-center text-slate-500">لطفا فیلترهای مورد نظر را انتخاب و روی دکمه ایجاد گزارش کلیک کنید.</p>}
                     {!loading && results && ((Array.isArray(results) && results.length === 0) || (!Array.isArray(results) && results.size === 0)) && <p className="text-center text-slate-500">نتیجه‌ای یافت نشد.</p>}
                     {!loading && results && Array.isArray(results) && results.length > 0 && renderFlatTable(results)}
                     {!loading && results && !Array.isArray(results) && results.size > 0 && renderGroupedResults(results)}
                </div>
            </div>
        </div>
    );
};

export default ReportsPage;
