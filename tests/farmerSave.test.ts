import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Regression test for the "Archive does nothing" bug.
//
// `saveFarmers` used to write ONLY to the local cache; `hydrateFromServer` replaces that cache
// with the server rows, so an archived brood (endDate) silently came back as active. It must now
// persist the diff through the API.
//
// window is stubbed before the module loads because dataService reads window.localStorage, and
// `navigator` is redefined so sendRestRequest does not short-circuit as OFFLINE in Node.
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
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

type Call = { url: string; method: string; body: any };
const calls: Call[] = [];

const stubApi = (ok = true) => {
    (globalThis as any).fetch = async (url: string, init: any = {}) => {
        let body: any = null;
        try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = init?.body ?? null; }
        calls.push({ url: String(url), method: String(init?.method || 'GET'), body });
        return { ok, status: ok ? 200 : 500, json: async () => (ok ? { success: true, id: 'f1' } : { success: false, error: { code: 'SERVER_ERROR', message: 'boom' } }) };
    };
};

const brood = (extra: any = {}) => ({
    id: 'b1', startDate: '2026-09-01', chickCount: 1000, exceptionalFeed: [], ...extra,
});

test('archiving a brood persists an endDate through PUT /api/farmers/:id', async () => {
    const svc = await import('../services/dataService');
    stubApi(true);
    calls.length = 0;

    // 1st save: the farmer is new to the cache -> POST (create).
    await svc.saveFarmers([{ id: 'f1', name: 'مرغدار تست', broods: [brood()] } as any]);
    assert.equal(calls.filter(c => c.url === '/api/farmers' && c.method === 'POST').length, 1, 'new farmer is created');

    calls.length = 0;
    // 2nd save: exactly what the Archive flow produces (endDate added to the brood).
    const archived = { id: 'f1', name: 'مرغدار تست', broods: [brood({ endDate: '2026-09-25' })] };
    const persisted = await svc.saveFarmers([archived as any]);

    const puts = calls.filter(c => c.url.startsWith('/api/farmers/f1') && c.method === 'PUT');
    assert.equal(puts.length, 1, 'the archive must reach the server with a PUT');
    assert.equal(puts[0].body?.broods?.[0]?.endDate, '2026-09-25', 'the endDate is part of the payload');
    assert.equal(persisted, true, 'a successful write is reported as persisted');
});

test('an unchanged list issues no API call at all (diff, not a full rewrite)', async () => {
    const svc = await import('../services/dataService');
    stubApi(true);
    calls.length = 0;

    const same = [{ id: 'f1', name: 'مرغدار تست', broods: [brood({ endDate: '2026-09-25' })] }];
    const persisted = await svc.saveFarmers(same as any);

    assert.equal(calls.length, 0, 'nothing changed -> nothing persisted');
    assert.equal(persisted, true);
});

test('reopening a brood (endDate removed) persists the change too', async () => {
    const svc = await import('../services/dataService');
    stubApi(true);
    calls.length = 0;

    const reopened = { id: 'f1', name: 'مرغدار تست', broods: [brood()] };
    await svc.saveFarmers([reopened as any]);

    const puts = calls.filter(c => c.method === 'PUT');
    assert.equal(puts.length, 1, 'un-archiving must persist as well');
    assert.equal(puts[0].body?.broods?.[0]?.endDate, undefined, 'endDate is gone from the payload');
});

test('a failed API call reports NOT persisted (so the UI can warn instead of lying)', async () => {
    const svc = await import('../services/dataService');
    stubApi(false);
    calls.length = 0;

    const archivedAgain = { id: 'f1', name: 'مرغدار تست', broods: [brood({ endDate: '2026-09-30' })] };
    const persisted = await svc.saveFarmers([archivedAgain as any]);

    assert.equal(persisted, false, 'the caller is told the write did not reach the server');
    assert.ok(calls.length >= 1, 'the attempt was made (and the payload is queued for retry)');
});
