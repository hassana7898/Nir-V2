
import React, { useState, useEffect, useMemo } from 'react';
import { Remittance, Entry, Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals, formatDate } from '../utils/formatters';
import { useNavigate } from 'react-router-dom';

const GlobalSearchPage: React.FC = () => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [searchType, setSearchType] = useState<'all' | 'entry' | 'exit'>('all');
    const [results, setResults] = useState<Remittance[]>([]);
    const [loading, setLoading] = useState(false);
    const [farmers, setFarmers] = useState<Farmer[]>([]);
    
    const { productMap } = useSettings();
    const navigate = useNavigate();
    const farmerMap = useMemo(() => new Map(farmers.map(f => [f.id, f.name])), [farmers]);

    useEffect(() => {
        setFarmers(dataService.getFarmers());
    }, []);

    // Debounce search query to improve performance
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedQuery(query);
        }, 500);

        return () => {
            clearTimeout(handler);
        };
    }, [query]);

    // Perform search
    useEffect(() => {
        if (!debouncedQuery.trim()) {
            setResults([]);
            return;
        }

        setLoading(true);
        const searchResults = dataService.searchAllInvoices(debouncedQuery, { type: searchType });
        setResults(searchResults);
        setLoading(false);
    }, [debouncedQuery, searchType]);

    const goToDate = (date: string, type: 'entry' | 'exit') => {
        sessionStorage.setItem('targetDate', date);
        navigate(`/${type}`);
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-md">
                <h1 className="text-2xl font-bold text-slate-700 mb-4">جستجوی سراسری</h1>
                <div className="flex flex-col md:flex-row gap-4">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="جستجو در نام، محصول، راننده، شماره حواله، وزن..."
                        className="w-full p-3 border rounded-lg text-lg focus:ring-2 focus:ring-sky-500 outline-none transition-all"
                        autoFocus
                    />
                </div>
                <div className="mt-4 flex items-center justify-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                        <input type="radio" name="searchType" value="all" checked={searchType === 'all'} onChange={() => setSearchType('all')} className="h-4 w-4 text-sky-600" />
                        <span className="text-sm font-medium">همه حواله‌ها</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                        <input type="radio" name="searchType" value="entry" checked={searchType === 'entry'} onChange={() => setSearchType('entry')} className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">فقط ورودی‌ها</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                        <input type="radio" name="searchType" value="exit" checked={searchType === 'exit'} onChange={() => setSearchType('exit')} className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-medium">فقط خروجی‌ها</span>
                    </label>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md">
                <h2 className="text-xl font-bold text-slate-600 mb-4">
                    نتایج جستجو ({toPersianNumerals(results.length)})
                </h2>
                <div className="overflow-x-auto max-h-[calc(100vh-350px)]">
                    {loading ? (
                        <div className="flex justify-center p-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
                            <span className="mr-3">در حال جستجو...</span>
                        </div>
                    ) : results.length === 0 ? (
                        <p className="text-center p-10 text-slate-500 bg-slate-50 rounded-lg border-2 border-dashed">
                            {debouncedQuery.trim() ? 'موردی با این مشخصات یافت نشد.' : 'برای شروع جستجو، عبارتی (مثل نام راننده یا وزن) را در کادر بالا وارد کنید.'}
                        </p>
                    ) : (
                        <table className="w-full text-sm text-center border-collapse">
                            <thead className="bg-slate-100 sticky top-0 z-10">
                                <tr className="border-b-2 border-slate-200">
                                    <th className="p-3">تاریخ</th>
                                    <th className="p-3">نوع</th>
                                    <th className="p-3">فروشنده/مرغدار</th>
                                    <th className="p-3">محصول</th>
                                    <th className="p-3">وزن باسکول (kg)</th>
                                    <th className="p-3">وزن بارنامه (kg)</th>
                                    <th className="p-3">راننده</th>
                                    <th className="p-3">شماره حواله/بارنامه</th>
                                    <th className="p-3">عملیات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {results.map(item => {
                                    const isEntry = 'sellerName' in item;
                                    const entry = isEntry ? (item as Entry) : null;
                                    const exit = !isEntry ? (item as Exit) : null;
                                    return (
                                        <tr key={item.id} className="hover:bg-sky-50 transition-colors">
                                            <td className="p-3 whitespace-nowrap">{formatDate(item.date)}</td>
                                            <td className="p-3">
                                                {isEntry ? 
                                                    <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">ورود</span> : 
                                                    <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">خروج</span>
                                                }
                                            </td>
                                            <td className="p-3 font-medium">{entry?.sellerName || (exit ? farmerMap.get(exit.farmerId) : '')}</td>
                                            <td className="p-3 text-slate-600">{productMap.get(item.productId)}</td>
                                            <td className="p-3 font-bold text-slate-800">{toPersianNumerals((entry?.scaleWeight || exit?.weight || 0).toLocaleString())}</td>
                                            <td className="p-3 text-slate-500">{isEntry ? toPersianNumerals((entry?.billWeight || 0).toLocaleString()) : '-'}</td>
                                            <td className="p-3">{item.driverName || '-'}</td>
                                            <td className="p-3 font-mono">{toPersianNumerals(entry?.billNumber || exit?.invoiceNumber || '')}</td>
                                            <td className="p-3">
                                                <button 
                                                    onClick={() => goToDate(item.date, isEntry ? 'entry' : 'exit')}
                                                    className="bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-sky-600 transition-colors shadow-sm hover:shadow"
                                                >
                                                    مشاهده روز
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GlobalSearchPage;
