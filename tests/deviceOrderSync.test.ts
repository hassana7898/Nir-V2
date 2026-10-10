import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Device-sync fix (priority bug): the server's `sort_order` must be the Source of Truth, so a
// device holding a stale localStorage layout is corrected on hydration instead of keeping its
// own order for the day.
//
// `services/dataService` reaches for `window.localStorage` / `navigator` at call time, so both are
// stubbed BEFORE the module is imported and before `hydrateFromServer` runs.
const store = new Map<string, string>();
(globalThis as any).window = {
    localStorage: {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
    },
    dispatchEvent: () => true,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
};
// `navigator` is a read-only getter in modern Node, so it is not stubbed here: `sendRestRequest`
// then reports the OFFLINE code and `syncOrderToServer` logs+returns false (its graceful path).

const D = '2026-09-25';
const serverRow = (id: string, sortOrder: number | null, createdAt: string) => ({
    id, type: 'exit', date: D, productId: 'p1', farmerId: 'f1', weight: '100',
    sortOrder, createdAt,
});

const emptyStateResponse = (invoices: any[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ invoices }),
});

test('hydration REPLACES a stale local layout with the server order (the reported bug)', async () => {
    const { hydrateFromServer } = await import('../services/dataService');

    // Device B still holds an old manual layout (c, b, a).
    store.set(`sortOrder_exit_${D}`, JSON.stringify(['c', 'b', 'a']));

    // The server says a(0), b(1), c(2) — Device A saved that order.
    (globalThis as any).fetch = async () => emptyStateResponse([
        serverRow('a', 0, '2026-09-25T08:00:00.000Z'),
        serverRow('b', 1, '2026-09-25T09:00:00.000Z'),
        serverRow('c', 2, '2026-09-25T10:00:00.000Z'),
    ]);

    assert.equal(await hydrateFromServer(), true);
    assert.deepEqual(
        JSON.parse(store.get(`sortOrder_exit_${D}`) as string),
        ['a', 'b', 'c'],
        'the stale device must be re-ordered exactly like the device that saved it'
    );
});

test('invoices without an ordinal stay at the BOTTOM, in chronological order', async () => {
    const { hydrateFromServer } = await import('../services/dataService');
    store.delete(`sortOrder_exit_${D}`);

    (globalThis as any).fetch = async () => emptyStateResponse([
        serverRow('new2', null, '2026-09-25T12:00:00.000Z'),
        serverRow('a', 0, '2026-09-25T08:00:00.000Z'),
        serverRow('b', 1, '2026-09-25T09:00:00.000Z'),
        serverRow('new1', null, '2026-09-25T11:00:00.000Z'),
    ]);

    await hydrateFromServer();
    assert.deepEqual(
        JSON.parse(store.get(`sortOrder_exit_${D}`) as string),
        ['a', 'b', 'new1', 'new2'],
        'positioned rows keep the server order; new rows are appended oldest-first'
    );
});

test('a layout this device JUST saved is not clobbered by an in-flight hydration', async () => {
    const { hydrateFromServer, saveOrderForDate } = await import('../services/dataService');

    // Local save (the PUT is still in flight, so the server state below is deliberately older).
    await saveOrderForDate('exit', new Date(2026, 8, 25, 12, 0, 0), ['c', 'a', 'b']);

    (globalThis as any).fetch = async () => emptyStateResponse([
        serverRow('a', 0, '2026-09-25T08:00:00.000Z'),
        serverRow('b', 1, '2026-09-25T09:00:00.000Z'),
        serverRow('c', 2, '2026-09-25T10:00:00.000Z'),
    ]);
    await hydrateFromServer();

    assert.deepEqual(
        JSON.parse(store.get(`sortOrder_exit_${D}`) as string),
        ['c', 'a', 'b'],
        'the grace window protects the save the user just made on this device'
    );
});

test('a bucket with no ordinals at all is left to the local/default order', async () => {
    const { hydrateFromServer } = await import('../services/dataService');
    store.set('sortOrder_entry_2026-09-26', JSON.stringify(['x', 'y']));

    (globalThis as any).fetch = async () => emptyStateResponse([
        { id: 'x', type: 'entry', date: '2026-09-26', productId: 'p1', sellerName: 's', scaleWeight: '10', createdAt: '2026-09-26T08:00:00.000Z', sortOrder: null },
        { id: 'y', type: 'entry', date: '2026-09-26', productId: 'p1', sellerName: 's', scaleWeight: '20', createdAt: '2026-09-26T09:00:00.000Z', sortOrder: null },
    ]);

    await hydrateFromServer();
    assert.deepEqual(
        JSON.parse(store.get('sortOrder_entry_2026-09-26') as string),
        ['x', 'y'],
        'with no server ordinals there is nothing authoritative to apply'
    );
});
