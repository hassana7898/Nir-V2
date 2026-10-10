import React, { useCallback, useEffect, useState } from 'react';
import { Log } from '../types';
import * as dataService from '../services/dataService';
import { formatDateTime, toPersianNumerals } from '../utils/formatters';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';

const ACTION_LABELS: Record<string, string> = { CREATE: 'ایجاد', UPDATE: 'ویرایش', DELETE: 'حذف', REORDER: 'ترتیب دستی', BULK_MOVE: 'انتقال گروهی' };
const ACTION_STYLES: Record<string, string> = { CREATE: 'bg-green-100 text-green-800 border-green-200', UPDATE: 'bg-blue-100 text-blue-800 border-blue-200', DELETE: 'bg-red-100 text-red-800 border-red-200', REORDER: 'bg-violet-100 text-violet-800 border-violet-200', BULK_MOVE: 'bg-amber-100 text-amber-800 border-amber-200' };
const ROLE_LABELS: Record<string, string> = { ADMIN: 'مدیر سیستم', MANAGER: 'مدیر', ACCOUNTING: 'حسابداری', OPERATOR: 'اپراتور', VIEWER: 'مشاهده‌گر' };
const toMs = (v: string | number): number => (typeof v === 'number' ? v : Date.parse(String(v)) || 0);

/**
 * ردپای کاربران (audit trail) + سابقه محلی.
 * The server-authoritative tab is limited to ADMIN + MANAGER here AND by the API
 * (requireRole on GET /api/audit), so a VIEWER can never read the trail.
 */
