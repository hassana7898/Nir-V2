import { toGregorian, toJalali } from './jalali';

/**
 * Pure date logic for the weighbridge REPORT (گزارش‌گیری باسکول): period presets, Jalali-aware
 * grouping and the small helpers the report tables need.
 *
 * Kept away from the React page and the SQL so it can be tested exactly: «این هفته» must start on
 * SHANBE (Saturday) — the Persian week — «این ماه» must be the JALALI month, and a day bucket must
 * never drift by a timezone. Every range is an inclusive ISO day (`YYYY-MM-DD`) applied to the
 * ticket's own wall-clock `weigh_time`.
 */

export type ReportPeriod =
    | 'today'
    | 'yesterday'
    | 'last7'
    | 'thisWeek'
    | 'lastWeek'
    | 'thisMonth'
    | 'lastMonth'
    | 'thisYear'
    | 'custom';

export type ReportGrouping = 'day' | 'week' | 'month';

export interface DayRange {
    from: string;
    to: string;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Local ISO day (`YYYY-MM-DD`) — never `toISOString()`, which would shift the day in +03:30. */
export const isoDayOfDate = (date: Date): string =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Local NOON Date for an ISO day: noon keeps a day from sliding across a DST/TZ boundary. */
export const noonOfIsoDay = (iso: string): Date => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
    if (!m) throw new Error(`not an ISO day: ${iso}`);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
};

export const addIsoDays = (iso: string, days: number): string => {
    const d = noonOfIsoDay(iso);
    d.setDate(d.getDate() + days);
    return isoDayOfDate(d);
};

