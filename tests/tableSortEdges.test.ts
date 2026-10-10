import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, SortSpec } from '../utils/tableSort';

// Edge-case hardening for the multi-sort ("unpredictable Shift+click" report).
// Null/undefined/empty cells, Persian numerals, Dates, booleans and throwing accessors must not
// break the ordering - and row integrity must stay 100% intact in every case.

interface Row { id: string; name: string; weight: number | string | null; date?: Date; flag?: boolean; }

const rows: Row[] = [
    { id: 'a', name: 'الف', weight: null },
    { id: 'b', name: 'ب', weight: undefined as any },
    { id: 'c', name: 'پ', weight: '' },
    { id: 'd', name: 'ت', weight: 300 },
    { id: 'e', name: 'ث', weight: '۳۰۰' },   // Persian digits = same number as 300
    { id: 'f', name: 'ج', weight: 50 },
];

const byId = new Map(rows.map((r) => [r.id, r]));
const assertIntact = (sorted: Row[]) => {
    assert.equal(sorted.length, rows.length);
    for (const row of sorted) {
        assert.equal(row, byId.get(row.id), 'the same row object must be re-ordered, never copied');
    }
};

test('null / undefined / empty sort keys do not break the sort or the rows', () => {
    const sorted = sortRows<Row, keyof Row>(rows, [{ key: 'weight', direction: 'asc' }]);
    assertIntact(sorted);
    // Blanks first on ASC, then the numbers (50 < 300 == '۳۰۰').
    assert.deepEqual(sorted.map((r) => r.id).slice(0, 3).sort(), ['a', 'b', 'c']);
    assert.deepEqual(sorted.map((r) => r.id).slice(3), ['f', 'd', 'e']);
});

test('Persian-digit weights sort numerically with Latin-digit weights', () => {
    const asc = sortRows<Row, keyof Row>(rows, [{ key: 'weight', direction: 'asc' }]);
    const desc = sortRows<Row, keyof Row>(rows, [{ key: 'weight', direction: 'desc' }]);
    const numericAsc = asc.filter((r) => r.id === 'f' || r.id === 'd' || r.id === 'e').map((r) => r.id);
    assert.deepEqual(numericAsc, ['f', 'd', 'e']);
    assert.deepEqual(desc.filter((r) => r.id !== 'a' && r.id !== 'b' && r.id !== 'c').slice(0, 2).map((r) => r.id), ['d', 'e']);
});

test('a throwing accessor degrades to "blank" instead of crashing the table', () => {
    const sorted = sortRows<Row, 'weight' | 'name'>(
        rows,
        [{ key: 'weight', direction: 'asc' }, { key: 'name', direction: 'asc' }],
        { weight: (row) => { if (row.id === 'd') throw new Error('boom'); return row.weight; } },
    );
    assertIntact(sorted);
});

test('Date and boolean columns are comparable', () => {
    const dated: Row[] = [
        { id: 'x', name: 'x', weight: 1, date: new Date('2026-01-02') },
        { id: 'y', name: 'y', weight: 1, date: new Date('2025-12-31') },
        { id: 'z', name: 'z', weight: 1, date: undefined },
    ];
    const asc = sortRows<Row, keyof Row>(dated, [{ key: 'date', direction: 'asc' }]);
    assert.deepEqual(asc.map((r) => r.id), ['z', 'y', 'x']);

    const bools: Row[] = [
        { id: 'on', name: 'on', weight: 1, flag: true },
        { id: 'off', name: 'off', weight: 1, flag: false },
    ];
    const flagged = sortRows<Row, keyof Row>(bools, [{ key: 'flag', direction: 'desc' }]);
    assert.deepEqual(flagged.map((r) => r.id), ['on', 'off']);
});

test('a multi-key sort over blank-heavy columns stays stable and complete', () => {
    const specs: SortSpec<keyof Row>[] = [
        { key: 'weight', direction: 'asc' },
        { key: 'name', direction: 'desc' },
    ];
    const first = sortRows<Row, keyof Row>(rows, specs);
    const second = sortRows<Row, keyof Row>(rows, specs);
    assertIntact(first);
    assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id), 'deterministic');
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e', 'f'], 'the source array is untouched');
});