const LogPage: React.FC = () => {
    const { isAdmin, role } = useAuth();
    const { productMap } = useSettings();
    const canViewAudit = isAdmin || String(role || '').toUpperCase() === 'MANAGER';
    const [tab, setTab] = useState<'audit' | 'history'>(canViewAudit ? 'audit' : 'history');

    const [history, setHistory] = useState<Log[]>([]);
    useEffect(() => { setHistory(dataService.getLogs()); }, []);

    const [rows, setRows] = useState<dataService.AuditLogRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [denied, setDenied] = useState(false);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const emptyFilters = { action: '', user: '', search: '', from: '', to: '' };
    const [filters, setFilters] = useState({ ...emptyFilters });
    const [applied, setApplied] = useState({ ...emptyFilters });

    const load = useCallback(async (nextPage: number, f: typeof emptyFilters) => {
        if (!canViewAudit) return;
        setLoading(true);
        const res = await dataService.fetchAuditLogs({
            page: nextPage,
            limit: 50,
            action: f.action || undefined,
            user: f.user || undefined,
            search: f.search || undefined,
            from: f.from || undefined,
            to: f.to || undefined,
        });
        if (res === null) {
            setDenied(true); setRows([]); setTotal(0); setTotalPages(1);
        } else {
            setDenied(false); setRows(res.logs || []); setTotal(res.total || 0); setTotalPages(res.totalPages || 1);
        }
        setPage(nextPage);
        setLoading(false);
    }, [canViewAudit]);

    useEffect(() => {
        if (tab === 'audit') void load(1, applied);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, applied, load]);

    const toggle = (id: string) => setOpen(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

    const val = (c: dataService.AuditChange, v: any): string => {
        if (v === null || v === undefined || v === '') return '-';
        if (c.field === 'productId') return productMap.get(String(v)) || String(v);
        if (c.field === 'isCrumble' || c.field === 'isPageBreak') return String(v) === 'true' ? 'بله' : 'خیر';
        return String(v);
    };

    const historySection = (
        <div className="overflow-x-auto max-h-[calc(100vh-200px)] overflow-y-auto">
            <table className="w-full text-sm text-right">
                <thead className="bg-slate-100 sticky top-0">
                    <tr>
                        <th className="p-3">زمان</th>
                        <th className="p-3">عملیات</th>
                        <th className="p-3">جزئیات</th>
                    </tr>
                </thead>
                <tbody>
                    {history.length > 0 ? history.map((log, index) => (
                        <tr key={index} className="border-b">
                            <td className="p-3 text-slate-500 font-mono text-xs" dir="ltr">{formatDateTime(log.timestamp)}</td>
                            <td className="p-3 font-semibold text-slate-700">{log.actionText}</td>
                            <td className="p-3 text-slate-700">{log.details}</td>
                        </tr>
                    )) : (
                        <tr><td colSpan={3} className="text-center p-4 text-slate-500">هیچ سابقه‌ای یافت نشد.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const auditSection: any = !canViewAudit ? (
        <div className="p-6 text-center text-slate-600 bg-slate-50 rounded-xl">دسترسی به ردپای کاربران فقط برای «مدیر سیستم» و «مدیر» فعال است.</div>
    ) : denied ? (
        <div className="p-6 text-center text-red-700 bg-red-50 rounded-xl">دسترسی به ردپا برقرار نشد (عدم مجوز یا خطای شبکه).</div>
    ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
                <select value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })} className="p-2 border rounded-lg text-sm">
                    <option value="">همه عملیات</option>
                    {Object.keys(ACTION_LABELS).map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
                <input value={filters.user} onChange={e => setFilters({ ...filters, user: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') setApplied({ ...filters }); }} placeholder="نام کاربر" className="p-2 border rounded-lg text-sm" />
                <input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') setApplied({ ...filters }); }} placeholder="جست‌وجو در جزئیات یا شناسه" className="p-2 border rounded-lg text-sm" />
                <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} className="p-2 border rounded-lg text-sm" />
                <div className="flex gap-2">
                    <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} className="p-2 border rounded-lg text-sm flex-grow" />
                    <button type="button" onClick={() => setApplied({ ...filters })} className="bg-sky-600 text-white px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap">اعمال</button>
                </div>
            </div>

            <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
                <table className="w-full text-sm text-right">
                    <thead className="bg-slate-100 sticky top-0">
                        <tr>
                            <th className="p-3">زمان</th>
                            <th className="p-3">کاربر</th>
                            <th className="p-3">نقش</th>
                            <th className="p-3">عملیات</th>
                            <th className="p-3">جزئیات</th>
                            <th className="p-3">IP</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">در حال بارگذاری…</td></tr>}
                        {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">رکوردی یافت نشد.</td></tr>}
                        {rows.map(row => {
                            const changes = row.summary?.changes || [];
                            const isOpen = open.has(row.id);
                            return (
                                <React.Fragment key={row.id}>
                                    <tr className="border-b align-top">
                                        <td className="p-3 text-slate-500 font-mono text-xs whitespace-nowrap" dir="ltr">{formatDateTime(toMs(row.createdAt))}</td>
                                        <td className="p-3 font-bold text-slate-800 whitespace-nowrap">{row.username || '—'}</td>
                                        <td className="p-3 text-slate-600 whitespace-nowrap">{ROLE_LABELS[String(row.role || '').toUpperCase()] || row.role || '—'}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded-lg border text-xs font-bold ${ACTION_STYLES[row.action] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>{ACTION_LABELS[row.action] || row.action}</span>
                                        </td>
                                        <td className="p-3 text-slate-700">
                                            {row.details || '—'}
                                            {changes.length > 0 && (
                                                <button type="button" onClick={() => toggle(row.id)} className="block text-sky-700 text-xs mt-1 underline">
                                                    {isOpen ? 'بستن تغییرات' : `نمایش ${toPersianNumerals(changes.length)} تغییر`}
                                                </button>
                                            )}
                                        </td>
                                        <td className="p-3 text-slate-500 text-xs font-mono" dir="ltr">{row.ipAddress || '—'}</td>
                                    </tr>
                                    {isOpen && changes.length > 0 && (
                                        <tr className="bg-slate-50 border-b">
                                            <td colSpan={6} className="p-3">
                                                <div className="flex flex-wrap gap-2">
                                                    {changes.map((c, i) => (
                                                        <span key={`${row.id}-${i}`} className="text-xs bg-white border border-slate-300 rounded-lg px-2 py-1">
                                                            <b>{c.label}</b>: <span className="text-red-600">{val(c, c.from)}</span> ← <span className="text-green-700">{val(c, c.to)}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between gap-3 mt-3 text-sm flex-wrap">
                <span className="text-slate-600">مجموع: {toPersianNumerals(total)} رکورد</span>
                <div className="flex items-center gap-2">
                    <button type="button" disabled={page <= 1 || loading} onClick={() => void load(page - 1, applied)} className="px-3 py-1.5 rounded-lg bg-slate-100 disabled:opacity-40">قبلی</button>
                    <span className="text-slate-600">صفحه {toPersianNumerals(page)} از {toPersianNumerals(totalPages)}</span>
                    <button type="button" disabled={page >= totalPages || loading} onClick={() => void load(page + 1, applied)} className="px-3 py-1.5 rounded-lg bg-slate-100 disabled:opacity-40">بعدی</button>
                </div>
            </div>
        </>
    );

    return (
        <div className="bg-white p-5 rounded-xl shadow-md">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-700">ردپای کاربران و سابقه فعالیت‌ها</h1>
                <div className="flex gap-2">
                    {canViewAudit && (
                        <button type="button" onClick={() => setTab('audit')} className={`px-3 py-2 rounded-lg text-sm font-bold ${tab === 'audit' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>ردپای کاربران (سرور)</button>
                    )}
                    <button type="button" onClick={() => setTab('history')} className={`px-3 py-2 rounded-lg text-sm font-bold ${tab === 'history' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>سابقه محلی</button>
                </div>
            </div>
            {tab === 'audit' ? auditSection : historySection}
        </div>
    );
};

export default LogPage;
