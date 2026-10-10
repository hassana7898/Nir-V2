import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Default display order (Task 1 - "reverse addition" fix).
// The day's list must read oldest -> newest so a NEWLY ADDED invoice lands at the BOTTOM.
const loadService = () => import('../services/dataService');

const inv = (id: string, createdAt?: number) => ({ id, date: '2026-09-14', createdAt } as any);

test('sortChronological puts the OLDEST first and the NEWEST last (bottom of the list)', async () => {
    const { sortChronological } = await loadService();
    const list = [inv('c', 3000), inv('a', 1000), inv('b', 2000)];
    const ids = sortChronological(list).map((i: any) => i.id);

    assert.deepEqual(ids, ['a', 'b', 'c']);
    assert.equal(ids[ids.length - 1], 'c', 'the newest invoice is at the bottom, not row 1');
});

test('sortChronological is deterministic on ties and never mutates its input', async () => {
    const { sortChronological } = await loadService();
    const list = [inv('z', 5000), inv('a', 5000), inv('m', 5000)];
    const before = list.map((i: any) => i.id);

    const ids = sortChronological(list).map((i: any) => i.id);
    assert.deepEqual(ids, ['a', 'm', 'z'], 'equal timestamps break by ascending id');
    assert.deepEqual(list.map((i: any) => i.id), before, 'the input array is left untouched');
});

test('rows without createdAt never yield NaN: the id-embedded timestamp is used', async () => {
    const { sortChronological, createdMs } = await loadService();
    // Real production id shapes: V2 `inv_<ms>_<rand>` and the legacy `local_<ms>_<rand>`.
    const older = { id: 'inv_1789404900525_aaaaa', date: '2026-09-14' } as any;
    const newer = { id: 'local_1789405130935_n2338', date: '2026-09-14' } as any;

    assert.equal(createdMs(older), 1789404900525);
    assert.equal(createdMs(newer), 1789405130935, 'legacy local_<ms>_ ids carry a real timestamp too');
    assert.deepEqual(
        sortChronological([newer, older]).map((r: any) => r.id),
        [older.id, newer.id],
        'rows without createdAt still sort chronologically in both id shapes'
    );
    assert.equal(createdMs({ id: 'legacy-id-without-ms' } as any), 0, 'unknown shapes fall back to 0, never NaN');
});

test('sortNewestFirst is retained and is the exact inverse ordering key', async () => {
    const { sortNewestFirst } = await loadService();
    const list = [inv('a', 1000), inv('b', 2000), inv('c', 3000)];

    assert.deepEqual(sortNewestFirst(list).map((i: any) => i.id), ['c', 'b', 'a']);
});
