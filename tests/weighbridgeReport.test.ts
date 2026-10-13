import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addIsoDays,
    bucketOf,
    groupGoodsByDay,
    isNettedTicket,
    isoDayOfDate,
    isoDayToJalaliText,
    jalaliToIsoDay,
    jalaliMonthRange,
    jalaliYearRange,
    pendingWeightOf,
    periodRange,
    persianWeekRange,
    sharePercent,
    type DayGoodsLine,
} from '../shared/weighbridgeReport';

// Regression suite for the weighbridge REPORT periods (گزارش‌گیری باسکول).
//
// The rules the factory relies on:
//   * «این هفته» is the PERSIAN week: Saturday..Friday;
//   * «این ماه» is the JALALI month (فروردین..اسفند), not the Gregorian one;
//   * every bound is an inclusive ISO day applied to the ticket's own wall-clock weigh_time, so
//     no timezone may shift a day.

// 2026-10-11 is a Sunday (Tehran). Jalali: 1405/07/19.
const NOW = new Date(2026, 9, 11, 9, 30, 0);

test('ISO/local helpers never shift the day (no toISOString)', () => {
    assert.equal(isoDayOfDate(NOW), '2026-10-11');
    assert.equal(addIsoDays('2026-10-01', -1), '2026-09-30');
    assert.equal(addIsoDays('2026-03-01', -1), '2026-02-28');
    assert.equal(isoDayToJalaliText('2026-10-11'), '1405/07/19');
});

test('today / yesterday / last7', () => {
    assert.deepEqual(periodRange('today', NOW), { from: '2026-10-11', to: '2026-10-11' });
    assert.deepEqual(periodRange('yesterday', NOW), { from: '2026-10-10', to: '2026-10-10' });
    assert.deepEqual(periodRange('last7', NOW), { from: '2026-10-05', to: '2026-10-11' });
});

test('the Persian week starts on Saturday and is Saturday..Friday', () => {
    const week = persianWeekRange('2026-10-11'); // Sunday
    assert.equal(week.from, '2026-10-10');
    assert.equal(week.to, '2026-10-16');
    assert.equal(new Date(2026, 9, 10).getDay(), 6, 'the week must start on Saturday');
    assert.equal(new Date(2026, 9, 16).getDay(), 5, 'and end on Friday');

    // A Saturday is its own first day.
    assert.deepEqual(persianWeekRange('2026-10-10'), { from: '2026-10-10', to: '2026-10-16' });
    assert.deepEqual(periodRange('thisWeek', NOW), { from: '2026-10-10', to: '2026-10-16' });
    assert.deepEqual(periodRange('lastWeek', NOW), { from: '2026-10-03', to: '2026-10-09' });
});

test('a Jalali month range is exact (31- and 30-day months, and the year boundary)', () => {
    // Month 7 always has 30 days; month 6 always has 31.
    const mehr = jalaliMonthRange(1405, 7);
    assert.equal(mehr.from, jalaliToIsoDay(1405, 7, 1));
    assert.equal(mehr.to, jalaliToIsoDay(1405, 7, 30));
    const shahrivar = jalaliMonthRange(1405, 6);
    assert.equal(shahrivar.to, jalaliToIsoDay(1405, 6, 31));

    // Esfand rolls into the NEXT Jalali year instead of overflowing it.
    const esfand = jalaliMonthRange(1405, 12);
    assert.equal(addIsoDays(esfand.to, 1), jalaliToIsoDay(1406, 1, 1), 'esfand must end the day before Farvardin 1');
});

test('thisMonth / lastMonth follow the Jalali calendar', () => {
    const thisMonth = periodRange('thisMonth', NOW);
    assert.deepEqual(thisMonth, jalaliMonthRange(1405, 7));
    assert.equal(isoDayToJalaliText(thisMonth.from), '1405/07/01');
    assert.equal(isoDayToJalaliText(thisMonth.to), '1405/07/30');

    const lastMonth = periodRange('lastMonth', NOW);
    assert.deepEqual(lastMonth, jalaliMonthRange(1405, 6));
    assert.equal(isoDayToJalaliText(lastMonth.to), '1405/06/31');

    // Farvardin's previous month is Esfand of the previous year.
    const farvardin = periodRange('lastMonth', new Date(2026, 3, 5));
    const fj = bucketOf(isoDayOfDate(new Date(2026, 3, 5)), 'day').label;
    assert.ok(fj.startsWith('1405/01'), `expected Farvardin, got ${fj}`);
    assert.equal(isoDayToJalaliText(farvardin.to), '1404/12/29');
});

test('thisYear covers the whole Jalali year', () => {
    const y = periodRange('thisYear', NOW);
    assert.deepEqual(y, jalaliYearRange(1405));
    assert.equal(isoDayToJalaliText(y.from), '1405/01/01');
    assert.equal(isoDayToJalaliText(addIsoDays(y.to, 1)), '1406/01/01');
});

