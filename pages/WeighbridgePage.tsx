import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { toPersianNumerals } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import DatePicker from '../components/DatePicker';
import { toJalali } from '../shared/jalali';
import * as dataService from '../services/dataService';
import { WeighbridgeCounts, WeighbridgeRecord, WeighbridgeStats } from '../types';

/**
 * مدیریت باسکول — weighbridge ticket management.
 *
 * Tickets are imported from the factory SQL Server by the background worker and listed here with
 * date / plate / status filters. A ticket can be assigned to an ENTRY (purchase) or EXIT (sale)
 * invoice; the server then writes the net weight onto that invoice and flips the ticket to
 * «تخصیص‌یافته» in one transaction (see server/routes/weighbridge.ts).
 */

const PAGE_SIZE = 100;

/** Counters used before the first response arrives (and whenever a payload lacks them). */
const EMPTY_COUNTS: WeighbridgeCounts = { unmapped: 0, mapped: 0, archived: 0, total: 0, netted: 0, pending: 0 };

const faNumber = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return toPersianNumerals(String(value));
    return toPersianNumerals(n.toLocaleString('fa-IR'));
};

const faWeight = (value: unknown): string =>
    value === null || value === undefined || value === '' ? '-' : `${faNumber(value)} کیلوگرم`;

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/**
 * The weighbridge timestamp is the scale's LOCAL wall clock (stored as `timestamp without time
 * zone`), so it must be rendered as-is: converting it through the browser's timezone shifted both
 * the time and occasionally the Jalali day. Components are therefore formatted directly.
 */
const faDateTime = (value: string | null | undefined): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value ?? ''));
    if (!m) return '-';
    const { jy, jm, jd } = toJalali(Number(m[1]), Number(m[2]), Number(m[3]));
    return toPersianNumerals(`${jy}/${pad2(jm)}/${pad2(jd)} - ${m[4]}:${m[5]}`);
};

/** `YYYY-MM-DD` (Gregorian, for the invoice `date` column) taken from the same wall clock. */
const isoDayOf = (value: string | null | undefined): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Jalali `YYYY/MM/DD` for the ticket's wall-clock `weigh_time` (invoices store Jalali dates). */
const jalaliDayOf = (value: string | null | undefined): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (!m) return '';
    const { jy, jm, jd } = toJalali(Number(m[1]), Number(m[2]), Number(m[3]));
    return `${jy}/${pad2(jm)}/${pad2(jd)}`;
};

/** A local (Gregorian) JS Date for the ticket's wall-clock calendar day — the DatePicker's value. */
const dateObjOf = (value: string | null | undefined): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
};

/**
 * An invoice date for display. New invoices store Jalali (`1405/07/18`) and are shown as-is;
 * legacy rows still hold Gregorian ISO (`2026-09-25`) and are converted, so the column is always
 * شمسی regardless of when the remittance was created.
 */
const faInvoiceDate = (value: string | null | undefined): string => {
    const s = String(value ?? '').trim();
    if (!s) return '-';
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) return toPersianNumerals(s);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return toPersianNumerals(jalaliDayOf(s));
    return toPersianNumerals(s);
};

const STATUS_LABEL: Record<string, string> = {
    unmapped: 'تخصیص‌نیافته',
    mapped: 'تخصیص‌یافته',
    archived: 'بایگانی',
};

const STATUS_CLASS: Record<string, string> = {
    unmapped: 'bg-amber-100 text-amber-800 border-amber-200',
    mapped: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    archived: 'bg-slate-200 text-slate-600 border-slate-300',
};

/** Load direction, taken from the weighing software's own in/out flag. */
const DIRECTION_LABEL: Record<string, string> = {
    entry: 'ورود',
    exit: 'خروج',
};

/** A ticket is «two-pass» only when BOTH the loaded and empty weights are present. */
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const hasBothWeights = (r: WeighbridgeRecord): boolean => num(r.grossWeight) > 0 && num(r.tareWeight) > 0;

const isoDay = (value: Date | null): string => {
    if (!value) return '';
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
};

