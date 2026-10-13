import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import * as dataService from '../services/dataService';
import { WeighbridgeReport as ReportData, WeighbridgeRecord, WeighbridgeReportDayGoodsRow } from '../types';
import { toPersianNumerals } from '../utils/formatters';
import { showToast } from '../utils/helpers';
import { handlePrint } from '../utils/print';
import DatePicker from './DatePicker';
import {
    DayGoodsGroup,
    ReportGrouping,
    ReportPeriod,
    bucketOf,
    groupGoodsByDay,
    isoDayOfDate,
    isoDayToJalaliText,
    isNettedTicket,
    pendingWeightOf,
    periodRange,
    sharePercent,
} from '../shared/weighbridgeReport';

/**
 * گزارش‌گیری باسکول — the reporting tab of مدیریت باسکول.
 *
 * Everything is aggregated by the SERVER (`/api/weighbridge/report`) with exactly the same filters
 * as the ticket list, so a report can never disagree with the list it came from. This component
 * picks the period, buckets the daily series into day/week/month (Persian week, Jalali month) and
 * renders/exports the result.
 */

const PRESETS: { key: ReportPeriod; label: string }[] = [
    { key: 'today', label: 'امروز' },
    { key: 'yesterday', label: 'دیروز' },
    { key: 'thisWeek', label: 'این هفته' },
    { key: 'lastWeek', label: 'هفته گذشته' },
    { key: 'last7', label: '۷ روز اخیر' },
    { key: 'thisMonth', label: 'این ماه' },
    { key: 'lastMonth', label: 'ماه گذشته' },
    { key: 'thisYear', label: 'سال جاری' },
    { key: 'custom', label: 'بازه دلخواه' },
];

const GROUPINGS: { key: ReportGrouping; label: string }[] = [
    { key: 'day', label: 'روزانه' },
    { key: 'week', label: 'هفتگی' },
    { key: 'month', label: 'ماهانه' },
];

const DIRECTION_LABEL: Record<string, string> = { entry: 'ورود', exit: 'خروج', unknown: 'نامشخص' };

const faNum = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return toPersianNumerals(Math.round(n).toLocaleString('fa-IR'));
};

const faWeight = (value: unknown): string => `${faNum(value)} کیلوگرم`;

const dateToIso = (value: Date | null): string => (value ? isoDayOfDate(value) : '');

const isoToDate = (value: string | null): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
};

interface SeriesRow {
    key: string;
    label: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    entryTickets: number;
    exitTickets: number;
}

