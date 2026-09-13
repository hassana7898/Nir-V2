
export const calculateTotals = (data: Remittance[], type: 'entry' | 'exit'): EntryTotals | ExitTotals => {
    if (type === 'entry') {
        const entryTotals: EntryTotals = { byProduct: new Map(), grandTotal: { count: 0, billWeight: 0, scaleWeight: 0, wastage: 0, transportCost: 0 } };
        for (const item of data) {
            const entry = item as Entry;
            entryTotals.grandTotal.count++;
            entryTotals.grandTotal.billWeight += Number(entry.billWeight) || 0;
            entryTotals.grandTotal.scaleWeight += Number(entry.scaleWeight) || 0;
            entryTotals.grandTotal.transportCost += Number(entry.transportCost) || 0;
            if (!entryTotals.byProduct.has(entry.productId)) entryTotals.byProduct.set(entry.productId, { count: 0, billWeight: 0, scaleWeight: 0, transportCost: 0 });
            const pt = entryTotals.byProduct.get(entry.productId)!;
            pt.count++; pt.billWeight += Number(entry.billWeight) || 0; pt.scaleWeight += Number(entry.scaleWeight) || 0; pt.transportCost += Number(entry.transportCost) || 0;
        }
        entryTotals.grandTotal.wastage = entryTotals.grandTotal.scaleWeight - entryTotals.grandTotal.billWeight;
        return entryTotals;
    } else {
        const exitTotals: ExitTotals = { byProduct: new Map(), grandTotal: { count: 0, weight: 0 } };
        for (const item of data) {
            const exit = item as Exit;
            exitTotals.grandTotal.count++;
            exitTotals.grandTotal.weight += Number(exit.weight) || 0;
            if (!exitTotals.byProduct.has(exit.productId)) exitTotals.byProduct.set(exit.productId, { count: 0, weight: 0 });
            const pt = exitTotals.byProduct.get(exit.productId)!;
            pt.count++; pt.weight += Number(exit.weight) || 0;
        }
        return exitTotals;
    }
};


import React, { useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Remittance, Settings, Entry, Exit, Farmer, Brood } from '../types';
import { toPersianNumerals, formatDate, formatCurrency, formatWastage, formatIBANForDisplay, formatDateWithWeekday } from './formatters';
import { loadSettings, getFarmers } from '../services/dataService';

type EntryTotals = {
    byProduct: Map<string, { count: number; billWeight: number; scaleWeight: number; transportCost: number }>;
    grandTotal: { count: number; billWeight: number; scaleWeight: number; wastage: number; transportCost: number };
};

type ExitTotals = {
    byProduct: Map<string, { count: number; weight: number }>;
    grandTotal: { count: number; weight: number };
};

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

// Helper to get really short date (M/D) from 'YYYY-MM-DD'
const getShortDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('fa-IR', { month: '2-digit', day: '2-digit' });
    }
    return dateStr;
};