const WeighbridgePage: React.FC = () => {
    const { role } = useAuth();
    const { settings } = useSettings();
    const canMap = useMemo(() => ['ADMIN', 'MANAGER'].includes(String(role || '').toUpperCase()), [role]);

    const [records, setRecords] = useState<WeighbridgeRecord[]>([]);
    const [counts, setCounts] = useState<WeighbridgeCounts>(EMPTY_COUNTS);
    const [stats, setStats] = useState<WeighbridgeStats | null>(null);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const [from, setFrom] = useState<Date | null>(null);
    const [to, setTo] = useState<Date | null>(null);
    const [plate, setPlate] = useState('');
    const [status, setStatus] = useState('all');
    const [net, setNet] = useState('all');
    const [search, setSearch] = useState('');

    const [mapRecord, setMapRecord] = useState<WeighbridgeRecord | null>(null);
    const [mapType, setMapType] = useState<'entry' | 'exit'>('entry');
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<Record<string, any>>({});
    const setField = (key: string, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

    const farmers = useMemo(() => {
        try {
            return dataService.getFarmers() || [];
        } catch {
            return [];
        }
    }, []);

    /** Sensible default product for the invoice type (first raw material / first finished good). */
    const defaultProduct = useCallback(
        (type: 'entry' | 'exit') => {
            const list = settings.products || [];
            const wanted = type === 'entry' ? 'rawMaterial' : 'finishedGood';
            const match = list.find((p: any) => p.type === wanted) || list[0];
            return { id: match ? match.id : '', name: match ? match.name : '' };
        },
        [settings.products]
    );

    /** Every field pre-filled from the ticket so the operator only reviews/edits. */
    const prefillForm = useCallback(
        (record: WeighbridgeRecord, type: 'entry' | 'exit') => {
            const raw: any = (record as any).rawPayload || {};
            const goods = String((record as any).goods || raw.Goods || '').trim();
            const remittanceNo = String((record as any).remittanceNumber || raw.ShomareHavale || record.ticketNumber || '').trim();
            // Auto-match the ticket's «نوع کالا» (Goods) to a product by name (case-insensitive,
            // trimmed). On a match it is pre-selected; on no match the product is left unselected.
            let product: { id: string; name: string } = { id: '', name: '' };
            if (goods) {
                const key = goods.toLowerCase();
                const list: any[] = settings.products || [];
                const wantedType = type === 'entry' ? 'rawMaterial' : 'finishedGood';
                const match =
                    list.find((p: any) => p.type === wantedType && String(p.name || '').trim().toLowerCase() === key) ||
                    list.find((p: any) => String(p.name || '').trim().toLowerCase() === key);
                if (match) product = { id: match.id, name: match.name };
            } else {
                product = defaultProduct(type);
            }
            return {
                date: jalaliDayOf(record.weighTime),
                dateObj: dateObjOf(record.weighTime),
                productId: product.id,
                productName: product.name,
                weight: record.netWeight !== null && record.netWeight !== undefined ? String(Number(record.netWeight)) : '',
                driverName: record.driverName || '',
                driverPhone: '',
                driverIBAN: '',
                farmerId: '',
                farmerName: '',
                invoiceNumber: remittanceNo,
                billNumber: type === 'entry' ? remittanceNo : String(raw.BillOfLading || ''),
                billWeight: '',
                origin: '',
                sellerName: '',
                transportCost: '',
                productVariant: goods,
                // No automatic note: only what the operator types is stored on the invoice.
                notes: '',
            };
        },
        [defaultProduct, settings.products]
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, statsRes] = await Promise.all([
                dataService.fetchWeighbridgeRecords({ from: isoDay(from), to: isoDay(to), plate, status, net, q: search, limit: PAGE_SIZE, offset }),
                dataService.fetchWeighbridgeStats(),
            ]);
            // The /records body is FLAT: { success, data: [rows], total, counts, limit, offset } —
            // `sendRestRequest` hands back that body, so the rows live in `.data` and the counters
            // sit next to it (not nested inside `.data`).
            const body: any = list && (list as any).success ? (list as any) : null;
            const listError =
                list.success === false ? list.error?.message || 'خطا در دریافت قبوض باسکول' : 'پاسخ نامعتبر از سرور در دریافت قبوض باسکول';
            if (body && Array.isArray(body.data)) {
                const rows: WeighbridgeRecord[] = body.data;
                setRecords(rows);
                const c = body.counts && typeof body.counts === 'object' ? body.counts : null;
                if (c) {
                    setCounts({
                        unmapped: Number(c.unmapped) || 0,
                        mapped: Number(c.mapped) || 0,
                        archived: Number(c.archived) || 0,
                        netted: Number(c.netted) || 0,
                        pending: Number(c.pending) || 0,
                        total: Number(c.total) || rows.length,
                    });
                } else {
                    console.warn('[weighbridge] response carried no counters', body);
                    setCounts({ ...EMPTY_COUNTS, total: rows.length });
                }
                setTotal(typeof body.total === 'number' ? body.total : rows.length);
            } else {
                showToast(listError, 'error');
            }
            if (statsRes.success && statsRes.data) setStats(statsRes.data);
        } finally {
            setLoading(false);
        }
    }, [from, to, plate, status, net, search, offset]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Open the ticket for creating a remittance. The offered type (entry/exit) is taken from the
     * weighing software's own in/out flag (`record.direction`); only tickets with that flag decide
     * the direction automatically — otherwise the operator picks entry/exit manually.
     */
    const openMapping = (record: WeighbridgeRecord) => {
        const dir: 'entry' | 'exit' = record.direction === 'exit' || record.direction === 'entry' ? record.direction : 'entry';
        setMapRecord(record);
        setMapType(dir);
        setForm(prefillForm(record, dir));
    };

    const closeMapping = () => {
        setMapRecord(null);
    };

    /** Switching entry/exit re-seeds the pre-filled form for that remittance type. */
    const changeCandidateType = (type: 'entry' | 'exit') => {
        setMapType(type);
        if (mapRecord) setForm(prefillForm(mapRecord, type));
    };

    /** Create the invoice from the ticket (server-side, one transaction) and link them. */
    const submitCreate = async () => {
        if (!mapRecord) return;
        if (!String(form.productId || '').trim()) {
            showToast('انتخاب محصول الزامی است', 'error');
            return;
        }
        if (mapType === 'exit' && !String(form.farmerId || form.farmerName || '').trim()) {
            showToast('برای حواله خروج، انتخاب یا نوشتن نام مرغدار الزامی است', 'error');
            return;
        }
        const confirm = await Swal.fire({
            title: mapType === 'entry' ? 'ایجاد حواله ورود و اتصال قبض؟' : 'ایجاد حواله خروج و اتصال قبض؟',
            html: `<div style="text-align:right;font-size:13px;line-height:1.9">
                تاریخ: <b>${toPersianNumerals(form.date || '-')}</b><br/>
                محصول: <b>${form.productName || form.productId || '-'}</b><br/>
                ${mapType === 'exit' ? `مرغدار: <b>${form.farmerName || (farmers.find((f: any) => f.id === form.farmerId) || {}).name || '-'}</b><br/>` : ''}
                وزن ثبت‌شده: <b>${faNumber(form.weight)} کیلوگرم</b><br/>
                راننده: <b>${form.driverName || '-'}</b>
            </div>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'ایجاد و اتصال',
            cancelButtonText: 'انصراف',
            confirmButtonColor: '#059669',
            cancelButtonColor: '#64748b',
        });
        if (!confirm.isConfirmed) return;

        setSaving(true);
        try {
            const res = await dataService.createRemittanceFromWeighbridge(mapRecord.id, {
                type: mapType,
                date: String(form.date || ''),
                productId: String(form.productId || ''),
                productName: String(form.productName || '') || undefined,
                weight: String(form.weight || '') || null,
                farmerId: String(form.farmerId || '') || undefined,
                farmerName: String(form.farmerName || '') || undefined,
                driverName: String(form.driverName || '') || undefined,
                driverPhone: String(form.driverPhone || '') || undefined,
                driverIBAN: String(form.driverIBAN || '') || undefined,
                billNumber: String(form.billNumber || '') || undefined,
                billWeight: String(form.billWeight || '') || null,
                origin: String(form.origin || '') || undefined,
                sellerName: String(form.sellerName || '') || undefined,
                invoiceNumber: String(form.invoiceNumber || '') || undefined,
                transportCost: String(form.transportCost || '') || null,
                notes: String(form.notes || '') || undefined,
                productVariant: String(form.productVariant || '') || undefined,
            });
            if (res.success) {
                showToast('حواله ایجاد و قبض باسکول به آن متصل شد', 'success');
                closeMapping();
                await load();
            } else {
                showToast(res.error?.message || 'خطا در ایجاد حواله از قبض', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const unmap = async (record: WeighbridgeRecord) => {
        const confirm = await Swal.fire({
            title: 'لغو تخصیص قبض',
            html: `قبض <b>${record.externalId}</b> از حواله متصل جدا شود؟`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'لغو تخصیص',
            cancelButtonText: 'انصراف',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
        });
        if (!confirm.isConfirmed) return;
        const res = await dataService.unmapWeighbridgeRecord(record.id);
        if (res.success) {
            showToast(res.data?.weightReverted ? 'تخصیص لغو و وزن ثبت‌شده برداشته شد' : 'تخصیص لغو شد (وزن حواله دست‌نخورده ماند)', 'success');
            await load();
        } else {
            showToast(res.error?.message || 'خطا در لغو تخصیص', 'error');
        }
    };

    /** Manual entry/exit override — stored with direction_locked so the auto-sync keeps it. */
    const editDirection = async (record: WeighbridgeRecord) => {
        const isExit = record.direction === 'exit';
        const confirm = await Swal.fire({
            title: `ویرایش نوع قبض سریال ${faNumber(record.externalId)}`,
            html: `نوع فعلی: <b>${isExit ? 'خروج' : 'ورود'}</b><br/><span style="font-size:12px;color:#64748b">این مقدار ذخیره می‌شود و همگام‌سازی خودکار آن را تغییر نمی‌دهد.</span>`,
            showCancelButton: true,
            confirmButtonText: isExit ? 'تبدیل به ورود' : 'تبدیل به خروج',
            cancelButtonText: 'انصراف',
            confirmButtonColor: '#0284c7',
            cancelButtonColor: '#64748b',
            icon: 'question',
        });
        if (!confirm.isConfirmed) return;
        const next: 'entry' | 'exit' = isExit ? 'entry' : 'exit';
        const res = await dataService.setWeighbridgeDirection(record.id, next);
        if (res.success) {
            showToast(`نوع قبض ${faNumber(record.externalId)} به «${next === 'entry' ? 'ورود' : 'خروج'}» تغییر کرد`, 'success');
            await load();
        } else {
            showToast(res.error?.message || 'خطا در تغییر نوع قبض', 'error');
        }
    };

    const showDetails = async (record: WeighbridgeRecord) => {
        const res = await dataService.fetchWeighbridgeRecord(record.id);
        const r = res.success && res.data ? res.data : record;
        const inv = r.invoice;
        const row = (label: string, value: string) =>
            `<tr><td style="padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;white-space:nowrap">${label}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:13px">${value}</td></tr>`;
        const invoiceRow = inv
            ? row(
                  'حواله متصل',
                  `${inv.type === 'entry' ? 'ورود' : 'خروج'} • ${inv.date} • ${inv.productName || '-'} • ${inv.invoiceNumber || inv.id}` +
                      `<br/><span style="font-size:11px;color:#64748b">${inv.type === 'entry' ? 'فروشنده' : 'مشتری'}: ${inv.customerName || '-'} • وزن حواله: ${inv.type === 'entry' ? faWeight(inv.scaleWeight) : faWeight(inv.weight)}</span>`
              )
            : '';
        const html = `<div dir="rtl" style="text-align:right"><table style="width:100%;border-collapse:collapse">
            ${row('شماره سریال باسکول', faNumber(r.externalId))}
            ${row('شماره حواله', faNumber((r as any).remittanceNumber || '-'))}
            ${row('نوع کالا', r.goods || (r as any).rawPayload?.Goods || '-')}
            ${row('پلاک خودرو', r.plateNumber ? toPersianNumerals(r.plateNumber) : '-')}
            ${row('نام راننده', r.driverName || '-')}
            ${row('نام مشتری (باسکول)', r.customerName || (r as any).rawPayload?.CustomerName || '-')}
            ${row('وزن پر (وزن اول)', faWeight(r.grossWeight))}
            ${row('وزن خالی (وزن دوم)', faWeight(r.tareWeight))}
            ${row('وزن خالص', faWeight(r.netWeight))}
            ${row('زمان ثبت توزین', faDateTime(r.weighTime))}
            ${row('وضعیت', STATUS_LABEL[String(r.status)] || String(r.status))}
            ${row('منبع', r.source || '-')}
            ${row('آخرین همگام‌سازی', faDateTime(r.lastSyncedAt))}
            ${invoiceRow}
        </table></div>`;
        await Swal.fire({
            title: `جزئیات قبض باسکول — شماره سریال ${faNumber(record.externalId)}`,
            html,
            width: 640,
            confirmButtonText: 'بستن',
            confirmButtonColor: '#0284c7',
        });
    };

    const runSync = async () => {
        setSyncing(true);
        try {
            const res = await dataService.triggerWeighbridgeSync();
            const log = (res.success ? res.data.log || '' : (res.error?.message || '')).split('\n').filter(Boolean).slice(-14).join('\n');
            if (res.success) showToast('همگام‌سازی باسکول انجام شد', 'success');
            await Swal.fire({
                title: res.success ? 'همگام‌سازی انجام شد' : 'همگام‌سازی ناموفق',
                icon: res.success ? 'success' : 'error',
                width: 760,
                html: `<pre dir="ltr" style="text-align:left;font-size:11px;max-height:320px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px">${log || 'خروجی ورکر خالی بود'}</pre>`,
                confirmButtonText: 'بستن',
            });
            await load();
        } finally {
            setSyncing(false);
        }
    };

    const clearFilters = () => {
        setFrom(null);
        setTo(null);
        setPlate('');
        setStatus('all');
        setNet('all');
        setSearch('');
        setOffset(0);
    };

    /** Quick ranges (today / last N days) so the newest weighings are one click away. */
    const setRange = (days: number) => {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - (days - 1));
        setFrom(from);
        setTo(to);
        setOffset(0);
    };

    const countsSafe: WeighbridgeCounts = counts || EMPTY_COUNTS;
    const pageEnd = Math.min(offset + PAGE_SIZE, total);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">مدیریت باسکول</h1>
                    <p className="text-xs text-slate-500 mt-1">قبوض توزین {settings.factoryName} — اتصال به حواله ورود و خروج</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">کل: {faNumber(countsSafe.total)}</span>
                    <span className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">تخصیص‌نیافته: {faNumber(countsSafe.unmapped)}</span>
                    <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">تخصیص‌یافته: {faNumber(countsSafe.mapped)}</span>
                    <button type="button" onClick={() => { setNet('done'); setStatus('all'); setOffset(0); }} title="فیلتر قبوض خالص‌شده" className={`px-3 py-1 rounded-lg text-xs font-bold border ${net === 'done' ? 'bg-sky-600 text-white border-sky-700' : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'}`}>
                        خالص‌شده: {faNumber(countsSafe.netted)}
                    </button>
                    <button type="button" onClick={() => { setNet('pending'); setStatus('all'); setOffset(0); }} title="فیلتر قبوض در انتظار توزین دوم" className={`px-3 py-1 rounded-lg text-xs font-bold border ${net === 'pending' ? 'bg-slate-600 text-white border-slate-700' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>
                        در انتظار توزین: {faNumber(countsSafe.pending)}
                    </button>
                    <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                        {loading ? 'در حال بارگذاری…' : 'به‌روزرسانی'}
                    </button>
                    {canMap && (
                        <button type="button" onClick={() => void runSync()} disabled={syncing} className="px-3 py-2 rounded-lg text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                            {syncing ? 'در حال همگام‌سازی…' : 'همگام‌سازی الان'}
                        </button>
                    )}
                </div>
            </div>

            {stats && !stats.workerBundlePresent && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs">
                    فایل ورکر باسکول روی سرور پیدا نشد؛ همگام‌سازی خودکار غیرفعال است.
                </div>
            )}
            {stats?.lastSyncedAt && (
                <div className="text-[11px] text-slate-500 px-1">
                    آخرین همگام‌سازی: {faDateTime(stats.lastSyncedAt)}
                    {stats.newestWeighTime ? ` • جدیدترین توزین: ${faDateTime(stats.newestWeighTime)}` : ''}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">از تاریخ توزین</label>
                        <DatePicker id="wb-from" value={from} onChange={(d) => { setFrom(d); setOffset(0); }} />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">تا تاریخ توزین</label>
                        <DatePicker id="wb-to" value={to} onChange={(d) => { setTo(d); setOffset(0); }} />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">شماره پلاک</label>
                        <input type="text" value={plate} onChange={(e) => { setPlate(e.target.value); setOffset(0); }} placeholder="مثال: ۲۲ ب ۳۴۵" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">وضعیت</label>
                        <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                            <option value="all">همه</option>
                            <option value="unmapped">تخصیص‌نیافته</option>
                            <option value="mapped">تخصیص‌یافته</option>
                            <option value="archived">بایگانی</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">توزین</label>
                        <select value={net} onChange={(e) => { setNet(e.target.value); setOffset(0); }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                            <option value="all">همه</option>
                            <option value="done">خالص‌شده</option>
                            <option value="pending">در انتظار توزین دوم</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">جستجو (سریال / شماره حواله / راننده)</label>
                        <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} placeholder="جستجو…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={clearFilters} className="text-xs font-bold text-slate-500 hover:text-slate-800 underline">پاک کردن فیلترها</button>
                        <span className="text-slate-300">|</span>
                        <button type="button" onClick={() => setRange(1)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">امروز</button>
                        <button type="button" onClick={() => setRange(7)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">۷ روز اخیر</button>
                        <button type="button" onClick={() => setRange(30)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">۳۰ روز اخیر</button>
                        <button type="button" onClick={() => { setFrom(null); setTo(null); setOffset(0); }} className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">همه تاریخ</button>
                    </div>
                    <span className="text-[11px] text-slate-500">
                        {total > 0 ? `نمایش ${faNumber(offset + 1)} تا ${faNumber(pageEnd)} از ${faNumber(total)} قبض` : 'موردی یافت نشد'}
                    </span>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-100 text-slate-700">
                            <tr>
                                <th className="px-2 py-3 text-center font-bold whitespace-nowrap">ردیف</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">شماره سریال</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">شماره حواله</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">پلاک</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">راننده</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">مشتری</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">نوع کالا</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">وزن پر</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">وزن خالی</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">وزن خالص</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">زمان توزین</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">نوع</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">وضعیت</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">حواله / مغایرت</th>
                                <th className="px-3 py-3 text-center font-bold whitespace-nowrap no-print">عملیات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {records.map((r, idx) => (
                                <tr key={r.id} className="hover:bg-slate-50">
                                    <td className="px-2 py-2 text-center text-xs text-slate-500">{faNumber(offset + idx + 1)}</td>
                                    <td className="px-3 py-2 text-center font-bold text-slate-700">{faNumber(r.externalId)}</td>
                                    <td className="px-3 py-2 text-center text-xs text-slate-600">{faNumber((r as any).remittanceNumber || (r as any).rawPayload?.ShomareHavale || '-')}</td>
                                    <td className="px-3 py-2 text-center">{r.plateNumber ? toPersianNumerals(r.plateNumber) : '-'}</td>
                                    <td className="px-3 py-2 text-center">{r.driverName || '-'}</td>
                                    <td className="px-3 py-2 text-center text-xs font-bold text-slate-700">{r.customerName || (r as any).rawPayload?.CustomerName || '-'}</td>
                                    <td className="px-3 py-2 text-center text-xs text-slate-600">{r.goods || (r as any).rawPayload?.Goods || '-'}</td>
                                    <td className="px-3 py-2 text-center">{faNumber(r.grossWeight)}</td>
                                    <td className="px-3 py-2 text-center">{faNumber(r.tareWeight)}</td>
                                    <td className="px-3 py-2 text-center font-bold text-sky-700">
                                        {hasBothWeights(r) ? (
                                            faNumber(r.netWeight)
                                        ) : (
                                            <span className="text-[11px] font-bold text-amber-600">منتظر توزین دوم</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center text-xs whitespace-nowrap">{faDateTime(r.weighTime)}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className="inline-flex items-center gap-1">
                                            {r.direction ? (
                                                <span className={`inline-block px-2 py-1 rounded-lg border text-[11px] font-bold ${r.direction === 'entry' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                                                    {DIRECTION_LABEL[r.direction] || r.directionLabel || r.direction}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-[11px]">نامشخص</span>
                                            )}
                                            {canMap && String(r.status) !== 'mapped' && (
                                                <button type="button" onClick={() => void editDirection(r)} title="ویرایش نوع (ورود/خروج)" className="px-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 text-xs">
                                                    ✎
                                                </button>
                                            )}
                                        </span>
                                        {r.directionLocked ? <span className="block text-[9px] text-slate-400">دستی</span> : null}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`inline-block px-2 py-1 rounded-lg border text-[11px] font-bold ${STATUS_CLASS[String(r.status)] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                            {STATUS_LABEL[String(r.status)] || String(r.status)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-center text-[11px] text-slate-600">
                                        {r.invoice ? (
                                            <span>
                                                <span className="font-bold text-emerald-700">✓ متصل</span> • {r.invoice.type === 'entry' ? 'ورود' : 'خروج'} • {faInvoiceDate(r.invoice.date)}
                                                <br />
                                                <span className="text-slate-400">{r.invoice.productName || '-'}</span>
                                                <br />
                                                <span className="text-slate-600 font-bold">
                                                    {r.invoice.type === 'entry' ? 'فروشنده حواله' : 'مشتری حواله'}: {r.invoice.customerName || '-'}
                                                </span>
                                                <br />
                                                {r.weightDelta === null || r.weightDelta === undefined ? (
                                                    <span className="text-slate-400">وزن: {faWeight(r.invoice.type === 'entry' ? r.invoice.scaleWeight : r.invoice.weight)}</span>
                                                ) : Math.abs(r.weightDelta) < 1 ? (
                                                    <span className="font-bold text-emerald-600">هم‌خوان با باسکول</span>
                                                ) : (
                                                    <span className="font-bold text-amber-600" title="وزن حواله منهای وزن خالص باسکول">⚠ مغایرت {faNumber(r.weightDelta)} کیلو</span>
                                                )}
                                            </span>
                                        ) : r.existingInvoice ? (
                                            <span>
                                                {r.existingTypeMismatch ? (
                                                    <span className="font-bold text-amber-600" title="حوالهٔ ثبت‌شدهٔ آن شماره حواله از نوع دیگری است؛ نوع قبض را بازبینی کنید">
                                                        ⚠ حواله {r.existingInvoice.type === 'entry' ? 'ورود' : 'خروج'} ثبت شده — نوع متفاوت
                                                    </span>
                                                ) : (
                                                    <span className="font-bold text-sky-700" title={`حواله ${r.existingInvoice.invoiceNumber || r.existingInvoice.id} با همین شماره حواله قبلاً ثبت شده است`}>
                                                        ✓ حواله {r.existingInvoice.type === 'entry' ? 'ورود' : 'خروج'} ثبت شد
                                                    </span>
                                                )}
                                                <br />
                                                <span className="text-slate-400">{faInvoiceDate(r.existingInvoice.date)} • {r.existingInvoice.productName || '-'}</span>
                                                <br />
                                                <span className="text-slate-600 font-bold">
                                                    {r.existingInvoice.type === 'entry' ? 'فروشنده حواله' : 'مشتری حواله'}: {r.existingInvoice.customerName || '-'}
                                                </span>
                                                <br />
                                                {(() => {
                                                    const ex = r.existingInvoice!;
                                                    const rawW = ex.type === 'entry' ? ex.scaleWeight ?? ex.weight : ex.weight ?? ex.scaleWeight;
                                                    const exW = Number(rawW);
                                                    const net = Number(r.netWeight);
                                                    if (rawW === null || rawW === '' || !Number.isFinite(exW) || !(net > 0)) return null;
                                                    const d = Math.round((exW - net) * 1000) / 1000;
                                                    return Math.abs(d) < 1 ? (
                                                        <span className="font-bold text-emerald-600">هم‌خوان با باسکول</span>
                                                    ) : (
                                                        <span className="font-bold text-amber-600" title="وزن حواله ثبت‌شده منهای وزن خالص باسکول">⚠ مغایرت {faNumber(d)} کیلو</span>
                                                    );
                                                })()}
                                            </span>
                                        ) : (
                                            '-'
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center whitespace-nowrap no-print">
                                        <button type="button" onClick={() => void showDetails(r)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 ml-1">
                                            جزئیات
                                        </button>
                                        {canMap && String(r.status) !== 'mapped' && (
                                            <button type="button" onClick={() => void openMapping(r)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">
                                                {r.direction === 'exit' ? 'ایجاد حواله خروج' : r.direction === 'entry' ? 'ایجاد حواله ورود' : 'ایجاد حواله'}
                                            </button>
                                        )}
                                        {canMap && String(r.status) === 'mapped' && (
                                            <button type="button" onClick={() => void unmap(r)} className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200">
                                                لغو تخصیص
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {records.length === 0 && (
                                <tr>
                                    <td colSpan={15} className="px-4 py-10 text-center text-slate-400 text-sm">
                                        {loading ? 'در حال بارگذاری…' : 'قبض باسکولی با این فیلترها یافت نشد.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {total > PAGE_SIZE && (
                    <div className="flex items-center justify-between gap-2 p-3 border-t border-slate-100 no-print">
                        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                            صفحه قبل
                        </button>
                        <button type="button" disabled={pageEnd >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                            صفحه بعد
                        </button>
                    </div>
                )}
            </div>

            {mapRecord && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3" onClick={closeMapping}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between p-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">ایجاد حواله از قبض باسکول</h3>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    شماره حواله باسکول: {faNumber((mapRecord as any).remittanceNumber || (mapRecord as any).rawPayload?.ShomareHavale || '-')} •
                                    شماره سریال باسکول: {faNumber(mapRecord.externalId)} • شماره حواله: {faNumber((mapRecord as any).remittanceNumber || (mapRecord as any).rawPayload?.ShomareHavale || '-')} •
                                    {mapRecord.plateNumber ? toPersianNumerals(mapRecord.plateNumber) : '-'} • راننده{' '}
                                    {mapRecord.driverName || '-'} • وزن خالص {faWeight(mapRecord.netWeight)} • {faDateTime(mapRecord.weighTime)}
                                </p>
                            </div>
                            <button onClick={closeMapping} className="text-slate-400 hover:text-red-500 text-2xl leading-none p-2">×</button>
                        </div>

                        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
                            <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                <button type="button" onClick={() => changeCandidateType('entry')} className={`px-4 py-2 text-xs font-bold ${mapType === 'entry' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'}`}>
                                    حواله ورود (خرید)
                                </button>
                                <button type="button" onClick={() => changeCandidateType('exit')} className={`px-4 py-2 text-xs font-bold ${mapType === 'exit' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}>
                                    حواله خروج (فروش)
                                </button>
                            </div>
                            {mapRecord.direction ? (
                                <span className="text-[11px] text-slate-500">
                                    نوع بر اساس نرم‌افزار باسکول: <b className={mapRecord.direction === 'entry' ? 'text-sky-700' : 'text-orange-600'}>{DIRECTION_LABEL[mapRecord.direction]}</b>
                                </span>
                            ) : (
                                <span className="text-[11px] text-amber-600">نرم‌افزار باسکول جهت این قبض را مشخص نکرده — نوع را دستی انتخاب کنید.</span>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-4">
                            {(
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                    <div>
                                        <label className="block font-bold text-slate-600 mb-1">تاریخ حواله</label>
                                        <DatePicker
                                            id="wb-create-date"
                                            value={form.dateObj || null}
                                            onChange={(d) => {
                                                const { jy, jm, jd } = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
                                                setField('dateObj', d);
                                                setField('date', `${jy}/${pad2(jm)}/${pad2(jd)}`);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-bold text-slate-600 mb-1">محصول <span className="text-red-500">*</span></label>
                                        <select
                                            value={form.productId || ''}
                                            onChange={(e) => {
                                                const p = (settings.products || []).find((x: any) => x.id === e.target.value);
                                                setField('productId', e.target.value);
                                                setField('productName', p ? p.name : '');
                                            }}
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white"
                                        >
                                            <option value="">— انتخاب محصول —</option>
                                            {(settings.products || [])
                                                .filter((p: any) => (mapType === 'entry' ? p.type === 'rawMaterial' : p.type === 'finishedGood'))
                                                .map((p: any) => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                        </select>
                                        {String(form.productVariant || '').trim() ? (
                                            <span className="block mt-1 text-[10px] text-slate-500">
                                                کالای باسکول: {toPersianNumerals(String(form.productVariant))}
                                                {String(form.productId || '').trim() ? '' : ' — محصول متناظر پیدا نشد، دستی انتخاب کنید'}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div>
                                        <label className="block font-bold text-slate-600 mb-1">وزن {mapType === 'entry' ? 'باسکول' : 'خروج'} (کیلوگرم)</label>
                                        <input type="number" step="0.001" value={form.weight ?? ''} onChange={(e) => setField('weight', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                        <span className="text-[10px] text-slate-400">پیش‌فرض: وزن خالص همین قبض</span>
                                    </div>
                                    <div>
                                        <label className="block font-bold text-slate-600 mb-1">نام راننده</label>
                                        <input type="text" value={form.driverName || ''} onChange={(e) => setField('driverName', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                    </div>
                                    {mapType === 'exit' ? (
                                        <>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">مرغدار <span className="text-red-500">*</span></label>
                                                <select
                                                    value={form.farmerId || ''}
                                                    onChange={(e) => {
                                                        const f = farmers.find((x: any) => x.id === e.target.value);
                                                        setField('farmerId', e.target.value);
                                                        setField('farmerName', f ? f.name : '');
                                                    }}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white"
                                                >
                                                    <option value="">— انتخاب مرغدار —</option>
                                                    {farmers.map((f: any) => (
                                                        <option key={f.id} value={f.id}>{f.name}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="text"
                                                    value={form.farmerName || ''}
                                                    onChange={(e) => { setField('farmerName', e.target.value); setField('farmerId', ''); }}
                                                    placeholder="یا نام مرغدار را بنویسید"
                                                    className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">شماره حواله</label>
                                                <input type="text" value={form.invoiceNumber || ''} onChange={(e) => setField('invoiceNumber', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">شماره بارنامه</label>
                                                <input type="text" value={form.billNumber || ''} onChange={(e) => setField('billNumber', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">وزن بارنامه (کیلوگرم)</label>
                                                <input type="number" step="0.001" value={form.billWeight ?? ''} onChange={(e) => setField('billWeight', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">مبدأ</label>
                                                <input type="text" value={form.origin || ''} onChange={(e) => setField('origin', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">فروشنده</label>
                                                <input type="text" value={form.sellerName || ''} onChange={(e) => setField('sellerName', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 mb-1">کرایه حمل (ریال)</label>
                                                <input type="number" value={form.transportCost ?? ''} onChange={(e) => setField('transportCost', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                            </div>
                                        </>
                                    )}
                                    <div className="sm:col-span-2">
                                        <label className="block font-bold text-slate-600 mb-1">توضیحات</label>
                                        <textarea rows={2} value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                                    </div>
                                    <div className="sm:col-span-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
                                        با تأیید، حواله {mapType === 'entry' ? 'ورود' : 'خروج'} ایجاد می‌شود، وزن در آن ثبت می‌گردد و همین قبض باسکول
                                        «تخصیص‌یافته» می‌شود. همه‌ی مقادیر بالا قابل ویرایش هستند.
                                    </div>

                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">
                                با تأیید، حواله {mapType === 'entry' ? 'ورود (خرید)' : 'خروج (فروش)'} ایجاد می‌شود، وزن خالص قبض ({faWeight(mapRecord.netWeight)}) در آن ثبت و وضعیت قبض «تخصیص‌یافته» می‌شود.
                            </span>
                            <div className="flex gap-2">
                                <button type="button" onClick={closeMapping} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600">
                                    انصراف
                                </button>
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void submitCreate()}
                                    className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                                >
                                    {saving ? 'در حال ثبت…' : 'ایجاد حواله و اتصال'}
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}



        </div>
    );
};

export default WeighbridgePage;


