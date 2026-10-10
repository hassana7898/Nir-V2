import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 2 - PUT /api/invoices/order persistence.
//
// `reorderInvoicesInTransaction` takes the drizzle transaction as a parameter, so the exact
// behaviour can be proven without PostgreSQL by injecting a drizzle-shaped spy. Loading the
// service lazily keeps the `server/db` module (which reads DATABASE_URL) out of the test's
// import graph until a test actually needs it.
const loadService = () => import('../server/services/invoiceService');

/** Minimal drizzle-shaped spy for `tx.update(table).set(x).where(y).returning(z)` + `tx.insert().values()`. */
const makeTx = (rowsPerUpdate = 1) => {
    const ordinalSets: any[] = [];
    const clearSets: any[] = [];
    const whereArgs: any[] = [];
    let pendingSet: any = null;
    let pendingIsClear = false;

    const builder: any = {
        set(arg: any) {
            pendingSet = arg;
            pendingIsClear = !!arg && Object.prototype.hasOwnProperty.call(arg, 'sortOrder') && arg.sortOrder === null;
            return builder;
        },
        where(arg: any) {
            whereArgs.push(arg);
            if (pendingIsClear) clearSets.push(pendingSet);
            else ordinalSets.push(pendingSet);
            return builder;
        },
        returning() {
            return Promise.resolve(Array.from({ length: rowsPerUpdate }, () => ({ id: 'row' })));
        },
        // The clearing pass is awaited without `.returning()`, so the builder must be thenable.
        then(onFulfilled: any, onRejected: any) {
            return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
    };

    const auditRows: any[] = [];
    const insertBuilder: any = {
        values(arg: any) {
            auditRows.push(arg);
            return Promise.resolve();
        },
        then(onFulfilled: any, onRejected: any) {
            return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
    };

    return { tx: { update: () => builder, insert: () => insertBuilder }, ordinalSets, clearSets, whereArgs, auditRows };
};

test('assigns 0-based ordinals in the exact order received', async () => {
    const { reorderInvoicesInTransaction } = await loadService();
    const spy = makeTx(1);
    const updated = await reorderInvoicesInTransaction(spy.tx, 'entry', '2026-09-14', ['a', 'b', 'c']);

    assert.equal(updated, 3, 'every listed row was confirmed by Postgres');
    assert.deepEqual(spy.ordinalSets.map((s) => s.sortOrder), [0, 1, 2]);
    assert.equal(spy.clearSets.length, 1, 'exactly one "unlisted rows lose their ordinal" pass');
    assert.equal(spy.clearSets[0].sortOrder, null);
    assert.equal(spy.whereArgs.length, 4, '3 scoped ordinal writes + 1 bucket-wide clear');
    // Audit trail: the same transaction must also persist who/what/when.
    assert.equal(spy.auditRows.length, 1, 'one audit row per reorder');
    assert.equal(spy.auditRows[0].action, 'REORDER');
    assert.deepEqual(spy.auditRows[0].targetIds, ['a', 'b', 'c']);
    assert.equal(spy.auditRows[0].entity, 'invoice');
});

test('deduplicates repeated ids without shifting the ids after them', async () => {
    const { reorderInvoicesInTransaction } = await loadService();
    const spy = makeTx(1);
    await reorderInvoicesInTransaction(spy.tx, 'exit', '2026-09-13', ['x', 'y', 'x']);

    assert.deepEqual(spy.ordinalSets.map((s) => s.sortOrder), [0, 1], 'the duplicate id is written once');
});

test('empty and whitespace-only payloads are refused before any write', async () => {
    const { reorderInvoicesInTransaction } = await loadService();
    const spy = makeTx(1);

    assert.equal(await reorderInvoicesInTransaction(spy.tx, 'entry', '2026-09-14', []), 0);
    assert.equal(await reorderInvoicesInTransaction(spy.tx, 'entry', '2026-09-14', ['', '   ']), 0);
    assert.equal(spy.whereArgs.length, 0, 'no UPDATE is issued for an empty layout');
});

test('the bucket-wide clear always runs after the ordinal writes', async () => {
    const { reorderInvoicesInTransaction } = await loadService();
    const spy = makeTx(1);
    await reorderInvoicesInTransaction(spy.tx, 'entry', '2026-09-14', ['a', 'b']);

    assert.equal(spy.ordinalSets.length, 2, 'both ordinal writes happen first');
    assert.equal(spy.clearSets.length, 1, 'then the unlisted rows are cleared');
    assert.equal(spy.whereArgs.length, 3);
});

test('an id outside its (type,date) bucket is reported as not written', async () => {
    const { reorderInvoicesInTransaction } = await loadService();
    const spy = makeTx(0); // Postgres matched no row for this id+type+date scope
    const updated = await reorderInvoicesInTransaction(spy.tx, 'entry', '2026-09-14', ['ghost']);

    assert.equal(updated, 0, 'a stale/foreign id can never be counted as persisted');
    assert.equal(spy.ordinalSets.length, 1, 'the scoped UPDATE was still attempted');
});
