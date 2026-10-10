import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DatePicker from '../components/DatePicker';
import * as dataService from '../services/dataService';
import { toPersianNumerals, formatToISODate, formatCurrency } from '../utils/formatters';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { showToast } from '../utils/helpers';

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTING'];
// Toggleable columns of the per-product grid (item 7: customizable data grid).
type ProductColKey = 'entry' | 'exit' | 'net' | 'bill' | 'wastage' | 'cost' | 'rows';
const fmt = (n: number) => toPersianNumerals(Math.round(Number(n) || 0).toLocaleString());
const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * داشبورد گزارش‌گیری — an INDEPENDENT view: it reads server-aggregated numbers from
 * `GET /api/reports/summary` (SUM/GROUP BY inside PostgreSQL) and never touches the invoice entry
 * screens or the offline sync layer.
 */
const ReportsDashboard: React.FC = () => {
    const { role, isAdmin } = useAuth();
    const { settings, productMap } = useSettings();
    const allowed = isAdmin || ALLOWED_ROLES.includes(String(role || '').toUpperCase());

    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d; });
    const [endDate, setEndDate] = useState(() => new Date());
    const [summary, setSummary] = useState<dataService.ReportSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (from: Date, to: Date) => {
        if (!allowed) return;
        setLoading(true);
        setError(null);
        const res = await dataService.fetchReportSummary(formatToISODate(from), formatToISODate(to));
        if (!res) {
            setSummary(null);
            setError('تهیه گزارش ممکن نشد (عدم دسترسی یا خطای شبکه).');
        } else {
            setSummary(res);
        }
        setLoading(false);
    }, [allowed]);

    useEffect(() => { void load(startDate, endDate); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [allowed]);

    const setPreset = (days: number) => {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - (days - 1));
        setStartDate(from);
        setEndDate(to);
        void load(from, to);
    };

    const setMonthPreset = () => {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        setStartDate(from);
        setEndDate(now);
        void load(from, now);
    };

    // Entry vs exit side by side per product (the pivot the accounting team reads).
    const productRows = useMemo(() => {
        const map = new Map<string, { name: string; entry: number; exit: number; entryRows: number; exitRows: number; bill: number; wastage: number; cost: number }>();
        (summary?.byProduct || []).forEach(r => {
            const key = r.productId || '-';
            // Persian label first: `settings.products` is the authoritative name list, the DB row's
            // productName may be a raw id (e.g. prod_1763223797391) for products created offline.
            const row = map.get(key) || { name: productMap.get(key) || r.productName || key, entry: 0, exit: 0, entryRows: 0, exitRows: 0, bill: 0, wastage: 0, cost: 0 };
            if (r.type === 'exit') { row.exit += r.totalWeight; row.exitRows += r.rows; }
            else { row.entry += r.totalWeight; row.entryRows += r.rows; }
            row.bill += r.billWeight;
            row.wastage += r.wastage;
            row.cost += r.transportCost;
            map.set(key, row);
        });
        return Array.from(map.values())
            .map(r => ({ ...r, net: r.entry - r.exit }))
            .sort((a, b) => (b.entry + b.exit) - (a.entry + a.exit));
    }, [summary]);

    const maxWeight = useMemo(
        () => productRows.reduce((m, r) => Math.max(m, r.entry, r.exit), 0) || 1,
        [productRows],
    );

    // --- Item 7: customizable grid + collapsible sections ------------------------------------
    const PRODUCT_COLUMNS: { key: ProductColKey; label: string; tone: string }[] = [
        { key: 'entry', label: 'ورود (kg)', tone: 'text-emerald-700 font-bold' },
        { key: 'exit', label: 'خروج (kg)', tone: 'text-orange-700 font-bold' },
        { key: 'net', label: 'مانده (kg)', tone: 'text-sky-800 font-bold' },
        { key: 'bill', label: 'وزن بارنامه', tone: 'text-slate-600' },
        { key: 'wastage', label: 'افت', tone: 'text-slate-600' },
        { key: 'cost', label: 'کرایه (ریال)', tone: 'text-slate-600' },
        { key: 'rows', label: 'ردیف ورود/خروج', tone: 'text-xs text-slate-500' },
    ];
    const [enabledCols, setEnabledCols] = useState<Record<ProductColKey, boolean>>({
        entry: true, exit: true, net: true, bill: true, wastage: true, cost: true, rows: true,
    });
    const visibleColumns = PRODUCT_COLUMNS.filter(c => enabledCols[c.key]);

    const productCellValue = (r: typeof productRows[number], key: ProductColKey): string => {
        switch (key) {
            case 'entry': return fmt(r.entry);
            case 'exit': return fmt(r.exit);
            case 'net': return fmt(r.net);
            case 'bill': return fmt(r.bill);
            case 'wastage': return fmt(r.wastage);
            case 'cost': return formatCurrency(r.cost);
            case 'rows': return fmt(r.entryRows) + ' / ' + fmt(r.exitRows);
        }
    };
    const productTotalValue = (key: ProductColKey): string => {
        const t = summary?.totals;
        switch (key) {
            case 'entry': return fmt(t?.entryWeight || 0);
            case 'exit': return fmt(t?.exitWeight || 0);
            case 'net': return fmt(t?.netWeight || 0);
            case 'bill': return fmt(t?.billWeight || 0);
            case 'wastage': return fmt(t?.wastage || 0);
            case 'cost': return formatCurrency(t?.transportCost || 0);
            case 'rows': return fmt(t?.rows || 0);
        }
    };

    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const toggleSection = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

    /** Collapsible card used by every section of the dashboard. */
    const Section: React.FC<{ id: string; title: string; subtitle?: string; extra?: React.ReactNode; children?: React.ReactNode }> =
        ({ id, title, subtitle, extra, children }) => (
            <div className="bg-white p-4 rounded-xl shadow-md">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <button type="button" onClick={() => toggleSection(id)} className="flex items-start gap-2 text-right">
                        <span className={`mt-1 text-slate-400 transition-transform ${collapsed[id] ? 'rotate-90' : ''}`}>▾</span>
                        <span>
                            <span className="block font-bold text-slate-700">{title}</span>
                            {subtitle && <span className="block text-[11px] text-slate-500 mt-1">{subtitle}</span>}
                        </span>
                    </button>
                    {extra}
                </div>
                {!collapsed[id] && children}
            </div>
        );

    const exportCsv = () => {
        if (!summary) return;
        const lines: string[] = [];
        lines.push(['گزارش تجمیعی حواله‌ها'].map(csvCell).join(','));
        lines.push([`کارخانه: ${settings.factoryName || ''}`].map(csvCell).join(','));
        lines.push([`از تاریخ: ${summary.startDate}`, `تا تاریخ: ${summary.endDate}`].map(csvCell).join(','));
        lines.push('');
        lines.push(['محصول', 'ورود (kg)', 'خروج (kg)', 'مانده (kg)', 'وزن بارنامه (kg)', 'افت (kg)', 'کرایه حمل (ریال)', 'ردیف ورود', 'ردیف خروج'].map(csvCell).join(','));
        productRows.forEach(r => {
            lines.push([r.name, r.entry, r.exit, r.net, r.bill, r.wastage, r.cost, r.entryRows, r.exitRows].map(csvCell).join(','));
        });
        lines.push('');
        lines.push(['جمع کل', summary.totals.entryWeight, summary.totals.exitWeight, summary.totals.netWeight,
            summary.totals.billWeight, summary.totals.wastage, summary.totals.transportCost,
            summary.totals.entryRows, summary.totals.exitRows].map(csvCell).join(','));

        // Driver logistics section (entry + exit) — additive, appended to the same CSV file.
        lines.push('');
        lines.push(['گزارش کارکرد راننده‌ها (ورود و خروج)'].map(csvCell).join(','));
        lines.push(['نام راننده', 'سرویس ورود', 'سرویس خروج', 'جمع سرویس', 'وزن ورود (kg)', 'وزن خروج (kg)', 'جمع وزن (kg)', 'کرایه ورود (ریال)', 'کرایه خروج (ریال)', 'جمع کرایه (ریال)', 'آخرین سرویس'].map(csvCell).join(','));
        drivers.forEach(d => {
            lines.push([driverLabel(d.driver), d.entryServices, d.exitServices, d.totalServices,
                d.entryWeight, d.exitWeight, d.totalWeight,
                d.entryCost, d.exitCost, d.totalCost, d.lastDate].map(csvCell).join(','));
        });
        lines.push(['جمع کل',
            summary.driverTotals?.entryServices || 0, summary.driverTotals?.exitServices || 0, summary.driverTotals?.totalServices || 0,
            summary.driverTotals?.entryWeight || 0, summary.driverTotals?.exitWeight || 0, summary.driverTotals?.totalWeight || 0,
            summary.driverTotals?.entryCost || 0, summary.driverTotals?.exitCost || 0, summary.driverTotals?.totalCost || 0, ''].map(csvCell).join(','));

        // The \uFEFF BOM is mandatory: without it Excel decodes the file with the system code page
        // and Persian text turns into mojibake. Values are quoted per RFC 4180 so commas in product
        // names can never break the columns.
        const csv = '\uFEFF' + lines.join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report-${summary.startDate}_${summary.endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('فایل Excel (CSV با UTF-8 BOM) دانلود شد.');
    };

    const printReport = () => {
        if (!summary) return;
        const t = summary.totals;
        const body = productRows.map((r, i) => `<tr>
            <td>${toPersianNumerals(i + 1)}</td><td style="text-align:right">${r.name}</td>
            <td>${fmt(r.entry)}</td><td>${fmt(r.exit)}</td><td>${fmt(r.net)}</td>
            <td>${fmt(r.bill)}</td><td>${fmt(r.wastage)}</td><td>${fmt(r.cost)}</td>
        </tr>`).join('');
        const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
            <title>گزارش تجمیعی حواله‌ها</title><style>
            body{font-family:Tahoma,'Segoe UI',sans-serif;padding:24px;color:#0f172a}
            h1{font-size:18px;margin:0 0 4px}.meta{font-size:12px;color:#475569;margin-bottom:14px}
            table{width:100%;border-collapse:collapse;font-size:12px}
            th,td{border:1px solid #64748b;padding:6px;text-align:center}
            thead{background:#e2e8f0}tfoot{background:#f1f5f9;font-weight:bold}
            </style></head><body>
            <h1>${settings.factoryName || 'کارخانه'} — گزارش تجمیعی حواله‌ها</h1>
            <div class="meta">از تاریخ ${summary.startDate} تا ${summary.endDate} — تهیه‌شده در ${new Date(summary.generatedAt).toLocaleString('fa-IR')}</div>
            <table><thead><tr><th>#</th><th>محصول</th><th>ورود (kg)</th><th>خروج (kg)</th><th>مانده (kg)</th><th>وزن بارنامه</th><th>افت</th><th>کرایه (ریال)</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr><td colspan="2">جمع کل</td><td>${fmt(t.entryWeight)}</td><td>${fmt(t.exitWeight)}</td><td>${fmt(t.netWeight)}</td><td>${fmt(t.billWeight)}</td><td>${fmt(t.wastage)}</td><td>${fmt(t.transportCost)}</td></tr></tfoot>
            </table></body></html>`;
        // A separate window keeps this completely independent from the app's own print pipeline.
        const w = window.open('', '_blank');
        if (!w) { showToast('مرورگر پنجره چاپ را مسدود کرد؛ لطفاً اجازه دهید.', 'warning'); return; }
        w.document.write(html);
        w.document.close();
        w.focus();
        w.setTimeout(() => w.print(), 300);
    };

    const productTable = (
        <Section
            id="products"
            title="جمع به تفکیک محصول (ورود / خروج)"
            subtitle={'قابل تنظیم — ستون‌های دلخواه را روشن/خاموش کنید · ' + fmt(productRows.length) + ' محصول'}
            extra={(
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="text-slate-500">ستون‌ها:</span>
                    {PRODUCT_COLUMNS.map(c => (
                        <label key={c.key} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-slate-100">
                            <input
                                type="checkbox"
                                checked={enabledCols[c.key]}
                                onChange={e => setEnabledCols(prev => ({ ...prev, [c.key]: e.target.checked }))}
                                className="w-3.5 h-3.5"
                            />
                            <span className="text-slate-700">{c.label}</span>
                        </label>
                    ))}
                    <button
                        type="button"
                        onClick={() => setEnabledCols({ entry: true, exit: true, net: true, bill: true, wastage: true, cost: true, rows: true })}
                        className="text-sky-700 hover:underline"
                    >
                        نمایش همه
                    </button>
                </div>
            )}
        >
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                    <thead className="bg-slate-100">
                        <tr>
                            <th className="p-2">محصول</th>
                            {visibleColumns.map(c => <th key={c.key} className="p-2">{c.label}</th>)}
                            <th className="p-2 w-40">مقایسه</th>
                        </tr>
                    </thead>
                    <tbody>
                        {productRows.length === 0 && (
                            <tr><td colSpan={visibleColumns.length + 2} className="p-4 text-center text-slate-500">داده‌ای در این بازه وجود ندارد.</td></tr>
                        )}
                        {productRows.map(r => (
                            <tr key={r.name} className="border-b hover:bg-slate-50">
                                <td className="p-2 font-bold text-slate-800">{r.name}</td>
                                {visibleColumns.map(c => (
                                    <td key={c.key} className={`p-2 ${c.key === 'net' && r.net < 0 ? 'text-red-600 font-bold' : c.tone}`}>
                                        {productCellValue(r, c.key)}
                                    </td>
                                ))}
                                <td className="p-2">
                                    <div className="space-y-1">
                                        <div className="h-2 bg-emerald-500 rounded-full" style={{ width: `${Math.max(2, (r.entry / maxWeight) * 100)}%` }}></div>
                                        <div className="h-2 bg-orange-500 rounded-full" style={{ width: `${Math.max(2, (r.exit / maxWeight) * 100)}%` }}></div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {summary && (
                        <tfoot className="bg-slate-100 font-bold">
                            <tr>
                                <td className="p-2">جمع کل</td>
                                {visibleColumns.map(c => (
                                    <td key={c.key} className={`p-2 ${c.key === 'cost' || c.key === 'net' ? 'text-sky-800' : ''}`}>
                                        {productTotalValue(c.key)}
                                    </td>
                                ))}
                                <td className="p-2"></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </Section>
    );

    const drivers = summary?.byDriver || [];
    const driverLabel = (d: string) => (d && d.trim() ? d.trim() : 'نامشخص (ثبت‌نشده)');

    const driverReceiptHtml = (d: dataService.ReportDriverRow) => {
        const cell = (v: number) => `<td class="num">${fmt(v)}</td>`;
        return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
            <title>رسید راننده ${driverLabel(d.driver)}</title><style>
            body{font-family:Tahoma,'Segoe UI',sans-serif;padding:26px;color:#0f172a}
            .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:16px}
            h1{font-size:18px;margin:0}h2{font-size:15px;margin:6px 0 0;color:#334155}
            .meta{font-size:12px;color:#475569;text-align:left;line-height:1.9}
            table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}
            th,td{border:1px solid #64748b;padding:8px;text-align:center}
            thead th{background:#e2e8f0}tbody th{background:#f8fafc;text-align:right;width:34%}
            .num{font-weight:bold}
            .total{margin:6px 0 18px;padding:12px 16px;border:2px dashed #0f172a;border-radius:10px;display:flex;justify-content:space-between;font-size:15px;font-weight:bold;background:#f8fafc}
            .sign{display:flex;justify-content:space-between;margin-top:34px;font-size:12px;color:#334155}
            .sign div{width:45%;border-top:1px solid #94a3b8;padding-top:6px;text-align:center}
            @media print{body{padding:10px}}
            </style></head><body>
            <div class="head">
                <div><h1>${settings.factoryName || 'کارخانه'}</h1><h2>رسید کارکرد راننده</h2></div>
                <div class="meta">
                    راننده: <b>${driverLabel(d.driver)}</b><br>
                    بازه گزارش: ${summary?.startDate || ''} تا ${summary?.endDate || ''}<br>
                    تاریخ تهیه: ${new Date(summary?.generatedAt || Date.now()).toLocaleString('fa-IR')}
                </div>
            </div>
            <table>
                <thead><tr><th></th><th>ورود</th><th>خروج</th><th>جمع</th></tr></thead>
                <tbody>
                    <tr><th>تعداد سرویس</th>${cell(d.entryServices)}${cell(d.exitServices)}${cell(d.totalServices)}</tr>
                    <tr><th>وزن (کیلوگرم)</th>${cell(d.entryWeight)}${cell(d.exitWeight)}${cell(d.totalWeight)}</tr>
                    <tr><th>کرایه حمل (ریال)</th>${cell(d.entryCost)}${cell(d.exitCost)}${cell(d.totalCost)}</tr>
                </tbody>
            </table>
            <div class="total"><span>جمع کل کرایه قابل پرداخت به این راننده</span><span>${fmt(d.totalCost)} ریال</span></div>
            <div class="sign"><div>امضای راننده</div><div>مهر و امضای کارخانه</div></div>
            </body></html>`;
    };

    const printDriverReceipt = (d: dataService.ReportDriverRow) => {
        if (!summary) return;
        const w = window.open('', '_blank');
        if (!w) { showToast('مرورگر پنجره چاپ را مسدود کرد؛ لطفاً اجازه دهید.', 'warning'); return; }
        w.document.write(driverReceiptHtml(d));
        w.document.close();
        w.focus();
        w.setTimeout(() => w.print(), 300);
    };

    const printDriversReport = () => {
        if (!summary) return;
        const t = summary.driverTotals;
        const rowsHtml = drivers.map((d, i) => `<tr>
            <td>${toPersianNumerals(i + 1)}</td><td style="text-align:right">${driverLabel(d.driver)}</td>
            <td>${fmt(d.entryServices)}</td><td>${fmt(d.exitServices)}</td><td class="num">${fmt(d.totalServices)}</td>
            <td>${fmt(d.entryWeight)}</td><td>${fmt(d.exitWeight)}</td><td class="num">${fmt(d.totalWeight)}</td>
            <td>${fmt(d.entryCost)}</td><td>${fmt(d.exitCost)}</td><td class="num">${fmt(d.totalCost)}</td>
            <td>${d.lastDate || '-'}</td>
        </tr>`).join('');
        const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
            <title>گزارش کارکرد راننده‌ها</title><style>
            body{font-family:Tahoma,'Segoe UI',sans-serif;padding:24px;color:#0f172a}
            h1{font-size:18px;margin:0 0 4px}.meta{font-size:12px;color:#475569;margin-bottom:14px}
            table{width:100%;border-collapse:collapse;font-size:11px}
            th,td{border:1px solid #64748b;padding:5px;text-align:center}
            thead{background:#e2e8f0}tfoot{background:#f1f5f9;font-weight:bold}.num{font-weight:bold}
            </style></head><body>
            <h1>${settings.factoryName || 'کارخانه'} — گزارش کارکرد راننده‌ها (ورود و خروج)</h1>
            <div class="meta">از ${summary.startDate} تا ${summary.endDate} — تهیه‌شده در ${new Date(summary.generatedAt).toLocaleString('fa-IR')}</div>
            <table><thead><tr><th>#</th><th>نام راننده</th><th>سرویس ورود</th><th>سرویس خروج</th><th>جمع سرویس</th><th>وزن ورود</th><th>وزن خروج</th><th>جمع وزن</th><th>کرایه ورود</th><th>کرایه خروج</th><th>جمع کرایه</th><th>آخرین سرویس</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr><td colspan="2">جمع کل (${toPersianNumerals(t?.drivers || 0)} راننده)</td><td>${fmt(t?.entryServices || 0)}</td><td>${fmt(t?.exitServices || 0)}</td><td>${fmt(t?.totalServices || 0)}</td><td>${fmt(t?.entryWeight || 0)}</td><td>${fmt(t?.exitWeight || 0)}</td><td>${fmt(t?.totalWeight || 0)}</td><td>${fmt(t?.entryCost || 0)}</td><td>${fmt(t?.exitCost || 0)}</td><td>${fmt(t?.totalCost || 0)}</td><td></td></tr></tfoot>
            </table></body></html>`;
        const w = window.open('', '_blank');
        if (!w) { showToast('مرورگر پنجره چاپ را مسدود کرد؛ لطفاً اجازه دهید.', 'warning'); return; }
        w.document.write(html);
        w.document.close();
        w.focus();
        w.setTimeout(() => w.print(), 300);
    };

    const driversSection = (
        <Section
            id="drivers"
            title="گزارش کارکرد راننده‌ها (ورود و خروج)"
            subtitle={fmt(summary?.driverTotals?.drivers || 0) + ' راننده · ' + fmt(summary?.driverTotals?.totalServices || 0) + ' سرویس · ' + fmt(summary?.driverTotals?.totalWeight || 0) + ' کیلوگرم · جمع کرایه ' + formatCurrency(summary?.driverTotals?.totalCost || 0)}
            extra={(
                <button
                    type="button"
                    onClick={printDriversReport}
                    disabled={drivers.length === 0}
                    className="bg-slate-700 text-white px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
                >
                    چاپ گزارش کامل رانندگان
                </button>
            )}
        >
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table className="w-full text-xs text-right">
                    <thead className="bg-slate-100 sticky top-0">
                        <tr>
                            <th className="p-2" rowSpan={2}>#</th>
                            <th className="p-2" rowSpan={2}>نام راننده</th>
                            <th className="p-2 border-x border-slate-300" colSpan={3}>تعداد سرویس</th>
                            <th className="p-2 border-x border-slate-300" colSpan={3}>وزن (کیلوگرم)</th>
                            <th className="p-2 border-x border-slate-300" colSpan={3}>کرایه حمل (ریال)</th>
                            <th className="p-2" rowSpan={2}>آخرین سرویس</th>
                            <th className="p-2" rowSpan={2}>رسید</th>
                        </tr>
                        <tr>
                            <th className="p-1 border-x border-slate-300 bg-emerald-50 text-emerald-800">ورود</th>
                            <th className="p-1 bg-orange-50 text-orange-800">خروج</th>
                            <th className="p-1 bg-slate-200">جمع</th>
                            <th className="p-1 border-x border-slate-300 bg-emerald-50 text-emerald-800">ورود</th>
                            <th className="p-1 bg-orange-50 text-orange-800">خروج</th>
                            <th className="p-1 bg-slate-200">جمع</th>
                            <th className="p-1 border-x border-slate-300 bg-emerald-50 text-emerald-800">ورود</th>
                            <th className="p-1 bg-orange-50 text-orange-800">خروج</th>
                            <th className="p-1 bg-slate-200">جمع</th>
                        </tr>
                    </thead>
                    <tbody>
                        {drivers.length === 0 && (
                            <tr><td colSpan={13} className="p-4 text-center text-slate-500">داده‌ی رانندگان در این بازه وجود ندارد.</td></tr>
                        )}
                        {drivers.map((d, i) => (
                            <tr key={`${d.driver}-${i}`} className="border-b hover:bg-slate-50">
                                <td className="p-2 text-slate-400">{toPersianNumerals(i + 1)}</td>
                                <td className="p-2 font-bold text-slate-800 whitespace-nowrap">{driverLabel(d.driver)}</td>
                                <td className="p-2 text-emerald-700 border-r border-slate-200">{fmt(d.entryServices)}</td>
                                <td className="p-2 text-orange-700">{fmt(d.exitServices)}</td>
                                <td className="p-2 font-bold bg-slate-50">{fmt(d.totalServices)}</td>
                                <td className="p-2 text-emerald-700 border-r border-slate-200">{fmt(d.entryWeight)}</td>
                                <td className="p-2 text-orange-700">{fmt(d.exitWeight)}</td>
                                <td className="p-2 font-bold bg-slate-50">{fmt(d.totalWeight)}</td>
                                <td className="p-2 text-emerald-700 border-r border-slate-200">{fmt(d.entryCost)}</td>
                                <td className="p-2 text-orange-700">{fmt(d.exitCost)}</td>
                                <td className="p-2 font-bold bg-slate-50 text-sky-800">{fmt(d.totalCost)}</td>
                                <td className="p-2 text-slate-500 font-mono text-[11px] whitespace-nowrap" dir="ltr">{d.lastDate || '-'}</td>
                                <td className="p-2">
                                    <button
                                        type="button"
                                        onClick={() => printDriverReceipt(d)}
                                        title="چاپ رسید اختصاصی این راننده"
                                        className="bg-sky-600 text-white px-2 py-1 rounded-lg text-[11px] font-bold hover:bg-sky-700 whitespace-nowrap"
                                    >
                                        🖨️ چاپ رسید
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {summary && drivers.length > 0 && (
                        <tfoot className="bg-slate-100 font-bold">
                            <tr>
                                <td className="p-2" colSpan={2}>جمع کل ({fmt(summary.driverTotals?.drivers || 0)} راننده)</td>
                                <td className="p-2">{fmt(summary.driverTotals?.entryServices || 0)}</td>
                                <td className="p-2">{fmt(summary.driverTotals?.exitServices || 0)}</td>
                                <td className="p-2 bg-slate-200">{fmt(summary.driverTotals?.totalServices || 0)}</td>
                                <td className="p-2">{fmt(summary.driverTotals?.entryWeight || 0)}</td>
                                <td className="p-2">{fmt(summary.driverTotals?.exitWeight || 0)}</td>
                                <td className="p-2 bg-slate-200">{fmt(summary.driverTotals?.totalWeight || 0)}</td>
                                <td className="p-2">{fmt(summary.driverTotals?.entryCost || 0)}</td>
                                <td className="p-2">{fmt(summary.driverTotals?.exitCost || 0)}</td>
                                <td className="p-2 bg-slate-200 text-sky-800">{formatCurrency(summary.driverTotals?.totalCost || 0)}</td>
                                <td className="p-2" colSpan={2}></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </Section>
    );

    const tables = (
        <div className="space-y-4">
            {productTable}

            {driversSection}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Section
                    id="variants"
                    title="جمع به تفکیک «توضیحات / نوع»"
                    subtitle={'ورود/خروج · ' + fmt((summary?.byVariant || []).length) + ' ردیف'}
                >
                    <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-100 sticky top-0">
                                <tr><th className="p-2">نوع</th><th className="p-2">توضیحات / نوع</th><th className="p-2">وزن (kg)</th><th className="p-2">ردیف</th></tr>
                            </thead>
                            <tbody>
                                {(summary?.byVariant || []).length === 0 && (
                                    <tr><td colSpan={4} className="p-4 text-center text-slate-500">داده‌ای وجود ندارد.</td></tr>
                                )}
                                {(summary?.byVariant || []).map((v, i) => (
                                    <tr key={`${v.type}-${i}`} className="border-b hover:bg-slate-50">
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${v.type === 'exit' ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                {v.type === 'exit' ? 'خروج' : 'ورود'}
                                            </span>
                                        </td>
                                        <td className="p-2 text-slate-700">{v.variant}</td>
                                        <td className="p-2 font-bold">{fmt(v.totalWeight)}</td>
                                        <td className="p-2 text-slate-500">{fmt(v.rows)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section
                    id="daily"
                    title="روند روزانه"
                    subtitle={'تجمیع روزانه ورود و خروج · ' + fmt((summary?.byDay || []).length) + ' ردیف'}
                >
                    <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-100 sticky top-0">
                                <tr><th className="p-2">تاریخ</th><th className="p-2">نوع</th><th className="p-2">وزن (kg)</th><th className="p-2">ردیف</th></tr>
                            </thead>
                            <tbody>
                                {(summary?.byDay || []).length === 0 && (
                                    <tr><td colSpan={4} className="p-4 text-center text-slate-500">داده‌ای وجود ندارد.</td></tr>
                                )}
                                {(summary?.byDay || []).map((d, i) => (
                                    <tr key={`${d.date}-${d.type}-${i}`} className="border-b hover:bg-slate-50">
                                        <td className="p-2 text-slate-600 font-mono text-xs" dir="ltr">{d.date}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${d.type === 'exit' ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                {d.type === 'exit' ? 'خروج' : 'ورود'}
                                            </span>
                                        </td>
                                        <td className="p-2 font-bold">{fmt(d.totalWeight)}</td>
                                        <td className="p-2 text-slate-500">{fmt(d.rows)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>
            </div>
        </div>
    );

    const badge = (label: string, value: string, tone: string) => (
        <div className={`rounded-xl shadow-md p-4 border-r-4 ${tone}`}>
            <div className="text-[11px] text-slate-500 mb-1">{label}</div>
            <div className="text-xl font-bold text-slate-800">{value}</div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-700">داشبورد گزارش‌گیری</h1>
                {summary && (
                    <span className="text-[11px] text-slate-400">
                        تهیه‌شده در {new Date(summary.generatedAt).toLocaleString('fa-IR')}
                    </span>
                )}
            </div>

            {!allowed ? (
                <div className="bg-white p-8 rounded-xl shadow-md text-center text-slate-600">
                    دسترسی به داشبورد گزارش‌گیری فقط برای «مدیر سیستم»، «مدیر» و «حسابداری» فعال است.
                </div>
            ) : (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-md space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">از تاریخ</label>
                                <DatePicker id="report-start" value={startDate} onChange={setStartDate} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">تا تاریخ</label>
                                <DatePicker id="report-end" value={endDate} onChange={setEndDate} />
                            </div>
                            <button
                                type="button"
                                onClick={() => void load(startDate, endDate)}
                                disabled={loading}
                                className="bg-sky-600 text-white px-4 py-2 rounded-lg font-bold disabled:opacity-50"
                            >
                                {loading ? 'در حال محاسبه…' : 'تهیه گزارش'}
                            </button>
                            <div className="flex gap-2 flex-wrap">
                                <button type="button" onClick={exportCsv} disabled={!summary} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-40">خروجی Excel (CSV)</button>
                                <button type="button" onClick={printReport} disabled={!summary} className="bg-slate-700 text-white px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-40">چاپ گزارش</button>
                            </div>
                        </div>
                        <div className="flex gap-2 flex-wrap text-xs">
                            <span className="text-slate-500">میان‌بر:</span>
                            <button type="button" onClick={() => setPreset(1)} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">امروز</button>
                            <button type="button" onClick={() => setPreset(7)} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">۷ روز</button>
                            <button type="button" onClick={() => setPreset(30)} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">۳۰ روز</button>
                            <button type="button" onClick={setMonthPreset} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">ماه جاری</button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">{error}</div>
                    )}

                    {summary && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                                {badge('مجموع ورود (kg)', fmt(summary.totals.entryWeight), 'border-emerald-500')}
                                {badge('مجموع خروج (kg)', fmt(summary.totals.exitWeight), 'border-orange-500')}
                                {badge('مانده (ورود − خروج)', fmt(summary.totals.netWeight), 'border-sky-500')}
                                {badge('تعداد ردیف‌ها', fmt(summary.totals.rows), 'border-slate-400')}
                                {badge('مجموع افت (kg)', fmt(summary.totals.wastage), 'border-red-400')}
                                {badge('مجموع کرایه', formatCurrency(summary.totals.transportCost), 'border-violet-400')}
                            </div>
                            {tables}
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default ReportsDashboard;