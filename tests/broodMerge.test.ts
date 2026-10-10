import test from 'node:test';
import assert from 'node:assert/strict';
import {
    activeBroods,
    broodIdentityKey,
    combineBroodPair,
    deletedBroods,
    isBroodDeleted,
    mergeBroods,
    restoreBroodInList,
    softDeleteBrood,
} from '../shared/broodMerge';

// Regression suite for the PERIOD (brood) data-protection work:
//   - merging two farmers must never produce duplicate periods
//   - a deleted period must be invisible everywhere and restorable, never physically lost

const brood = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    startDate: '2026-01-01',
    chickCount: 10000,
    exceptionalFeed: [],
    ...extra,
});

test('periods with the SAME id are combined, not duplicated', () => {
    const merged = mergeBroods(
        [brood('b1', { endDate: '2026-03-01' })],
        [brood('b1', { finalChickenWeight: 2500 })],
    );
    assert.equal(merged.length, 1, 'the same period must appear once');
    assert.equal(merged[0].endDate, '2026-03-01');
    assert.equal(merged[0].finalChickenWeight, 2500, 'both sides contribute their data');
});

test('periods with different ids but the SAME name-like identity are combined', () => {
    // No `name` field exists on a period, so its identity is the starting invoice, otherwise
    // startDate + flock size - exactly what the user perceives as "the same period".
    const merged = mergeBroods(
        [brood('b-old', { startInvoiceId: 'inv_1', chickCount: 10000 })],
        [brood('b-new', { startInvoiceId: 'inv_1', chickCount: 10000, endDate: '2026-03-05' })],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].endDate, '2026-03-05');
    assert.equal(broodIdentityKey(merged[0]), 'inv:inv_1');
});

test('genuinely different periods are all kept', () => {
    const merged = mergeBroods(
        [brood('b1', { startDate: '2026-01-01' })],
        [brood('b2', { startDate: '2026-05-01' }), brood('b3', { startDate: '2026-09-01' })],
    );
    assert.equal(merged.length, 3);
    assert.deepEqual(merged.map(b => b.id), ['b1', 'b2', 'b3'], 'the base order is preserved');
});

test('combining keeps the largest flock, the widest window and the union of links/feeds', () => {
    const a = brood('a', {
        chickCount: 10000,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        includedInvoiceIds: ['i1', 'i2'],
        excludedInvoiceIds: ['x1'],
        activeProductsAtCreation: ['p1'],
        exceptionalFeed: [{ productId: 'p1', date: '2026-01-10', weight: 50, reason: 'دسته‌ای' }],
    });
    const b = brood('b', {
        chickCount: 12000,
        startDate: '2026-01-05',
        endDate: '2026-03-01',
        includedInvoiceIds: ['i2', 'i3'],
        excludedInvoiceIds: ['x1', 'x2'],
        activeProductsAtCreation: ['p2'],
        exceptionalFeed: [
            { productId: 'p1', date: '2026-01-10', weight: 50, reason: 'دسته‌ای' }, // exact duplicate
            { productId: 'p2', date: '2026-01-20', weight: 30, reason: 'دارو' },
        ],
    });

    const merged = combineBroodPair(a, b);
    assert.equal(merged.chickCount, 12000, 'the bigger flock wins (a smaller value would lose chicks)');
    assert.equal(merged.startDate, '2026-01-01', 'earliest start');
    assert.equal(merged.endDate, '2026-03-01', 'latest end');
    assert.deepEqual(merged.includedInvoiceIds?.sort(), ['i1', 'i2', 'i3']);
    assert.deepEqual(merged.excludedInvoiceIds?.sort(), ['x1', 'x2']);
    assert.deepEqual(merged.activeProductsAtCreation?.sort(), ['p1', 'p2']);
    assert.equal(merged.exceptionalFeed?.length, 2, 'duplicate feed entries are counted once');
});

test('a live period is never swallowed by a deleted twin', () => {
    const live = brood('live', { startInvoiceId: 'inv_9' });
    const removed = brood('removed', { startInvoiceId: 'inv_9', deletedAt: '2026-02-01T00:00:00.000Z' });

    const merged = mergeBroods([live], [removed]);
    assert.equal(merged.length, 1);
    assert.equal(isBroodDeleted(merged[0]), false, 'the result stays ACTIVE');
    assert.equal(merged[0].id, 'live', 'and it keeps the id the UI already shows');

    const bothDeleted = mergeBroods([removed], [{ ...removed, id: 'removed2' }]);
    assert.equal(isBroodDeleted(bothDeleted[0]), true, 'deleted + deleted stays deleted');
});

test('soft delete and restore are pure and round-trip exactly', () => {
    const list = [brood('b1'), brood('b2')];
    const stamp = '2026-06-01T10:00:00.000Z';

    const afterDelete = softDeleteBrood<any>(list, 'b2', stamp);
    assert.equal(afterDelete.length, 2, 'NOTHING is removed from the array');
    assert.equal(afterDelete[1].deletedAt, stamp);
    assert.equal((list[1] as any).deletedAt, undefined, 'the input is not mutated');

    const afterRestore = restoreBroodInList<any>(afterDelete, 'b2');
    assert.equal('deletedAt' in afterRestore[1], false, 'the flag is gone after restore');
    assert.equal(afterRestore[1].id, 'b2');
    assert.equal(afterRestore.length, 2);
    assert.deepEqual(afterRestore.map(b => b.id), list.map(b => b.id));
});

test('active/deleted selectors split the list the way every view needs', () => {
    const list = [
        brood('a'),
        brood('b', { deletedAt: '2026-06-01T10:00:00.000Z' }),
        null as any,
        brood('c'),
    ];
    assert.deepEqual(activeBroods<any>(list).map(b => b.id), ['a', 'c'], 'deleted + null are excluded');
    assert.deepEqual(deletedBroods<any>(list).map(b => b.id), ['b']);
    assert.deepEqual(activeBroods<any>(undefined), [], 'a missing array is safe');
});

test('garbage input never throws (legacy/null broods are common)', () => {
    assert.deepEqual(mergeBroods(undefined, undefined), []);
    assert.deepEqual(mergeBroods('nope', 42), []);
    assert.deepEqual(mergeBroods([null, undefined, 'x'], [brood('ok')]).map((b: any) => b.id), ['ok']);
    assert.equal(broodIdentityKey(null), 'start:|0');
});
