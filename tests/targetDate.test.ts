import test from 'node:test';
import assert from 'node:assert/strict';
import { setTargetDate, peekTargetDate, clearTargetDate, toIsoText, dateFromIsoDay } from '../shared/targetDate';

// The hand-off module reads `sessionStorage` lazily on each call (never at import time), so
// installing a shim on globalThis before the tests run is enough — Node has no sessionStorage.
const shim = (() => {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string) => { map.set(k, v); },
        removeItem: (k: string) => { map.delete(k); },
        size: () => map.size,
    };
})();
(globalThis as any).sessionStorage = shim;

// Regression suite for the «مشاهده روز» button in جستجوی سراسری.
//
// The button stored the result's day in sessionStorage and the entry/exit page read it inside a
// `useState` initializer that ALSO removed it. The production bundle ships React's DEVELOPMENT
// build, so StrictMode runs that initializer twice: the first run consumed the value and the second
// one opened "today" instead of the requested day. These tests pin the new contract:
// peek is repeatable, clearing is explicit and idempotent.

test('the stored date is always normalised to Gregorian ISO', () => {
    assert.equal(toIsoText('2026-10-10'), '2026-10-10');
    assert.equal(toIsoText('2026-10-10T08:30:00'), '2026-10-10');
    assert.equal(toIsoText('2026-1-5'), '2026-01-05');
    // Jalali -> Gregorian (1405/07/18 is the day the app writes as 2026-10-10).
    assert.equal(toIsoText('1405/07/18'), '2026-10-10');
    assert.equal(toIsoText('1405/07/19'), '2026-10-11');
});

test('an unusable date is reported as such instead of silently becoming today', () => {
    assert.equal(toIsoText(''), null);
    assert.equal(toIsoText('   '), null);
    assert.equal(toIsoText(null), null);
    assert.equal(toIsoText(undefined), null);
    assert.equal(toIsoText('garbage'), null);
    assert.equal(toIsoText('2026-13-40'), null, 'month 13 must be rejected');
});

test('dateFromIsoDay returns a local NOON date so no timezone can shift the day', () => {
    const d = dateFromIsoDay('2026-10-10');
    assert.ok(d instanceof Date);
    assert.equal(d?.getFullYear(), 2026);
    assert.equal(d?.getMonth(), 9);
    assert.equal(d?.getDate(), 10);
    assert.equal(d?.getHours(), 12, 'noon anchor');
    assert.equal(dateFromIsoDay('1405/07/18'), null, 'only normalised ISO is accepted here');
    assert.equal(dateFromIsoDay(''), null);
});

test('setTargetDate + peekTargetDate round-trip, including Jalali input', () => {
    clearTargetDate();
    assert.equal(peekTargetDate(), null);

    setTargetDate('2026-10-10');
    assert.equal(peekTargetDate(), '2026-10-10');

    setTargetDate('1405/07/18');
    assert.equal(peekTargetDate(), '2026-10-10');
});

test('REGRESSION: peeking twice returns the same day (this is what StrictMode does)', () => {
    clearTargetDate();
    setTargetDate('2026-10-10');

    const first = peekTargetDate();   // the invocation React then throws away
    const second = peekTargetDate();  // the invocation React actually keeps

    assert.equal(first, '2026-10-10');
    assert.equal(second, '2026-10-10', 'the second read must NOT fall back to today');
    assert.equal(dateFromIsoDay(second)?.getDate(), 10);
});

test('clearTargetDate forgets the day, and is safe to repeat', () => {
    setTargetDate('2026-10-10');
    clearTargetDate();
    assert.equal(peekTargetDate(), null);
    clearTargetDate();
    assert.equal(peekTargetDate(), null);
});

test('an unusable value clears a previously pending day instead of leaving it behind', () => {
    setTargetDate('1405/07/18');
    assert.equal(peekTargetDate(), '2026-10-10');
    setTargetDate('garbage');
    assert.equal(peekTargetDate(), null, 'a bad value must not keep an older day pending');
});

test('with no sessionStorage at all the module degrades to "no pending day" and never throws', () => {
    const saved = (globalThis as any).sessionStorage;
    try {
        delete (globalThis as any).sessionStorage;
        assert.equal(peekTargetDate(), null);
        setTargetDate('2026-10-10');
        clearTargetDate();
    } finally {
        (globalThis as any).sessionStorage = saved;
    }
    // The shim still works afterwards.
    setTargetDate('2026-10-10');
    assert.equal(peekTargetDate(), '2026-10-10');
});