// --- Brood Print Layout ---
const PrintBroodLayout: React.FC<{
    farmer: Farmer;
    brood: Brood;
    data: {
        sentData: Map<string, number>;
        totalSentWeight: number;
        relevantInvoices: Exit[];
        totalQuota: number;
        daysOfBrood: number;
        perCapitaConsumption: number;
        conversionRate: string | null;
    }
}> = ({ farmer, brood, data }) => {
    const settings = loadSettings();
    const quotaMap = new Map(settings.feedQuotas?.map(q => [q.productId, q.quotaPerChick]));

    const activeProductIds = new Set<string>();
    settings.feedQuotas?.forEach(q => { if(q.quotaPerChick > 0) activeProductIds.add(q.productId); });
    data.sentData.forEach((weight, id) => { if(weight > 0) activeProductIds.add(id); });

    const columns = settings.products.filter(p => {
        if (p.type !== "finishedGood") return false;
        if (!activeProductIds.has(p.id)) return false;
        if ((data.sentData.get(p.id) || 0) > 0) return true;
        if (brood.activeProductsAtCreation) return brood.activeProductsAtCreation.includes(p.id);
        return !p.isDeleted;
    });

    type TransactionItem = { date: string; shortDate: string; weight: number; ref?: string; timestamp: number; variant?: string; };
    const productTransactions: Record<string, TransactionItem[]> = {};
    let maxRows = 0;

    columns.forEach(col => {
        const invoices = data.relevantInvoices
            .filter(inv => inv.productId === col.id)
            .map(inv => {
                let variant = '';
                if (inv.productVariant) variant += inv.productVariant;
                if (inv.isCrumble) variant += (variant ? ' ' : '') + '(کرامبل)';
                return {
                    date: inv.date,
                    shortDate: getShortDate(inv.date),
                    weight: safeParseFloat(inv.weight),
                    ref: inv.invoiceNumber,
                    timestamp: inv.createdAt || new Date(inv.date).getTime(),
                    variant: variant
                };
            });
        const manualFeeds = (brood.exceptionalFeed || [])
            .filter(feed => feed.productId === col.id)
            .map(feed => ({
                date: feed.date,
                shortDate: getShortDate(feed.date),
                weight: safeParseFloat(feed.weight),
                ref: 'دستی',
                timestamp: new Date(feed.date).getTime() + 1
            }));
        const allItems = [...invoices, ...manualFeeds].sort((a, b) => a.timestamp - b.timestamp);
        productTransactions[col.id] = allItems;
        if (allItems.length > maxRows) maxRows = allItems.length;
    });

    const columnTotals: { [key: string]: number } = {};
    columns.forEach(col => {
        columnTotals[col.id] = (productTransactions[col.id] || []).reduce((sum, item) => sum + item.weight, 0);
    });

    return (
        <div className="print-page dir-rtl font-btitr text-black" style={{ fontSize: '9pt' }}>
            <div className="flex justify-between items-center mb-2 border-b-2 border-black pb-2 print-header">
                <div className="w-1/4 text-right">
                    <p className="font-bold text-xs">تاریخ چاپ: {toPersianNumerals(new Date().toLocaleDateString('fa-IR'))}</p>
                </div>
                <div className="w-1/2 text-center">
                    <h1 className="text-xl font-extrabold">گزارش تفصیلی دوره جوجه‌ریزی</h1>
                    <h2 className="text-lg font-bold mt-1">{settings.factoryName}</h2>
                </div>
                <div className="w-1/4 text-left">
                     {settings.factoryLogo && <img src={settings.factoryLogo} alt="Logo" className="h-12 max-w-[150px] object-contain mb-1 inline-block"/>}
                </div>
            </div>
            <div className="border-2 border-black p-2 mb-3 bg-white">
                <div className="flex justify-between items-center text-sm font-bold">
                    <div>نام مرغدار: {farmer.name}</div>
                    <div>تاریخ شروع: {toPersianNumerals(formatDate(brood.startDate))}</div>
                    <div>تعداد جوجه: {toPersianNumerals(brood.chickCount.toLocaleString())}</div>
                    <div>سن گله: {toPersianNumerals(data.daysOfBrood)} روز</div>
                    <div>مصرف سرانه: {toPersianNumerals(data.perCapitaConsumption)} گرم</div>
                </div>
            </div>
            <div className="mb-4">
                <h3 className="font-bold text-sm mb-1 text-right">خلاصه وضعیت سهمیه‌ها</h3>
                <table className="w-full text-center border-collapse border border-black text-xs">
                    <thead>
                        <tr className="bg-gray-200">
                            <th className="border border-black p-1">نام محصول</th>
                            <th className="border border-black p-1">سهمیه کل (kg)</th>
                            <th className="border border-black p-1">ارسالی (kg)</th>
                            <th className="border border-black p-1">مانده (kg)</th>
                            <th className="border border-black p-1">درصد مصرف</th>
                        </tr>
                    </thead>
                    <tbody>
                        {columns.map(product => {
                            const quota = (quotaMap.get(product.id) || 0) * brood.chickCount / 1000;
                            const sent = data.sentData.get(product.id) || 0;
                            const remaining = quota - sent;
                            const percent = quota > 0 ? (sent / quota) * 100 : 0;
                            return (
                                <tr key={product.id}>
                                    <td className="border border-black p-1 font-bold">{product.name}</td>
                                    <td className="border border-black p-1">{toPersianNumerals(Math.round(quota).toLocaleString())}</td>
                                    <td className="border border-black p-1 font-bold">{toPersianNumerals(Math.round(sent).toLocaleString())}</td>
                                    <td className={`border border-black p-1 ${remaining < 0 ? 'text-red-700 font-bold' : ''}`}>
                                        {toPersianNumerals(Math.abs(Math.round(remaining)).toLocaleString())} {remaining < 0 ? '(اضافه)' : ''}
                                    </td>
                                    <td className="border border-black p-1">{toPersianNumerals(Math.round(percent))}%</td>
                                </tr>
                            );
                        })}
                        <tr className="bg-gray-300 font-bold">
                            <td className="border border-black p-1">جمع کل</td>
                            <td className="border border-black p-1">
                                {toPersianNumerals(Math.round(columns.reduce((acc, p) => acc + ((quotaMap.get(p.id) || 0) * brood.chickCount / 1000), 0)).toLocaleString())}
                            </td>
                            <td className="border border-black p-1">
                                {toPersianNumerals(Math.round(columns.reduce((acc, p) => acc + (data.sentData.get(p.id) || 0), 0)).toLocaleString())}
                            </td>
                            <td className="border border-black p-1" dir="rtl">
                                {(() => {
                                    const totalQ = columns.reduce((acc, p) => acc + ((quotaMap.get(p.id) || 0) * brood.chickCount / 1000), 0);
                                    const totalS = columns.reduce((acc, p) => acc + (data.sentData.get(p.id) || 0), 0);
                                    const rem = totalQ - totalS;
                                    return rem < 0 
                                        ? `${toPersianNumerals(Math.abs(Math.round(rem)).toLocaleString())} (اضافه)`
                                        : toPersianNumerals(Math.round(rem).toLocaleString());
                                })()}
                            </td>
                            <td className="border border-black p-1">
                                {(() => {
                                    const totalQ = columns.reduce((acc, p) => acc + ((quotaMap.get(p.id) || 0) * brood.chickCount / 1000), 0);
                                    const totalS = columns.reduce((acc, p) => acc + (data.sentData.get(p.id) || 0), 0);
                                    return toPersianNumerals(totalQ > 0 ? Math.round((totalS / totalQ) * 100) : 0) + '%';
                                })()}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div>
                <h3 className="font-bold text-sm mb-1 text-right">ریز تراکنش‌های ارسال دان (تفکیکی)</h3>
                <table className="w-full text-center border-collapse border border-black" style={{ fontSize: '8pt', tableLayout: 'fixed' }}>
                    <colgroup>
                        {columns.map(col => (
                            <React.Fragment key={col.id}>
                                <col style={{ width: `${100 / columns.length * 0.25}%` }} />
                                <col style={{ width: `${100 / columns.length * 0.25}%` }} />
                                <col style={{ width: `${100 / columns.length * 0.5}%` }} />
                            </React.Fragment>
                        ))}
                    </colgroup>
                    <thead>
                        <tr className="bg-gray-300 text-black">
                             {columns.map(col => <th key={col.id} colSpan={3} className="border border-black p-1 font-bold">{col.name}</th>)}
                        </tr>
                        <tr className="bg-gray-100 text-black">
                             {columns.map(col => <React.Fragment key={`${col.id}-sub`}>
                                <th className="border border-black p-1 text-[10px]">تاریخ</th>
                                <th className="border border-black p-1 text-[10px]">حواله/نوع</th>
                                <th className="border border-black p-1 text-[10px]">وزن(kg)</th>
                             </React.Fragment>)}
                        </tr>
                    </thead>
                    <tbody>
                        {maxRows === 0 ? (
                            <tr><td colSpan={columns.length * 3} className="border border-black p-2">موردی یافت نشد.</td></tr>
                        ) : (
                            Array.from({ length: maxRows }).map((_, rowIndex) =>
                                <tr key={rowIndex} className="border-b border-gray-400">
                                     {columns.map(col => {
                                        const item = productTransactions[col.id][rowIndex];
                                        return (
                                            <React.Fragment key={`${col.id}-${rowIndex}`}>
                                                <td className="border-l border-r border-gray-400 p-1 text-center bg-white" style={{ direction: 'ltr' }}>{item ? toPersianNumerals(item.shortDate) : ''}</td>
                                                <td className="border-l border-r border-gray-400 p-1 text-center bg-white text-[9px] whitespace-nowrap overflow-hidden text-ellipsis">
                                                    {item ? (
                                                        <div className="flex flex-col items-center">
                                                            <span>{toPersianNumerals(item.ref || '-')}</span>
                                                            {item.variant && <span className="text-[8px] text-gray-500">{item.variant}</span>}
                                                        </div>
                                                    ) : ''}
                                                </td>
                                                <td className="border-l border-r border-black p-1 font-bold text-black bg-white">{item ? toPersianNumerals(item.weight.toLocaleString()) : ''}</td>
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            )
                        )}
                        <tr className="bg-black text-white font-bold border-t-2 border-black">
                             {columns.map(col => <React.Fragment key={`${col.id}-total`}>
                                <td colSpan={2} className="border border-white p-1 text-xs">جمع</td>
                                <td className="border border-white p-1">{toPersianNumerals((columnTotals[col.id] || 0).toLocaleString())}</td>
                             </React.Fragment>)}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export const PrintRemittanceLayout: React.FC<{
    type: 'entry' | 'exit';
    data: Remittance[];
    printDate: Date;
    isMultiPage?: boolean;
    pageNumber?: number;
    totalPages?: number;
    isLastPage: boolean;
    rowIndexOffset?: number;
    totals: EntryTotals | ExitTotals;
    pageTotals?: EntryTotals | ExitTotals;
    options?: PrintOptions;
}> = ({ type, data, printDate, isMultiPage, pageNumber, totalPages, isLastPage, rowIndexOffset = 0, totals, pageTotals, options }) => {
    const settings = loadSettings();
    const farmers = getFarmers();
    const farmerMap = new Map(farmers.map(f => [f.id, f.name]));
    const pageSetting = options?.pageSettings?.[pageNumber ? pageNumber - 1 : 0];
    const printTitle = pageSetting?.title || options?.customPrintTitle || (type === 'entry' ? settings.entryPrintTitle : settings.exitPrintTitle);
    const pageDescription = pageSetting?.description;
    const globalDescription = isLastPage ? options?.generalDescription : null;
    const signatures = type === 'entry' ? settings.entrySignatures : settings.exitSignatures;
    const signatureNames = type === 'entry' ? settings.entrySignatureNames : settings.exitSignatureNames;
    // Fix: Show full date with weekday on printed header
    const dateFormatted = formatDateWithWeekday(printDate);
    const productMap = new Map(settings.products.map(p => [p.id, p.name]));

    const renderHeader = (title: string, date: string) => (
        <div className="flex justify-between items-center mb-2 border-b-2 pb-2 border-slate-800 print-header">
            <div className="w-1/4">
                {settings.factoryLogo ? <img src={settings.factoryLogo} alt="Logo" className="h-8 max-w-[100px] object-contain"/> : <span></span>}
            </div>
            <div className="w-1/2 text-center">
                <h2 className="text-lg font-bold">{title}</h2>
                <h3 className="text-base font-semibold">{settings.factoryName}</h3>
            </div>
            <div className="w-1/4 text-left">
                <p className="text-sm font-semibold">تاریخ: <span>{date}</span></p>
                {isMultiPage && <p className="text-xs">صفحه {toPersianNumerals(pageNumber)} از {toPersianNumerals(totalPages)}</p>}
            </div>
        </div>
    );
    
    const renderTableHead = () => {
        if (type === 'entry') return <tr className="bg-slate-100"><th>ردیف</th><th>نام فروشنده</th><th>نوع محصول</th><th>وزن بارنامه</th><th>وزن باسکول</th><th>کارخانه</th><th>افت (kg)</th><th>شماره بارنامه</th><th>مبدا</th><th>کرایه حمل</th><th>راننده</th><th>تماس راننده</th><th>شبا راننده</th></tr>;
        // Removed productVariant column
        return <tr className="bg-slate-100"><th>ردیف</th><th>نام مرغدار</th><th>نوع محصول</th><th>وزن (kg)</th><th>نام راننده</th><th>شماره حواله</th></tr>;
    };

    const renderTableRow = (item: Remittance, index: number) => {
        if (type === 'entry') {
            const entry = item as Entry;
            return (
                <tr key={entry.id}>
                    <td>{toPersianNumerals(rowIndexOffset + index + 1)}</td><td>{entry.sellerName}</td><td>{productMap.get(entry.productId) || entry.productId}</td><td>{toPersianNumerals(safeParseFloat(entry.billWeight).toLocaleString('fa-IR'))}</td><td>{toPersianNumerals(safeParseFloat(entry.scaleWeight).toLocaleString('fa-IR'))}</td><td>{entry.factory || '-'}</td><td className={`font-semibold ${entry.wastage < 0 ? 'text-red-500' : 'text-green-500'}`}>{formatWastage(entry.wastage)}</td><td>{toPersianNumerals(entry.billNumber || '')}</td><td>{entry.origin}</td><td>{formatCurrency(entry.transportCost)}</td><td>{entry.driverName}</td><td>{toPersianNumerals(entry.driverPhone)}</td><td>{formatIBANForDisplay(entry.driverIBAN)}</td>
                </tr>
            );
        }
        const exit = item as Exit;
        return (
             <tr key={exit.id}>
                <td>{toPersianNumerals(rowIndexOffset + index + 1)}</td>
                <td>{farmerMap.get(exit.farmerId) || 'نامشخص'}</td>
                <td>
                    {productMap.get(exit.productId) || exit.productId}
                    {/* Display variant here instead of separate column */}
                    {exit.productVariant && <span className="text-[10px] text-slate-600 mr-1 font-normal">({exit.productVariant})</span>}
                    {exit.isCrumble && <span className="text-[10px] text-slate-600 mr-1 font-normal">(کرامبل)</span>}
                </td>
                {/* Removed separate variant td */}
                <td>{toPersianNumerals(safeParseFloat(exit.weight).toLocaleString('fa-IR'))}</td>
                <td>{exit.driverName}</td>
                <td>{toPersianNumerals(exit.invoiceNumber)}</td>
            </tr>
        );
    };

    return (
        <div className="print-page">
            <table>
                <thead>
                    <tr><th colSpan={type === 'entry' ? 12 : 6} style={{ border: 'none', paddingBottom: '0.5rem' }}>{renderHeader(printTitle, dateFormatted)}</th></tr>
                    {renderTableHead()}
                </thead>
                <tbody>{data.map((item, index) => renderTableRow(item, index))}</tbody>
            </table>
            
            {options?.showPageTotals && pageTotals && data.length > 0 && (
                <div className="mt-4 pt-2 font-bold" style={{ fontSize: '10pt', borderTop: '2px solid black', paddingBottom: '0.5rem', pageBreakInside: 'avoid', fontFamily: "'Sahel', sans-serif" }}>
                    {type === 'entry' ? (
                        <div>
                            <span className="text-base">جمع این صفحه (بر اساس بارنامه):</span>
                            <div className="flex flex-row flex-wrap justify-start gap-x-6 gap-y-1 text-sm font-normal mt-1">
                                {Array.from((pageTotals as EntryTotals).byProduct.entries()).map(([productId, productTotals]) =>
                                    <span key={productId} className="whitespace-nowrap"><span className="font-semibold">{productMap.get(productId) || productId}:</span> {toPersianNumerals(productTotals.billWeight.toLocaleString('fa-IR'))} کیلوگرم</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <span className="text-base">جمع این صفحه:</span>
                            <div className="flex flex-row flex-wrap justify-start gap-x-6 gap-y-1 text-sm font-normal mt-1">
                                {Array.from((pageTotals as ExitTotals).byProduct.entries()).map(([productId, productTotals]) =>
                                    <span key={productId} className="whitespace-nowrap"><span className="font-semibold">{productMap.get(productId) || productId}:</span> {toPersianNumerals(productTotals.weight.toLocaleString('fa-IR'))} کیلوگرم</span>
                                )}
                            </div>
                            {Array.from((pageTotals as ExitTotals).byProduct.keys()).length > 1 && (
                                <div className="text-base border-t border-slate-400 mt-2 pt-1 w-full flex justify-end"><span className="font-bold">{`جمع کل این صفحه: ${toPersianNumerals((pageTotals as ExitTotals).grandTotal.weight.toLocaleString('fa-IR'))} کیلوگرم`}</span></div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {isLastPage && (options?.showGrandTotal !== false) && data.length > 0 && (
                <div className="mt-4 pt-2 font-bold" style={{ fontSize: '10pt', borderTop: '2px solid black', paddingBottom: '2rem', pageBreakInside: 'avoid', fontFamily: "'Sahel', sans-serif" }}>
                    {type === 'entry' ? (
                        <div>
                            <span className="text-base">جمع کل صفحات (بر اساس بارنامه):</span>
                            <div className="flex flex-row flex-wrap justify-start gap-x-6 gap-y-1 text-sm font-normal mt-1">
                                {Array.from((totals as EntryTotals).byProduct.entries()).map(([productId, productTotals]) =>
                                    <span key={productId} className="whitespace-nowrap"><span className="font-semibold">{productMap.get(productId) || productId}:</span> {toPersianNumerals(productTotals.billWeight.toLocaleString('fa-IR'))} کیلوگرم</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <span className="text-base">جمع کل صفحات:</span>
                            <div className="flex flex-row flex-wrap justify-start gap-x-6 gap-y-1 text-sm font-normal mt-1">
                                {Array.from((totals as ExitTotals).byProduct.entries()).map(([productId, productTotals]) =>
                                    <span key={productId} className="whitespace-nowrap"><span className="font-semibold">{productMap.get(productId) || productId}:</span> {toPersianNumerals(productTotals.weight.toLocaleString('fa-IR'))} کیلوگرم</span>
                                )}
                            </div>

                            {Array.from((totals as ExitTotals).byProduct.keys()).length > 1 && (
                                <div className="text-base border-t border-slate-400 mt-2 pt-1 w-full flex justify-end"><span className="font-bold">{`جمع کل: ${toPersianNumerals((totals as ExitTotals).grandTotal.weight.toLocaleString('fa-IR'))} کیلوگرم`}</span></div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {pageDescription && (
                <div className="mt-3 pt-2 page-break-inside-avoid">
                    <span className="text-xs font-semibold text-slate-800">توضیحات صفحه:</span>
                    <p className="text-[10px] font-normal leading-relaxed text-slate-800 mt-1 whitespace-pre-wrap">{pageDescription}</p>
                </div>
            )}
            {globalDescription && (
                <div className="mt-3 pt-2 page-break-inside-avoid">
                    <span className="text-xs font-semibold text-slate-800">توضیحات کلی گزارش:</span>
                    <p className="text-[10px] font-normal leading-relaxed text-slate-800 mt-1 whitespace-pre-wrap">{globalDescription}</p>
                </div>
            )}
            <div className="print-footer">
                <div className="sig-box flex flex-col items-center">
                    <p>{signatures[0]}</p>
                    {signatureNames?.[0] && <span className="mt-8 text-sm font-bold text-slate-800">{signatureNames[0]}</span>}
                </div>
                <div className="sig-box flex flex-col items-center">
                    <p>{signatures[1]}</p>
                    {signatureNames?.[1] && <span className="mt-8 text-sm font-bold text-slate-800">{signatureNames[1]}</span>}
                </div>
                <div className="sig-box flex flex-col items-center">
                    <p>{signatures[2]}</p>
                    {signatureNames?.[2] && <span className="mt-8 text-sm font-bold text-slate-800">{signatureNames[2]}</span>}
                </div>
                {signatures[3] && (
                    <div className="sig-box flex flex-col items-center">
                        <p>{signatures[3]}</p>
                        {signatureNames?.[3] && <span className="mt-8 text-sm font-bold text-slate-800">{signatureNames[3]}</span>}
                    </div>
                )}
            </div>
        </div>
    );
};


export const calculatePrintPages = (data: Remittance[]) => {
    const pages: { data: Remittance[]; offset: number }[] = [];
    let currentPage: Remittance[] = [];
    let offset = 0;
    if (data.length === 0) return [{ data: [], offset: 0 }];
    for (const item of data) {
        if (item.isPageBreak && currentPage.length > 0) {
            pages.push({ data: currentPage, offset });
            offset += currentPage.length;
            currentPage = [];
        }
        currentPage.push(item);
    }
    if (currentPage.length > 0) pages.push({ data: currentPage, offset });
    return pages.length > 0 ? pages : [{ data: [], offset: 0 }];
};

const PrintPages: React.FC<{
    type: 'entry' | 'exit';
    data: Remittance[];
    printDate: Date;
    options: PrintOptions;
}> = ({ type, data, printDate, options }) => {
    const pagesWithOffsets = useMemo(() => calculatePrintPages(data), [data]);

    const fullTotals = useMemo(() => calculateTotals(data, type), [data, type]);

    return (
        
        <>{pagesWithOffsets.map((page, index) => {
            const pageTotals = calculateTotals(page.data, type);
            return (
                <PrintRemittanceLayout 
                    key={index} 
                    type={type} 
                    data={page.data} 
                    printDate={printDate} 
                    isMultiPage={pagesWithOffsets.length > 1} 
                    pageNumber={index + 1} 
                    totalPages={pagesWithOffsets.length} 
                    isLastPage={index === pagesWithOffsets.length - 1} 
                    rowIndexOffset={page.offset} 
                    totals={fullTotals} 
                    pageTotals={pageTotals}
                    options={options}
                />
            );
        })}</>
    );
};

const PrintAnalysisLayout: React.FC<{ data: any[]; dates: { startDate: Date, endDate: Date } }> = ({ data, dates }) => {
    const settings = loadSettings();
    const renderNumber = (num: number) => {
        const fixedNum = parseFloat(num.toFixed(2));
        const formatted = toPersianNumerals(fixedNum.toLocaleString('fa-IR'));
        if (fixedNum < 0) return <span className="text-red-600">{formatted}</span>;
        if (fixedNum > 0) return <span className="text-slate-800">{formatted}</span>;
        return <span className="text-slate-400">{formatted}</span>;
    }
    return (
        <div className="print-page">
             <table>
                <thead>
                    <tr><th colSpan={8} style={{ border: 'none', paddingBottom: '0.5rem' }}>
                        <div className="flex justify-between items-center mb-2 border-b-2 pb-2 border-slate-800 print-header">
                            <div className="w-1/4">{settings.factoryLogo ? <img src={settings.factoryLogo} alt="Logo" className="h-8 max-w-[100px] object-contain"/> : <span></span>}</div>
                            <div className="w-1/2 text-center"><h2 className="text-lg font-bold">گزارش آنالیز انبار</h2><h3 className="text-base font-semibold">{settings.factoryName}</h3></div>
                            <div className="w-1/4 text-left"><p className="text-sm font-semibold">از: <span>{formatDate(dates.startDate)}</span></p><p className="text-sm font-semibold">تا: <span>{formatDate(dates.endDate)}</span></p></div>
                        </div>
                    </th></tr>
                     <tr className="bg-slate-200"><th className="p-2" rowSpan={2}>نام محصول</th><th className="p-2" rowSpan={2}>موجودی اولیه</th><th className="p-2 text-green-700" colSpan={2}>ورودی‌ها</th><th className="p-2 text-red-700" colSpan={2}>خروجی‌ها</th><th className="p-2 text-blue-700" rowSpan={2}>اصلاحات</th><th className="p-2" rowSpan={2}>موجودی نهایی</th></tr>
                    <tr className="bg-slate-100"><th className="p-2 bg-green-100">خرید</th><th className="p-2 bg-green-100">تولید</th><th className="p-2 bg-red-100">فروش</th><th className="p-2 bg-red-100">مصرف در تولید</th></tr>
                </thead>
                <tbody>
                    {data.map(item =>
                        <tr key={item.productId} className="border-b"><td className="p-2 font-semibold">{item.productName}</td><td className="p-2 font-mono">{renderNumber(item.opening)}</td><td className="p-2 font-mono bg-green-50">{renderNumber(item.entries)}</td><td className="p-2 font-mono bg-green-50">{renderNumber(item.produced)}</td><td className="p-2 font-mono bg-red-50">{renderNumber(item.exits)}</td><td className="p-2 font-mono bg-red-50">{renderNumber(item.consumed)}</td><td className="p-2 font-mono">{renderNumber(item.adjustments)}</td><td className="p-2 font-mono font-bold">{renderNumber(item.closing)}</td></tr>
                    )}
                </tbody>
            </table>
             <div className="print-footer">
                <div className="sig-box flex flex-col items-center">
                    <p>{settings.entrySignatures[0]}</p>
                    {settings.entrySignatureNames?.[0] && <span className="mt-8 text-sm font-bold text-slate-800">{settings.entrySignatureNames[0]}</span>}
                </div>
                <div className="sig-box flex flex-col items-center">
                    <p>{settings.entrySignatures[1]}</p>
                    {settings.entrySignatureNames?.[1] && <span className="mt-8 text-sm font-bold text-slate-800">{settings.entrySignatureNames[1]}</span>}
                </div>
                <div className="sig-box flex flex-col items-center">
                    <p>{settings.entrySignatures[2]}</p>
                    {settings.entrySignatureNames?.[2] && <span className="mt-8 text-sm font-bold text-slate-800">{settings.entrySignatureNames[2]}</span>}
                </div>
                {settings.entrySignatures[3] && (
                    <div className="sig-box flex flex-col items-center">
                        <p>{settings.entrySignatures[3]}</p>
                        {settings.entrySignatureNames?.[3] && <span className="mt-8 text-sm font-bold text-slate-800">{settings.entrySignatureNames[3]}</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

const PrintReportLayout: React.FC<{ data: Remittance[] | GroupedResults; options: { startDate: Date; endDate: Date; reportSummary: any; groupBy: string; }; }> = ({ data, options }) => {
    const settings = loadSettings();
    const farmers = getFarmers();
    const farmerMap = new Map(farmers.map(f => [f.id, f.name]));
    const productMap = new Map(settings.products.map(p => [p.id, p.name]));
    const header = (
        <div className="flex justify-between items-center mb-2 border-b-2 pb-2 border-slate-800 print-header">
            <div className="w-1/4">{settings.factoryLogo ? <img src={settings.factoryLogo} alt="Logo" className="h-8 max-w-[100px] object-contain" /> : <span></span>}</div>
            <div className="w-1/2 text-center"><h2 className="text-lg font-bold">گزارش حواله‌ها</h2><h3 className="text-base font-semibold">{settings.factoryName}</h3></div>
            <div className="w-1/4 text-left"><p className="text-sm font-semibold">از: <span>{formatDate(options.startDate)}</span></p><p className="text-sm font-semibold">تا: <span>{formatDate(options.endDate)}</span></p></div>
        </div>
    );
    const renderFlatTable = (tableData: Remittance[]) => (
        <table className="w-full text-sm text-center">
            <thead className="bg-slate-100"><tr><th className="p-2">تاریخ</th><th className="p-2">نوع</th><th className="p-2">فروشنده/مرغدار</th><th className="p-2">محصول</th><th className="p-2">توضیحات/نوع/کارخانه</th><th className="p-2">وزن بارنامه</th><th className="p-2">وزن باسکول/خروج</th><th className="p-2">افت</th><th className="p-2">کرایه</th><th className="p-2">راننده</th><th className="p-2">شماره</th></tr></thead>
            <tbody>{tableData.map(item => {
                const isEntry = 'sellerName' in item; const entry = isEntry ? item as Entry : null; const exit = !isEntry ? item as Exit : null;
                return (<tr key={item.id} className="border-b"><td className="p-2">{formatDate(item.date)}</td><td className="p-2">{isEntry ? <span className="text-green-600">ورود</span> : <span className="text-red-600">خروج</span>}</td><td className="p-2">{entry?.sellerName || (exit ? farmerMap.get(exit.farmerId) : '')}</td><td className="p-2">{productMap.get(item.productId)}</td><td className="p-2 text-xs">{entry?.factory ? entry.factory : ((!isEntry && exit?.productVariant) ? exit.productVariant : '-')}</td><td className="p-2">{entry ? toPersianNumerals((Number(entry.billWeight) || 0).toLocaleString()) : '-'}</td><td className="p-2 font-semibold">{toPersianNumerals((Number(entry?.scaleWeight) || Number(exit?.weight) || 0).toLocaleString())}</td><td className="p-2">{entry ? formatWastage(entry.wastage) : '-'}</td><td className="p-2">{entry ? formatCurrency(entry.transportCost) : '-'}</td><td className="p-2">{item.driverName}</td><td className="p-2">{toPersianNumerals(entry?.billNumber || exit?.invoiceNumber || '-')}</td></tr>);
            })}</tbody>
        </table>
    );
    const renderGroupedResults = (groupedData: GroupedResults) => (<div className="space-y-6">{Array.from(groupedData.entries()).map(([groupKey, groupData]) =>
        <div key={groupKey} className="border rounded-lg overflow-hidden" style={{ pageBreakInside: 'avoid' }}><div className="bg-slate-100 p-3"><h3 className="text-lg font-bold text-slate-800">{groupKey}</h3><div className="text-xs text-slate-600 mt-1"><span>تعداد کل سرویس‌ها: {toPersianNumerals(groupData.summary.totalRemittances)}</span><span className="mx-2">|</span><span>جمع کل وزن: {toPersianNumerals(groupData.summary.totalWeight.toLocaleString())} کیلوگرم</span></div><div className="mt-2 pt-2 border-t border-slate-200"><h4 className="text-sm font-semibold">خلاصه محصولات:</h4><div className="text-xs mt-1 space-y-1">{Array.from(groupData.summary.productSummary.entries()).map(([productName, summary]) =><div key={productName}><strong>{productName}:</strong> {toPersianNumerals(summary.totalWeight.toLocaleString())} کیلوگرم ({toPersianNumerals(summary.count)} سرویس)</div>)}</div></div></div><div className="p-2">{renderFlatTable(groupData.items)}</div></div>
    )}</div>);
    return (
        <div className="print-page"><table><thead><tr><th colSpan={11} style={{ border: 'none', paddingBottom: '0.5rem' }}>{header}</th></tr></thead></table>
            {options.reportSummary && (<div className="my-4 p-4 bg-slate-50 rounded-lg text-sm" style={{ pageBreakInside: 'avoid' }}><h3 className="text-base font-bold text-slate-800 mb-2">خلاصه کلی گزارش</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><div><strong>حواله ورود:</strong> {toPersianNumerals(options.reportSummary.entryCount)}</div><div><strong>حواله خروج:</strong> {toPersianNumerals(options.reportSummary.exitCount)}</div><div><strong>جمع کل بارنامه:</strong> {toPersianNumerals(options.reportSummary.totalBillWeight.toLocaleString())} kg</div><div><strong>جمع کل باسکول:</strong> {toPersianNumerals(options.reportSummary.totalScaleWeight.toLocaleString())} kg</div><div><strong>جمع کل افت:</strong> {formatWastage(options.reportSummary.totalScaleWeight - options.reportSummary.totalBillWeight)} kg</div><div><strong>جمع کل خروج:</strong> {toPersianNumerals(options.reportSummary.totalExitWeight.toLocaleString())} kg</div><div className="col-span-2"><strong>جمع کل کرایه:</strong> {formatCurrency(options.reportSummary.totalTransportCost)}</div></div></div>)}
            {Array.isArray(data) ? renderFlatTable(data) : renderGroupedResults(data)}
        </div>
    );
};


let printRootInstance: ReturnType<typeof createRoot> | null = null;
const performCleanup = () => {
    if (printRootInstance) { try { printRootInstance.unmount(); } catch (e) {} finally { printRootInstance = null; } }
    const printRoot = document.getElementById('print-root');
    if (printRoot) printRoot.innerHTML = '';
    document.documentElement.style.removeProperty('--watermark-url');
    document.body.classList.remove('bold-print');
    const customStyle = document.getElementById('custom-print-style');
    if (customStyle) customStyle.remove();
};
window.addEventListener('afterprint', performCleanup);

type PrintOptions = { pageSettings?: { title?: string, description?: string }[]; printDate?: Date; startDate?: Date; endDate?: Date; reportSummary?: any; groupBy?: string; farmer?: Farmer; brood?: Brood; generalDescription?: string; customPrintTitle?: string; showPageTotals?: boolean; showGrandTotal?: boolean; };

export const handlePrint = (type: 'entry' | 'exit' | 'analysis' | 'report' | 'brood', data: any, options: PrintOptions) => {
    const printRoot = document.getElementById('print-root');
    if (!printRoot) return;
    performCleanup();
    const settings = loadSettings();
    let componentToRender;
    const style = document.createElement('style');
    style.id = 'custom-print-style';
    if (type === 'brood') {
        style.innerHTML = `@page { size: A4 landscape; margin: 1cm; } @media print { body { -webkit-print-color-adjust: exact; } .dir-ltr { direction: ltr; } }`;
    } else {
        style.innerHTML = `@page { size: A4 landscape; }`;
    }
    document.head.appendChild(style);

    if (type === 'entry' || type === 'exit') componentToRender = <PrintPages type={type} data={data} printDate={options.printDate!} options={options} />;
    else if (type === 'analysis') componentToRender = <PrintAnalysisLayout data={data} dates={options as { startDate: Date, endDate: Date }} />;
    else if (type === 'report') componentToRender = <PrintReportLayout data={data} options={options as any} />;
    else if (type === 'brood') componentToRender = <PrintBroodLayout farmer={options.farmer!} brood={options.brood!} data={data} />;

    if (!componentToRender) return;
    printRootInstance = createRoot(printRoot);
    printRootInstance.render(<React.StrictMode>{componentToRender}</React.StrictMode>);

    setTimeout(() => {
        if (settings.factoryLogo) document.documentElement.style.setProperty('--watermark-url', `url(${settings.factoryLogo})`);
        if (type === 'analysis' || settings.printBoldText) document.body.classList.add('bold-print');
        window.print();
    }, 250);
};