/** Jalali `1405/07/12` for an ISO day (display label of a day bucket). */
export const isoDayToJalaliText = (iso: string): string => {
    const d = noonOfIsoDay(iso);
    const { jy, jm, jd } = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${jy}/${pad2(jm)}/${pad2(jd)}`;
};

/** Jalali date -> ISO day (`1405/07/01` -> `2026-09-23`). */
export const jalaliToIsoDay = (jy: number, jm: number, jd: number): string => {
    const g = toGregorian(jy, jm, jd);
    return isoDayOfDate(new Date(g.gy, g.gm - 1, g.gd, 12, 0, 0));
};

const nextJalaliMonth = (jy: number, jm: number): { jy: number; jm: number } =>
    jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };

/** Inclusive bounds of a Jalali month, derived exactly (no hard-coded month lengths). */
export const jalaliMonthRange = (jy: number, jm: number): DayRange => {
    const from = jalaliToIsoDay(jy, jm, 1);
    const next = nextJalaliMonth(jy, jm);
    return { from, to: addIsoDays(jalaliToIsoDay(next.jy, next.jm, 1), -1) };
};

/** Inclusive bounds of a Jalali year (its last day is the day before next Farvardin 1). */
export const jalaliYearRange = (jy: number): DayRange => ({
    from: jalaliToIsoDay(jy, 1, 1),
    to: addIsoDays(jalaliToIsoDay(jy + 1, 1, 1), -1),
});

/* ==== PART2-ANCHOR ==== */

/**
 * The Persian week starts on Saturday. `getDay()` is 0=Sunday … 6=Saturday, so Saturday maps to 0
 * and the offset back to it is `(getDay() + 1) % 7`. A report week is Saturday..Friday, inclusive.
 */
export const persianWeekRange = (dayIso: string): DayRange => {
    const backToSaturday = (noonOfIsoDay(dayIso).getDay() + 1) % 7;
    const from = addIsoDays(dayIso, -backToSaturday);
    return { from, to: addIsoDays(from, 6) };
};

/**
 * The inclusive range of a preset. `now` is injected so the behaviour is testable; `custom` echoes
 * the range the caller passed (a missing/blank bound falls back to today).
 */
export const periodRange = (period: ReportPeriod, now: Date = new Date(), custom?: Partial<DayRange>): DayRange => {
    const today = isoDayOfDate(now);
    switch (period) {
        case 'today':
            return { from: today, to: today };
        case 'yesterday':
            return { from: addIsoDays(today, -1), to: addIsoDays(today, -1) };
        case 'last7':
            return { from: addIsoDays(today, -6), to: today };
        case 'thisWeek':
            return persianWeekRange(today);
        case 'lastWeek': {
            const week = persianWeekRange(today);
            return { from: addIsoDays(week.from, -7), to: addIsoDays(week.from, -1) };
        }
        case 'thisMonth': {
            const { jy, jm } = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
            return jalaliMonthRange(jy, jm);
        }
        case 'lastMonth': {
            const { jy, jm } = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
            const prev = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
            return jalaliMonthRange(prev.jy, prev.jm);
        }
        case 'thisYear': {
            const { jy } = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
            return jalaliYearRange(jy);
        }
        case 'custom':
        default: {
            const from = String(custom?.from ?? '').trim() || today;
            const to = String(custom?.to ?? '').trim() || from;
            // A reversed range is repaired rather than silently returning nothing.
            return from <= to ? { from, to } : { from: to, to: from };
        }
    }
};

export interface Bucket {
    /** Sortable bucket key: the ISO day, the week's Saturday ISO day, or `1405/07`. */
    key: string;
    /** Persian label for the report table. */
    label: string;
}

/**
 * The bucket an ISO day falls into. Weeks are the Persian weeks of `persianWeekRange` and months are
 * Jalali months, so a monthly report lines up with the factory's own فروردین..اسفند calendar.
 */
export const bucketOf = (isoDay: string, grouping: ReportGrouping): Bucket => {
    if (grouping === 'week') {
        const from = persianWeekRange(isoDay).from;
        return { key: from, label: `${isoDayToJalaliText(from)} تا ${isoDayToJalaliText(addIsoDays(from, 6))}` };
    }
    if (grouping === 'month') {
        const d = noonOfIsoDay(isoDay);
        const { jy, jm } = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
        return { key: `${jy}/${pad2(jm)}`, label: `ماه ${jy}/${pad2(jm)}` };
    }
    return { key: isoDay, label: isoDayToJalaliText(isoDay) };
};

/** Share of a total, as a display percentage (0 when the total is 0). */
export const sharePercent = (part: number, total: number): number =>
    !Number.isFinite(total) || total <= 0 ? 0 : Math.round((Number(part) / total) * 1000) / 10;

/* ==== PART3-ANCHOR-NETTED ==== */

const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/**
 * «خالص‌شده» — a ticket whose SECOND weighing is done.
 *
 * The weighing software opens a ticket at the FIRST weighing and leaves the other weight column at 0
 * (`وزن پر` filled ⇒ «وزن خالی» = 0, and vice versa), so `net_weight` alone cannot be trusted: a net
 * derived from `gross - 0` is just the gross (e.g. 26,360 kg for a truck still standing on the scale).
 * A ticket counts as netted only when BOTH weighings exist AND the net is positive; everything else is
 * «در انتظار توزین دوم». This is the client-side twin of the server's SQL predicate, so the list, the
 * counters, the report and the printed sheet can never disagree.
 */
export const isNettedTicket = (gross: unknown, tare: unknown, net: unknown): boolean =>
    num(gross) > 0 && num(tare) > 0 && num(net) > 0;

/** Weight still sitting in a first-weighing ticket (its tare, or its gross when the tare is missing). */
export const pendingWeightOf = (tare: unknown, gross: unknown): number => {
    const t = num(tare);
    return t > 0 ? t : num(gross);
};

/** One «روز × کالا» line of the daily report (mirrors the server's `byDayGoods`). */
export interface DayGoodsLine {
    day: string;
    goods: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    netted: number;
    pending: number;
    pendingTare: number;
    pendingGross: number;
    entryTickets: number;
    exitTickets: number;
}

/** A day of the printed report: its per-کالا lines plus the day's own totals («جمع روز»). */
export interface DayGoodsGroup {
    /** ISO day (`YYYY-MM-DD`) — the sort key of the group. */
    day: string;
    /** Jalali label (`1405/07/19`) for the printed sheet. */
    label: string;
    goods: DayGoodsLine[];
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    netted: number;
    pending: number;
    /** کیلوگرمِ در انتظار توزین دوم — the weight of tickets that only had their first weighing. */
    pendingWeight: number;
    entryTickets: number;
    exitTickets: number;
}

/**
 * Bucket the server's «روز × کالا» rows into one group per day, with a «جمع روز» computed here (never
 * re-derived from a different filter), so the printed per-day totals always equal the sum of the lines
 * printed directly above them. Days ascend, and each day's کالا lines are ordered by وزن خالص.
 */
export const groupGoodsByDay = (rows: DayGoodsLine[] | undefined | null): DayGoodsGroup[] => {
    const groups = new Map<string, DayGoodsGroup>();
    for (const row of rows || []) {
        const day = String(row?.day ?? '').trim();
        const group = groups.get(day) || {
            day,
            label: day ? isoDayToJalaliText(day) : '—',
            goods: [],
            tickets: 0,
            gross: 0,
            tare: 0,
            net: 0,
            netted: 0,
            pending: 0,
            pendingWeight: 0,
            entryTickets: 0,
            exitTickets: 0,
        };
        group.goods.push({
            ...row,
            goods: String(row?.goods ?? '').trim() || '—',
            tickets: num(row?.tickets),
            gross: num(row?.gross),
            tare: num(row?.tare),
            net: num(row?.net),
            netted: num(row?.netted),
            pending: num(row?.pending),
            pendingTare: num(row?.pendingTare),
            pendingGross: num(row?.pendingGross),
            entryTickets: num(row?.entryTickets),
            exitTickets: num(row?.exitTickets),
        });
        group.tickets += num(row?.tickets);
        group.gross += num(row?.gross);
        group.tare += num(row?.tare);
        group.net += num(row?.net);
        group.netted += num(row?.netted);
        group.pending += num(row?.pending);
        group.pendingWeight += pendingWeightOf(row?.pendingTare, row?.pendingGross);
        group.entryTickets += num(row?.entryTickets);
        group.exitTickets += num(row?.exitTickets);
        groups.set(day, group);
    }
    return Array.from(groups.values())
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((group) => ({ ...group, goods: group.goods.sort((a, b) => b.net - a.net || a.goods.localeCompare(b.goods)) }));
};