test('a custom range is honoured, and a reversed one is repaired instead of emptied', () => {
    assert.deepEqual(periodRange('custom', NOW, { from: '2026-09-01', to: '2026-09-30' }), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(periodRange('custom', NOW, { to: '2026-09-01', from: '2026-09-30' }), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(periodRange('custom', NOW, {}), { from: '2026-10-11', to: '2026-10-11' });
});

test('day / week / month buckets group the same day the way each report expects', () => {
    const day = bucketOf('2026-10-11', 'day');
    assert.equal(day.key, '2026-10-11');
    assert.equal(day.label, '1405/07/19');

    // Every day of one Persian week lands in the SAME bucket (keyed by its Saturday).
    const weekKeys = ['2026-10-10', '2026-10-11', '2026-10-15', '2026-10-16'].map((d) => bucketOf(d, 'week').key);
    assert.deepEqual(Array.from(new Set(weekKeys)), ['2026-10-10']);
    assert.equal(bucketOf('2026-10-17', 'week').key, '2026-10-17', 'the next Saturday starts a new bucket');

    // Jalali month bucket.
    assert.equal(bucketOf('2026-10-11', 'month').key, '1405/07');
    assert.equal(bucketOf('2026-10-11', 'month').label, 'ماه 1405/07');
    assert.equal(bucketOf('2026-09-23', 'month').key, '1405/07', 'the first day of Mehr is the same bucket');
});

test('sharePercent is a display figure and never divides by zero', () => {
    assert.equal(sharePercent(25, 100), 25);
    assert.equal(sharePercent(1, 3), 33.3);
    assert.equal(sharePercent(5, 0), 0);
    assert.equal(sharePercent(0, 10), 0);
});

/* ------------------------------------------------------------------ «خالص‌شده» */

// The bug this suite locks down: the weighing software opens a ticket at the FIRST weighing and leaves
// the other column at 0, so a half-weighed ticket used to be stored with «وزن خالص» = its own gross
// (ticket 3593: 26,360 kg). A ticket is netted ONLY when all three weights are positive.
test('a ticket is «خالص‌شده» only when BOTH weighings are recorded', () => {
    assert.equal(isNettedTicket(26360, 26360, 0), false, 'tare-first ticket was never a net of 26,360');
    assert.equal(isNettedTicket(26360, 0, 26360), false, 'gross-only ticket is not netted either');
    assert.equal(isNettedTicket(26360, 11360, 15000), true);
    assert.equal(isNettedTicket(0, 0, 0), false, 'an empty row is not netted');
    assert.equal(isNettedTicket(null, null, null), false);
    assert.equal(isNettedTicket('26360', '11360', '15000'), true, 'server strings are accepted');
});

test('pendingWeightOf reports the load a first-weighing ticket is holding', () => {
    assert.equal(pendingWeightOf(0, 26360), 26360, 'gross-only ticket holds its gross');
    assert.equal(pendingWeightOf(11360, 0), 11360, 'tare-only ticket holds its tare');
    assert.equal(pendingWeightOf(null, undefined), 0);
});

/* ------------------------------------------------------------- روز × کالا (چاپی) */

const line = (day: string, goods: string, net: number, extra: Partial<DayGoodsLine> = {}): DayGoodsLine => ({
    day,
    goods,
    tickets: 1,
    gross: net > 0 ? net + 11000 : 0,
    tare: net > 0 ? 11000 : 0,
    net,
    netted: net > 0 ? 1 : 0,
    pending: net > 0 ? 0 : 1,
    pendingTare: 0,
    pendingGross: 0,
    entryTickets: 1,
    exitTickets: 0,
    ...extra,
});

test('groupGoodsByDay buckets per day, sums «جمع روز» from its own lines and sorts them', () => {
    const groups = groupGoodsByDay([
        line('2026-10-11', 'ذرت', 15000, { entryTickets: 1, exitTickets: 0 }),
        // Server shape of a first-weighing row: no weights in gross/tare/net (NETTED_SQL filters them out),
        // only pendingGross — so the day must not inherit 11,000 kg it never weighed.
        line('2026-10-11', 'سویا', 0, { pendingTare: 0, pendingGross: 9000, entryTickets: 0, exitTickets: 1 }),
        line('2026-10-09', 'ذرت', 12000),
    ]);

    assert.deepEqual(groups.map((g) => g.day), ['2026-10-09', '2026-10-11'], 'days ascend');
    assert.equal(groups[1].label, '1405/07/19');

    // Each day's کالا lines are ordered by وزن خالص (the half-weighed سویا line nets 0, so it comes last).
    assert.deepEqual(groups[1].goods.map((g) => g.goods), ['ذرت', 'سویا']);

    // «جمع روز» must equal the sum of the lines printed directly above it — and must NOT add the
    // pending weight into the net.
    assert.equal(groups[1].tickets, 2);
    assert.equal(groups[1].net, 15000);
    assert.equal(groups[1].netted, 1);
    assert.equal(groups[1].pending, 1);
    assert.equal(groups[1].pendingWeight, 9000, 'the pending truck is reported separately');
    assert.equal(groups[1].gross, 26000, 'only the netted line contributes a gross');
    assert.equal(groups[1].entryTickets, 1);
    assert.equal(groups[1].exitTickets, 1);
});

test('groupGoodsByDay tolerates an empty/absent payload and a missing کالا', () => {
    assert.deepEqual(groupGoodsByDay(undefined), []);
    assert.deepEqual(groupGoodsByDay(null), []);
    assert.deepEqual(groupGoodsByDay([]), []);

    const [only] = groupGoodsByDay([line('2026-10-11', '', 0, { pendingGross: 26360 })]);
    assert.equal(only.goods[0].goods, '—', 'an unnamed کالا still gets a line');
    assert.equal(only.pendingWeight, 26360, 'a gross-only ticket holds its gross');
    assert.equal(only.net, 0, 'a first-weighing truck is never counted as a net');
    assert.equal(only.gross, 0, 'nor as a gross');
});