const WeighbridgeReportTab: React.FC = () => {
    // The report opens on TODAY — «گزارش روز» is the operator's most common need.
    const [preset, setPreset] = useState<ReportPeriod>('today');
    const [grouping, setGrouping] = useState<ReportGrouping>('day');
    const [dayDate, setDayDate] = useState<Date | null>(new Date());
    const [customFrom, setCustomFrom] = useState<Date | null>(null);
    const [customTo, setCustomTo] = useState<Date | null>(null);
    const [tickets, setTickets] = useState<WeighbridgeRecord[]>([]);
    const [ticketTotal, setTicketTotal] = useState(0);

    // Filters — the same vocabulary as the ticket list (shared server-side filter builder).
    const [goods, setGoods] = useState('');
    const [direction, setDirection] = useState('all');
    const [status, setStatus] = useState('all');
    const [net, setNet] = useState('all');
    const [plate, setPlate] = useState('');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [minNet, setMinNet] = useState('');
    const [maxNet, setMaxNet] = useState('');

    const [report, setReport] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // «تفکیک روزانه × کالا» — fetched on demand from its own endpoint (/report/daily) only when the
    // operator opens the section, exports Excel or prints, so a year-long report never ships thousands
    // of rows to the browser. `dailyKey` is the filter fingerprint the rows were fetched with, so a
    // filter change can never print stale lines.
    const [dailyOpen, setDailyOpen] = useState(false);
    const [dailyRows, setDailyRows] = useState<WeighbridgeReportDayGoodsRow[]>([]);
    const [dailyKey, setDailyKey] = useState('');
    const [dailyLoading, setDailyLoading] = useState(false);

    const range = useMemo(
        () => periodRange(preset, new Date(), { from: dateToIso(customFrom), to: dateToIso(customTo) }),
        [preset, customFrom, customTo]
    );

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(timer);
    }, [search]);

    /**
     * The ONE filter object every request uses (aggregates, ریز قبوض and the daily detail), so the
     * three can never disagree. `filtersKey` is its fingerprint: the cache key of the daily detail.
     */
    const filters = useMemo(
        () => ({
            from: range.from,
            to: range.to,
            status,
            net,
            direction,
            goods,
            plate,
            q: debouncedSearch,
            minNet,
            maxNet,
        }),
        [range.from, range.to, status, net, direction, goods, plate, debouncedSearch, minNet, maxNet]
    );

    const filtersKey = JSON.stringify(filters);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // One request for the aggregates and one for the tickets themselves (ریز قبوض همان بازه),
            // both with the SAME filters so the detail always matches the totals.
            const [res, listRes] = await Promise.all([
                dataService.fetchWeighbridgeReport({ ...filters, topCustomers: 60 }),
                dataService.fetchWeighbridgeRecords({ ...filters, limit: 200 }),
            ]);
            const listBody: any = listRes;
            if (listBody && Array.isArray(listBody.data)) {
                setTickets(listBody.data);
                setTicketTotal(Number(listBody.total) || listBody.data.length);
            } else {
                setTickets([]);
                setTicketTotal(0);
            }
            if (res.success && res.data) setReport(res.data);
            else setError(res.success === false ? res.error?.message || 'خطا در تهیه گزارش' : 'پاسخ نامعتبر از سرور در تهیه گزارش');
        } catch (e: any) {
            setError(e?.message || 'خطا در تهیه گزارش');
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Fetch the «روز × کالا» detail — the ONLY place that hits /report/daily. Returns the rows it just
     * fetched (or the cache when it still matches the current filters) so the caller can print/export
     * immediately without waiting for a re-render.
     */
    const loadDaily = useCallback(
        async (force = false): Promise<WeighbridgeReportDayGoodsRow[]> => {
            if (!force && dailyKey === filtersKey && dailyRows.length) return dailyRows;
            setDailyLoading(true);
            try {
                const res = await dataService.fetchWeighbridgeDailyReport(filters);
                if (res.success && res.data) {
                    const rows = res.data.rows || [];
                    setDailyRows(rows);
                    setDailyKey(filtersKey);
                    return rows;
                }
                showToast(res.success === false ? res.error?.message || 'خطا در تهیه گزارش روزانه' : 'پاسخ نامعتبر از سرور در گزارش روزانه', 'error');
            } catch (e: any) {
                showToast(e?.message || 'خطا در تهیه گزارش روزانه', 'error');
            } finally {
                setDailyLoading(false);
            }
            return [] as WeighbridgeReportDayGoodsRow[];
        },
        [filters, filtersKey, dailyKey, dailyRows]
    );

    // Opening the section is what triggers the (potentially large) daily request.
    useEffect(() => {
        if (dailyOpen) void loadDaily();
    }, [dailyOpen, loadDaily]);

    /** The day buckets + «جمع روز» computed from exactly the lines shown/printed below them. */
    const dailyGroups = useMemo<DayGoodsGroup[]>(() => groupGoodsByDay(dailyRows), [dailyRows]);

    /**
     * The daily rows in state were fetched with THIS filter fingerprint. When the user changes a filter the
     * cached rows are stale, so the screen must not show them (the effect above re-fetches while open, and
     * print/Excel always force a re-fetch) — otherwise a half-updated table could be read as current.
     */
    const dailyFresh = dailyKey === filtersKey;

    /** The daily series re-bucketed into the Persian week / Jalali month the user asked for. */
    const series = useMemo<SeriesRow[]>(() => {
        const buckets = new Map<string, SeriesRow>();
        for (const day of report?.byDay || []) {
            const bucket = bucketOf(day.day, grouping);
            const row = buckets.get(bucket.key) || {
                key: bucket.key,
                label: bucket.label,
                tickets: 0,
                gross: 0,
                tare: 0,
                net: 0,
                entryTickets: 0,
                exitTickets: 0,
            };
            row.tickets += day.tickets;
            row.gross += day.gross;
            row.tare += day.tare;
            row.net += day.net;
            row.entryTickets += day.entryTickets;
            row.exitTickets += day.exitTickets;
            buckets.set(bucket.key, row);
        }
        return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
    }, [report?.byDay, grouping]);

    const maxGoodsNet = useMemo(() => Math.max(1, ...(report?.byGoods || []).map((g) => Math.abs(g.net))), [report?.byGoods]);
    const maxSeriesNet = useMemo(() => Math.max(1, ...series.map((s) => Math.abs(s.net))), [series]);
    const totals = report?.totals;

    const resetFilters = () => {
        setGoods('');
        setDirection('all');
        setStatus('all');
        setNet('all');
        setPlate('');
        setSearch('');
        setMinNet('');
        setMaxNet('');
    };

    /** «گزارش روز»: show exactly one day, end to end (totals + per-کالا + ریز قبوض). */
    const showDay = (date: Date | null) => {
        if (!date) return;
        setDayDate(date);
        setCustomFrom(date);
        setCustomTo(date);
        setPreset('custom');
    };

    /** «جمع کل» of the daily detail, summed from the very lines that are printed. */
    const dailyGrand = useMemo(
        () =>
            dailyGroups.reduce(
                (acc, day) => ({
                    tickets: acc.tickets + day.tickets,
                    gross: acc.gross + day.gross,
                    tare: acc.tare + day.tare,
                    net: acc.net + day.net,
                    netted: acc.netted + day.netted,
                    pending: acc.pending + day.pending,
                    pendingWeight: acc.pendingWeight + day.pendingWeight,
                }),
                { tickets: 0, gross: 0, tare: 0, net: 0, netted: 0, pending: 0, pendingWeight: 0 }
            ),
        [dailyGroups]
    );

    /**
     * «چاپ گزارش روزانه» — always prints the CURRENT filters: the rows are re-fetched whenever the
     * cache was built with different filters, so a sheet on paper can never belong to an older range.
     */
    const printDaily = async () => {
        const rows = dailyKey === filtersKey && dailyRows.length ? dailyRows : await loadDaily(true);
        if (!rows.length) {
            showToast('برای این بازه و فیلترها داده‌ای برای چاپ نیست', 'error');
            return;
        }
        handlePrint('weighbridge', rows, {
            startDate: isoToDate(range.from) || undefined,
            endDate: isoToDate(range.to) || undefined,
            customPrintTitle: 'گزارش روزانهٔ باسکول',
        });
    };

    /**
     * A full workbook: one sheet per table with Persian headers, so the report can be handed to the
     * factory accountant as-is.
     */
    const exportExcel = async () => {
        if (!report) return;
        try {
            const wb = XLSX.utils.book_new();

            // The «روز × کالا» detail lives on its own endpoint (so a year-long report stays light).
            // Fetching it here is what lets one workbook carry both the totals and the printable
            // day-by-day breakdown, complete with a «جمع روز» row after each day's lines.
            const dailySource = dailyKey === filtersKey && dailyRows.length ? dailyRows : await loadDaily(true);
            const dayGroups = groupGoodsByDay(dailySource);

            const summary: any[][] = [
                ['گزارش باسکول'],
                ['از تاریخ', isoDayToJalaliText(range.from), 'تا تاریخ', isoDayToJalaliText(range.to)],
                ['گروه‌بندی', GROUPINGS.find((g) => g.key === grouping)?.label || ''],
                [],
                ['شاخص', 'مقدار'],
                ['تعداد قبض (کل)', totals?.tickets || 0],
                ['جمع وزن پر — خالص‌شده‌ها (کیلوگرم)', Math.round(totals?.gross || 0)],
                ['جمع وزن تار — خالص‌شده‌ها (کیلوگرم)', Math.round(totals?.tare || 0)],
                ['جمع وزن خالص — خالص‌شده‌ها (کیلوگرم)', Math.round(totals?.net || 0)],
                ['میانگین وزن خالص (کیلوگرم)', Math.round(totals?.avgNet || 0)],
                ['بیشترین وزن خالص (کیلوگرم)', Math.round(totals?.maxNet || 0)],
                ['کمترین وزن خالص (کیلوگرم)', Math.round(totals?.minNet || 0)],
                ['قبض‌های خالص‌شده', totals?.netted || 0],
                ['در انتظار توزین دوم', totals?.pending || 0],
                ['تارِ در انتظار توزین (کیلوگرم)', Math.round(totals?.pendingTare || 0)],
                ['پرِ در انتظار توزین (کیلوگرم)', Math.round(totals?.pendingGross || 0)],
                ['وزن در انتظار توزین دوم (کیلوگرم)', Math.round(pendingWeightOf(totals?.pendingTare, totals?.pendingGross))],
                ['تخصیص‌یافته', totals?.mapped || 0],
                ['تخصیص‌نیافته', totals?.unmapped || 0],
                ['بایگانی', totals?.archived || 0],
                ['قبض ورودی', totals?.entryTickets || 0],
                ['قبض خروجی', totals?.exitTickets || 0],
                ['تعداد پلاک', totals?.plates || 0],
                ['تعداد مشتری', totals?.customers || 0],
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'جمع کل');

            const goodsSheet: any[][] = [
                ['کالا', 'تعداد قبض', 'وزن پر', 'وزن تار', 'وزن خالص', 'میانگین خالص', 'بیشترین', 'کمترین', 'سهم ٪', 'تخصیص‌یافته', 'تخصیص‌نیافته', 'در انتظار', 'اولین روز', 'آخرین روز'],
                ...(report.byGoods || []).map((g) => [
                    g.goods,
                    g.tickets,
                    Math.round(g.gross),
                    Math.round(g.tare),
                    Math.round(g.net),
                    Math.round(g.avgNet),
                    Math.round(g.maxNet),
                    Math.round(g.minNet),
                    sharePercent(g.net, totals?.net || 0),
                    g.mapped,
                    g.unmapped,
                    g.pending,
                    g.firstDay ? isoDayToJalaliText(g.firstDay) : '',
                    g.lastDay ? isoDayToJalaliText(g.lastDay) : '',
                ]),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(goodsSheet), 'جزئیات کالا');

            const seriesSheet: any[][] = [
                [GROUPINGS.find((g) => g.key === grouping)?.label || 'دوره', 'تعداد قبض', 'وزن پر', 'وزن تار', 'وزن خالص', 'ورودی', 'خروجی'],
                ...series.map((s) => [s.label, s.tickets, Math.round(s.gross), Math.round(s.tare), Math.round(s.net), s.entryTickets, s.exitTickets]),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seriesSheet), 'روند زمانی');

            const dailySheet: any[][] = [
                ['روز (شمسی)', 'روز', 'کالا', 'تعداد قبض', 'وزن پر', 'وزن تار', 'وزن خالص', 'خالص‌شده', 'در انتظار', 'وزن در انتظار', 'ورودی', 'خروجی'],
                ...dayGroups.flatMap((day) => [
                    ...day.goods.map((line) => [
                        day.label,
                        day.day,
                        line.goods,
                        line.tickets,
                        Math.round(line.gross),
                        Math.round(line.tare),
                        Math.round(line.net),
                        line.netted,
                        line.pending,
                        Math.round(pendingWeightOf(line.pendingTare, line.pendingGross)),
                        line.entryTickets,
                        line.exitTickets,
                    ]),
                    [
                        `جمع روز ${day.label}`,
                        day.day,
                        'همه کالاها',
                        day.tickets,
                        Math.round(day.gross),
                        Math.round(day.tare),
                        Math.round(day.net),
                        day.netted,
                        day.pending,
                        Math.round(day.pendingWeight),
                        day.entryTickets,
                        day.exitTickets,
                    ],
                ]),
                [
                    'جمع کل',
                    `${range.from} تا ${range.to}`,
                    '',
                    dayGroups.reduce((sum, day) => sum + day.tickets, 0),
                    Math.round(dayGroups.reduce((sum, day) => sum + day.gross, 0)),
                    Math.round(dayGroups.reduce((sum, day) => sum + day.tare, 0)),
                    Math.round(dayGroups.reduce((sum, day) => sum + day.net, 0)),
                    dayGroups.reduce((sum, day) => sum + day.netted, 0),
                    dayGroups.reduce((sum, day) => sum + day.pending, 0),
                    Math.round(dayGroups.reduce((sum, day) => sum + day.pendingWeight, 0)),
                    '',
                    '',
                ],
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailySheet), 'روز و کالا');

            const directionSheet: any[][] = [
                ['جهت', 'تعداد قبض', 'وزن پر', 'وزن تار', 'وزن خالص'],
                ...(report.byDirection || []).map((d) => [
                    DIRECTION_LABEL[d.direction] || d.direction,
                    d.tickets,
                    Math.round(d.gross),
                    Math.round(d.tare),
                    Math.round(d.net),
                ]),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(directionSheet), 'ورود و خروج');

            const customerSheet: any[][] = [
                ['نام مشتری', 'تعداد قبض', 'وزن پر', 'وزن تار', 'وزن خالص', 'آخرین روز'],
                ...(report.byCustomer || []).map((c) => [
                    c.customer,
                    c.tickets,
                    Math.round(c.gross),
                    Math.round(c.tare),
                    Math.round(c.net),
                    c.lastDay ? isoDayToJalaliText(c.lastDay) : '',
                ]),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(customerSheet), 'مشتریان');

            const plateSheet: any[][] = [
                ['پلاک', 'تعداد قبض', 'وزن خالص'],
                ...(report.byPlate || []).map((p) => [p.plate, p.tickets, Math.round(p.net)]),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plateSheet), 'پلاک‌ها');

            const ticketSheet: any[][] = [
                ['تاریخ', 'ساعت', 'سریال', 'پلاک', 'کالا', 'جهت', 'مشتری', 'راننده', 'وزن پر', 'وزن تار', 'وزن خالص', 'شماره حواله', 'وضعیت توزین'],
                ...tickets.map((t: any) => {
                    const tday = String(t.weighTime ?? '').slice(0, 10);
                    const tclock = /(\d{2}):(\d{2})/.exec(String(t.weighTime ?? ''));
                    const tnet = Number(t.netWeight) || 0;
                    // Same rule as the screen: a stale net on a first-weighing ticket is not a net.
                    const tnetted = isNettedTicket(t.grossWeight, t.tareWeight, t.netWeight);
                    return [
                        tday ? isoDayToJalaliText(tday) : '',
                        tclock ? tclock[1] + ':' + tclock[2] : '',
                        t.externalId ?? '',
                        t.plateNumber ?? '',
                        t.goods ?? '',
                        DIRECTION_LABEL[String(t.direction || 'unknown')] || '',
                        t.customerName ?? '',
                        t.driverName ?? '',
                        Math.round(Number(t.grossWeight) || 0),
                        Math.round(Number(t.tareWeight) || 0),
                        tnet > 0 && tnetted ? Math.round(tnet) : '',
                        t.remittanceNumber ?? '',
                        tnetted ? 'خالص‌شده' : 'در انتظار توزین دوم',
                    ];
                }),
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ticketSheet), 'ریز قبوض');

            XLSX.writeFile(wb, `weighbridge-report-${range.from}_${range.to}.xlsx`);
            showToast('فایل اکسل گزارش ساخته شد', 'success');
        } catch (e: any) {
            showToast(e?.message || 'خطا در ساخت فایل اکسل', 'error');
        }
    };

    return (
        <div className="space-y-4">
            {/* ------------------------------------------------------- گزارش روز */}
            <div className="bg-white p-4 rounded-xl shadow-md border-r-4 border-sky-500">
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">گزارش روز — تاریخ را انتخاب کنید</label>
                        <DatePicker id="wb-report-day" value={dayDate} onChange={showDay} className="w-44" />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => showDay(new Date())}
                            className={`px-3 py-2 rounded-lg text-xs font-bold border ${preset === 'custom' && dayDate && isoDayOfDate(dayDate) === isoDayOfDate(new Date()) ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                        >
                            امروز
                        </button>
                        <button
                            type="button"
                            onClick={() => showDay(new Date(Date.now() - 86400000))}
                            className="px-3 py-2 rounded-lg text-xs font-bold border bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        >
                            دیروز
                        </button>
                    </div>
                    <div className="text-[11px] text-slate-500 leading-5">
                        خلاصه‌ی کامل همین یک روز: جمع‌ها، جزئیات هر کالا و <b>ریز قبوض</b>.
                        <br />
                        برای بازه‌های بزرگ‌تر (هفته، ماه، …) از دکمه‌های زیر استفاده کنید.
                    </div>
                </div>
            </div>

            {/* ---------------------------------------------------- period toolbar */}
            <div className="bg-white p-4 rounded-xl shadow-md">
                <div className="flex flex-wrap items-center gap-2">
                    {PRESETS.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => setPreset(p.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                preset === p.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {preset === 'custom' && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">از تاریخ</label>
                            <DatePicker id="wb-report-from" value={customFrom} onChange={setCustomFrom} className="w-40" />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">تا تاریخ</label>
                            <DatePicker id="wb-report-to" value={customTo} onChange={setCustomTo} className="w-40" />
                        </div>
                    </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-600">گروه‌بندی:</span>
                        <div className="flex rounded-lg overflow-hidden border border-slate-300">
                            {GROUPINGS.map((g) => (
                                <button
                                    key={g.key}
                                    type="button"
                                    onClick={() => setGrouping(g.key)}
                                    className={`px-3 py-1.5 text-xs font-bold ${grouping === g.key ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                >
                                    {g.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-slate-500">
                            از <b>{isoDayToJalaliText(range.from)}</b> تا <b>{isoDayToJalaliText(range.to)}</b>
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void load()}
                            disabled={loading}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                        >
                            {loading ? 'در حال محاسبه…' : 'به‌روزرسانی'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void exportExcel()}
                            disabled={!report || loading}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                            خروجی اکسل
                        </button>
                        <button
                            type="button"
                            onClick={() => void printDaily()}
                            disabled={dailyLoading}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                        >
                            {dailyLoading ? 'در حال آماده‌سازی…' : 'چاپ روز × کالا'}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>
                )}
            </div>

            {/* ---------------------------------------------------------- filters */}
            <div className="bg-white p-4 rounded-xl shadow-md">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">کالا</label>
                        <input
                            type="text"
                            value={goods}
                            onChange={(e) => setGoods(e.target.value)}
                            placeholder="مثلاً ذرت"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">جهت</label>
                        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white">
                            <option value="all">همه</option>
                            <option value="entry">ورود</option>
                            <option value="exit">خروج</option>
                            <option value="unknown">نامشخص</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">وضعیت تخصیص</label>
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white">
                            <option value="all">همه</option>
                            <option value="unmapped">تخصیص‌نیافته</option>
                            <option value="mapped">تخصیص‌یافته</option>
                            <option value="archived">بایگانی</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">وضعیت توزین</label>
                        <select value={net} onChange={(e) => setNet(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white">
                            <option value="all">همه</option>
                            <option value="done">خالص‌شده</option>
                            <option value="pending">در انتظار توزین دوم</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">حداقل وزن خالص (کیلوگرم)</label>
                        <input
                            type="number"
                            value={minNet}
                            onChange={(e) => setMinNet(e.target.value)}
                            placeholder="مثلاً 20000"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">حداکثر وزن خالص (کیلوگرم)</label>
                        <input
                            type="number"
                            value={maxNet}
                            onChange={(e) => setMaxNet(e.target.value)}
                            placeholder="مثلاً 30000"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">پلاک</label>
                        <input
                            type="text"
                            value={plate}
                            onChange={(e) => setPlate(e.target.value)}
                            placeholder="مثلاً ۱۱ ایران ۲۲"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">جستجو (شامل وزن)</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="حواله، راننده، مشتری، ۲۵۰۰۰…"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                            />
                            <button
                                type="button"
                                onClick={resetFilters}
                                className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 whitespace-nowrap hover:bg-slate-50"
                            >
                                پاک کردن
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ------------------------------------------------------ grand totals */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                    { label: 'تعداد قبض (کل)', value: faNum(totals?.tickets) },
                    { label: 'جمع وزن خالص (خالص‌شده‌ها)', value: faWeight(totals?.net), tone: 'emerald' },
                    { label: 'جمع وزن پر (خالص‌شده‌ها)', value: faWeight(totals?.gross) },
                    { label: 'جمع وزن تار (خالص‌شده‌ها)', value: faWeight(totals?.tare) },
                    { label: 'میانگین وزن خالص', value: faWeight(totals?.avgNet) },
                    { label: 'بیشترین وزن خالص', value: faWeight(totals?.maxNet) },
                    { label: 'کمترین وزن خالص', value: faWeight(totals?.minNet) },
                    { label: 'قبض‌های خالص‌شده', value: faNum(totals?.netted), tone: 'emerald' },
                    { label: 'در انتظار توزین دوم', value: faNum(totals?.pending), tone: 'amber' },
                    { label: 'وزن در انتظار توزین دوم', value: faWeight(pendingWeightOf(totals?.pendingTare, totals?.pendingGross)), tone: 'amber' },
                    { label: 'قبض ورودی / خروجی', value: `${faNum(totals?.entryTickets)} / ${faNum(totals?.exitTickets)}` },
                    { label: 'تعداد پلاک / مشتری', value: `${faNum(totals?.plates)} / ${faNum(totals?.customers)}` },
                ].map((card) => (
                    <div key={card.label} className="bg-white rounded-xl shadow-sm border border-slate-100 p-3">
                        <div className="text-[10px] text-slate-500 font-bold">{card.label}</div>
                        <div className={`text-sm font-bold mt-1 ${card.tone === 'emerald' ? 'text-emerald-700' : card.tone === 'amber' ? 'text-amber-700' : 'text-slate-800'}`}>
                            {loading && !totals ? '…' : card.value}
                        </div>
                    </div>
                ))}
            </div>

            <div className="text-[11px] text-slate-500 bg-white rounded-xl shadow-sm border border-slate-100 p-3">
                قبوضی که <b>فقط یک بار توزین</b> شده‌اند («در انتظار توزین دوم») وزن خالص ندارند؛ پس در جمع وزن خالص/پر/تار
                حساب نمی‌شوند و وزن خودروی آن‌ها جداگانه در کارت «وزن در انتظار توزین دوم» نشان داده می‌شود. (در توزین اول
                فقط یکی از دو ستون وزن پر یا وزن تار ثبت می‌شود و ستون دیگر صفر می‌ماند.)
            </div>

            {/* -------------------------------------------------- per-کالا detail */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700">جزئیات هر کالا</h3>
                    <span className="text-[11px] text-slate-500">
                        {(report?.byGoods || []).length} کالا • مرتب بر اساس وزن خالص
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                            <tr>
                                <th className="p-2 text-right">کالا</th>
                                <th className="p-2 text-center">تعداد</th>
                                <th className="p-2 text-center">وزن خالص</th>
                                <th className="p-2 text-right min-w-[130px]">سهم</th>
                                <th className="p-2 text-center">میانگین</th>
                                <th className="p-2 text-center">بیشترین</th>
                                <th className="p-2 text-center">کمترین</th>
                                <th className="p-2 text-center">وزن پر</th>
                                <th className="p-2 text-center">وزن تار</th>
                                <th className="p-2 text-center">تخصیص‌یافته</th>
                                <th className="p-2 text-center">تخصیص‌نیافته</th>
                                <th className="p-2 text-center">در انتظار</th>
                                <th className="p-2 text-center">بازه</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(report?.byGoods || []).map((row) => {
                                const share = sharePercent(row.net, totals?.net || 0);
                                return (
                                    <tr key={row.goods} className="hover:bg-sky-50">
                                        <td className="p-2 font-bold text-slate-700">{row.goods}</td>
                                        <td className="p-2 text-center">{faNum(row.tickets)}</td>
                                        <td className="p-2 text-center font-bold text-slate-800">{faNum(row.net)}</td>
                                        <td className="p-2">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (Math.abs(row.net) / maxGoodsNet) * 100)}%` }} />
                                                </div>
                                                <span className="text-[10px] text-slate-500 w-12 text-left">{toPersianNumerals(String(share))}٪</span>
                                            </div>
                                        </td>
                                        <td className="p-2 text-center">{faNum(row.avgNet)}</td>
                                        <td className="p-2 text-center text-emerald-700">{faNum(row.maxNet)}</td>
                                        <td className="p-2 text-center text-red-600">{faNum(row.minNet)}</td>
                                        <td className="p-2 text-center text-slate-500">{faNum(row.gross)}</td>
                                        <td className="p-2 text-center text-slate-500">{faNum(row.tare)}</td>
                                        <td className="p-2 text-center text-emerald-700">{faNum(row.mapped)}</td>
                                        <td className="p-2 text-center text-amber-700">{faNum(row.unmapped)}</td>
                                        <td className="p-2 text-center text-slate-500">{faNum(row.pending)}</td>
                                        <td className="p-2 text-center text-[10px] text-slate-500 whitespace-nowrap">
                                            {row.firstDay && row.lastDay
                                                ? row.firstDay === row.lastDay
                                                    ? isoDayToJalaliText(row.firstDay)
                                                    : `${isoDayToJalaliText(row.firstDay)} تا ${isoDayToJalaliText(row.lastDay)}`
                                                : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                            {(report?.byGoods || []).length === 0 && (
                                <tr>
                                    <td colSpan={13} className="p-6 text-center text-slate-400">
                                        {loading ? 'در حال محاسبه…' : 'در این بازه با این فیلترها قبضی ثبت نشده است.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ---------------------------------------------------- time series */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700">
                        روند زمانی — {GROUPINGS.find((g) => g.key === grouping)?.label}
                    </h3>
                    <span className="text-[11px] text-slate-500">{series.length} دوره</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                            <tr>
                                <th className="p-2 text-right">دوره</th>
                                <th className="p-2 text-center">تعداد</th>
                                <th className="p-2 text-center">وزن خالص</th>
                                <th className="p-2 text-right min-w-[140px]">نمودار</th>
                                <th className="p-2 text-center">وزن پر</th>
                                <th className="p-2 text-center">وزن تار</th>
                                <th className="p-2 text-center">ورودی</th>
                                <th className="p-2 text-center">خروجی</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {series.map((row) => (
                                <tr key={row.key} className="hover:bg-sky-50">
                                    <td className="p-2 font-bold text-slate-700 whitespace-nowrap">{row.label}</td>
                                    <td className="p-2 text-center">{faNum(row.tickets)}</td>
                                    <td className="p-2 text-center font-bold text-slate-800">{faNum(row.net)}</td>
                                    <td className="p-2">
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (Math.abs(row.net) / maxSeriesNet) * 100)}%` }} />
                                        </div>
                                    </td>
                                    <td className="p-2 text-center text-slate-500">{faNum(row.gross)}</td>
                                    <td className="p-2 text-center text-slate-500">{faNum(row.tare)}</td>
                                    <td className="p-2 text-center text-sky-700">{faNum(row.entryTickets)}</td>
                                    <td className="p-2 text-center text-orange-600">{faNum(row.exitTickets)}</td>
                                </tr>
                            ))}
                            {series.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-6 text-center text-slate-400">
                                        {loading ? 'در حال محاسبه…' : 'داده‌ای برای نمایش نیست.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ------------------------------------------- تفکیک روزانه × کالا (چاپی) */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-bold text-slate-700">تفکیک روزانه به تفکیک کالا</h3>
                        <span className="text-[11px] text-slate-500">
                            هر روز، هر کالا یک خط + «جمع روز» — همان چیزی که چاپ می‌شود
                            {dailyLoading ? ' • در حال به‌روزرسانی…' : ''}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setDailyOpen((open) => !open)}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
                        >
                            {dailyOpen ? 'بستن تفکیک' : 'نمایش تفکیک روزانه'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void printDaily()}
                            disabled={dailyLoading}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                            چاپ گزارش روزانه
                        </button>
                    </div>
                </div>

                {dailyOpen && (
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-600 sticky top-0">
                                <tr>
                                    <th className="p-2 text-right">روز / کالا</th>
                                    <th className="p-2 text-center">تعداد قبض</th>
                                    <th className="p-2 text-center">وزن پر</th>
                                    <th className="p-2 text-center">وزن تار</th>
                                    <th className="p-2 text-center">وزن خالص</th>
                                    <th className="p-2 text-center">خالص‌شده</th>
                                    <th className="p-2 text-center">در انتظار</th>
                                    <th className="p-2 text-center">وزن در انتظار</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {!dailyFresh && (
                                    <tr>
                                        <td colSpan={8} className="p-6 text-center text-slate-400">
                                            {dailyLoading
                                                ? 'فیلترها تغییر کرده — در حال تهیهٔ گزارش روزانه…'
                                                : 'برای دیدن تفکیک روزانهٔ این فیلترها، دکمه «نمایش تفکیک روزانه» را بزنید.'}
                                        </td>
                                    </tr>
                                )}
                                {dailyFresh && dailyGroups.map((day) => (
                                    <React.Fragment key={day.day || 'unknown'}>
                                        <tr className="bg-sky-50">
                                            <td className="p-2 font-bold text-sky-900" colSpan={8}>
                                                روز {day.label}
                                                {day.day ? ` (${day.day})` : ''}
                                            </td>
                                        </tr>
                                        {day.goods.map((line) => (
                                            <tr key={`${day.day}-${line.goods}`} className="hover:bg-sky-50">
                                                <td className="p-2 pr-6 text-slate-700">{line.goods}</td>
                                                <td className="p-2 text-center">{faNum(line.tickets)}</td>
                                                <td className="p-2 text-center text-slate-500">{faNum(line.gross)}</td>
                                                <td className="p-2 text-center text-slate-500">{faNum(line.tare)}</td>
                                                <td className="p-2 text-center font-bold text-slate-800">{faNum(line.net)}</td>
                                                <td className="p-2 text-center text-emerald-700">{faNum(line.netted)}</td>
                                                <td className="p-2 text-center text-amber-700">{faNum(line.pending)}</td>
                                                <td className="p-2 text-center text-amber-700">{faNum(pendingWeightOf(line.pendingTare, line.pendingGross))}</td>
                                            </tr>
                                        ))}
                                        <tr className="bg-slate-100 font-bold">
                                            <td className="p-2">جمع روز {day.label}</td>
                                            <td className="p-2 text-center">{faNum(day.tickets)}</td>
                                            <td className="p-2 text-center">{faNum(day.gross)}</td>
                                            <td className="p-2 text-center">{faNum(day.tare)}</td>
                                            <td className="p-2 text-center text-slate-900">{faNum(day.net)}</td>
                                            <td className="p-2 text-center text-emerald-700">{faNum(day.netted)}</td>
                                            <td className="p-2 text-center text-amber-700">{faNum(day.pending)}</td>
                                            <td className="p-2 text-center text-amber-700">{faNum(day.pendingWeight)}</td>
                                        </tr>
                                    </React.Fragment>
                                ))}
                                {dailyFresh && dailyGroups.length > 1 && (
                                    <tr className="bg-slate-200 font-bold">
                                        <td className="p-2">جمع کل {isoDayToJalaliText(range.from)} تا {isoDayToJalaliText(range.to)}</td>
                                        <td className="p-2 text-center">{faNum(dailyGrand.tickets)}</td>
                                        <td className="p-2 text-center">{faNum(dailyGrand.gross)}</td>
                                        <td className="p-2 text-center">{faNum(dailyGrand.tare)}</td>
                                        <td className="p-2 text-center text-slate-900">{faNum(dailyGrand.net)}</td>
                                        <td className="p-2 text-center text-emerald-700">{faNum(dailyGrand.netted)}</td>
                                        <td className="p-2 text-center text-amber-700">{faNum(dailyGrand.pending)}</td>
                                        <td className="p-2 text-center text-amber-700">{faNum(dailyGrand.pendingWeight)}</td>
                                    </tr>
                                )}
                                {dailyFresh && dailyGroups.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-6 text-center text-slate-400">
                                            {dailyLoading ? 'در حال محاسبه…' : 'در این بازه با این فیلترها قبضی ثبت نشده است.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">
                            «وزن خالص» فقط برای قبوض خالص‌شده (هر دو توزین) است؛ قبوض در انتظار توزین دوم در ستون‌های «در انتظار» و
                            «وزن در انتظار» می‌آیند و در «جمع روز» وزن خالص لحاظ نمی‌شوند. دکمه «چاپ» همین جدول را با همین فیلترها
                            روی کاغذ A4 چاپ می‌کند.
                        </div>
                    </div>
                )}
            </div>

            {/* ------------------------------- entry/exit · customers · plates */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <h3 className="text-sm font-bold text-slate-700">تفکیک ورود و خروج</h3>
                    </div>
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                            <tr>
                                <th className="p-2 text-right">جهت</th>
                                <th className="p-2 text-center">تعداد</th>
                                <th className="p-2 text-center">وزن خالص</th>
                                <th className="p-2 text-center">سهم</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(report?.byDirection || []).map((row) => (
                                <tr key={row.direction}>
                                    <td className="p-2 font-bold text-slate-700">{DIRECTION_LABEL[row.direction] || row.direction}</td>
                                    <td className="p-2 text-center">{faNum(row.tickets)}</td>
                                    <td className="p-2 text-center font-bold text-slate-800">{faNum(row.net)}</td>
                                    <td className="p-2 text-center text-slate-500">{toPersianNumerals(String(sharePercent(row.tickets, totals?.tickets || 0)))}٪</td>
                                </tr>
                            ))}
                            {(report?.byDirection || []).length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-4 text-center text-slate-400">—</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-700">برترین مشتریان</h3>
                        <span className="text-[11px] text-slate-500">{(report?.byCustomer || []).length} مورد</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-600 sticky top-0">
                                <tr>
                                    <th className="p-2 text-right">نام مشتری</th>
                                    <th className="p-2 text-center">تعداد</th>
                                    <th className="p-2 text-center">وزن خالص</th>
                                    <th className="p-2 text-center">آخرین</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {(report?.byCustomer || []).map((row) => (
                                    <tr key={row.customer} className="hover:bg-sky-50">
                                        <td className="p-2 font-bold text-slate-700">{row.customer}</td>
                                        <td className="p-2 text-center">{faNum(row.tickets)}</td>
                                        <td className="p-2 text-center text-slate-800">{faNum(row.net)}</td>
                                        <td className="p-2 text-center text-[10px] text-slate-500 whitespace-nowrap">
                                            {row.lastDay ? isoDayToJalaliText(row.lastDay) : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {(report?.byCustomer || []).length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="p-4 text-center text-slate-400">—</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-700">پرترددترین پلاک‌ها</h3>
                        <span className="text-[11px] text-slate-500">{(report?.byPlate || []).length} مورد</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-600 sticky top-0">
                                <tr>
                                    <th className="p-2 text-right">پلاک</th>
                                    <th className="p-2 text-center">تعداد</th>
                                    <th className="p-2 text-center">وزن خالص</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {(report?.byPlate || []).map((row) => (
                                    <tr key={row.plate} className="hover:bg-sky-50">
                                        <td className="p-2 font-bold text-slate-700">{toPersianNumerals(row.plate)}</td>
                                        <td className="p-2 text-center">{faNum(row.tickets)}</td>
                                        <td className="p-2 text-center text-slate-800">{faNum(row.net)}</td>
                                    </tr>
                                ))}
                                {(report?.byPlate || []).length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="p-4 text-center text-slate-400">—</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ---------------------------------------------------------- ریز قبوض */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700">ریز قبوض این بازه</h3>
                    <span className="text-[11px] text-slate-500">
                        {faNum(ticketTotal)} قبض
                        {ticketTotal > tickets.length ? ` — نمایش ${faNum(tickets.length)} مورد` : ''}
                    </span>
                </div>
                <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0">
                            <tr>
                                <th className="p-2 text-right">تاریخ / ساعت</th>
                                <th className="p-2 text-center">سریال</th>
                                <th className="p-2 text-center">پلاک</th>
                                <th className="p-2 text-right">کالا</th>
                                <th className="p-2 text-center">جهت</th>
                                <th className="p-2 text-right">مشتری</th>
                                <th className="p-2 text-center">وزن پر</th>
                                <th className="p-2 text-center">وزن تار</th>
                                <th className="p-2 text-center">وزن خالص</th>
                                <th className="p-2 text-center">وضعیت</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {tickets.map((ticket) => {
                                const day = String(ticket.weighTime ?? '').slice(0, 10);
                                const clock = /(\d{2}):(\d{2})/.exec(String(ticket.weighTime ?? ''));
                                const net = Number(ticket.netWeight) || 0;
                                // Only a ticket with BOTH weighings has a net; a first-weighing row may still
                                // carry a stale net == gross in the DB, and must not be labelled «خالص‌شده».
                                const netted = isNettedTicket(ticket.grossWeight, ticket.tareWeight, ticket.netWeight);
                                return (
                                    <tr key={ticket.id} className="hover:bg-sky-50">
                                        <td className="p-2 text-slate-600 whitespace-nowrap">
                                            {day ? isoDayToJalaliText(day) : '-'}
                                            {clock ? ` ${toPersianNumerals(clock[1] + ':' + clock[2])}` : ''}
                                        </td>
                                        <td className="p-2 text-center text-slate-500">{toPersianNumerals(String(ticket.externalId ?? ''))}</td>
                                        <td className="p-2 text-center">{ticket.plateNumber ? toPersianNumerals(ticket.plateNumber) : '-'}</td>
                                        <td className="p-2 text-slate-700">{ticket.goods || '-'}</td>
                                        <td className="p-2 text-center">
                                            <span className={ticket.direction === 'entry' ? 'text-sky-700 font-bold' : ticket.direction === 'exit' ? 'text-orange-600 font-bold' : 'text-slate-400'}>
                                                {DIRECTION_LABEL[String(ticket.direction || 'unknown')]}
                                            </span>
                                        </td>
                                        <td className="p-2 text-slate-600">{ticket.customerName || '-'}</td>
                                        <td className="p-2 text-center text-slate-500">{faNum(ticket.grossWeight)}</td>
                                        <td className="p-2 text-center text-slate-500">{faNum(ticket.tareWeight)}</td>
                                        <td className={`p-2 text-center font-bold ${netted ? 'text-emerald-700' : 'text-slate-400'}`}>
                                            {netted ? faNum(net) : '—'}
                                        </td>
                                        <td className="p-2 text-center">
                                            {netted
                                                ? <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">خالص‌شده</span>
                                                : <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">در انتظار توزین دوم</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                            {tickets.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="p-6 text-center text-slate-400">
                                        {loading ? 'در حال بارگذاری…' : 'در این بازه با این فیلترها قبضی ثبت نشده است.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-white rounded-xl shadow-sm border border-slate-100 p-3">
                جمع‌ها فقط روی قبوض موجود در بازه و فیلترهای انتخاب‌شده محاسبه می‌شوند؛ «وزن خالص» فقط برای قبوض
                <b> خالص‌شده</b> (یعنی قبوضی که هر دو توزین آن‌ها ثبت شده) است و قبوض «در انتظار توزین دوم» خالص ندارند،
                پس در جمع وزن خالص/پر/تار نمی‌آیند. برای دیدن ریز قبوض با همین فیلترها، از تب «قبوض باسکول» استفاده کنید.
            </div>

        </div>
    );
};

export default WeighbridgeReportTab;

