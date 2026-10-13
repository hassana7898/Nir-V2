import test from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';

// The merge is a DATABASE cascade, so it is proven against a real in-process PostgreSQL (PGlite)
// instead of mocks: schema, FK constraints, transactions and row locking all behave like production.
process.env.NODE_ENV = 'test';
process.env.PGLITE_TEST = 'true';

const { db } = await import('../server/db/index');
const schema = await import('../server/db/schema');
const { mergeFarmers, adoptInvoices, deleteBrood, restoreBrood } = await import('../server/services/farmerService');

await db.migrateDb();

// `drizzle/` mirrors only the INITIAL schema; the newer DDL is applied by the runtime migrator
// (server/db/migrate.ts). These statements are copied from there verbatim (all idempotent), so the
// test database has exactly the columns production has.
const runtimeDdl: string[] = [
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sort_order INTEGER',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status text DEFAULT \'active\'',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes text',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by text',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_by text',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS driver_id text',
    // Phase 2: driver-reported trip state (mirrors migrations/0006_mobile_trip_status.sql). Without
    // these the Drizzle insert below references columns the PGlite mirror does not have.
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status text',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status_at timestamp',
    'ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversal_of text',
    'ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS payload_hash text',
    'ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS status text DEFAULT \'success\'',
    `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        role TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        target_ids JSONB,
        summary JSONB,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action)',
];
for (const statement of runtimeDdl) await db.execute(sql.raw(statement));

const actor = { userId: 'u1', username: 'tester', role: 'ADMIN' };

const seed = async (options: { sharedBroodId?: boolean } = {}) => {
    await db.delete(schema.audit_logs);
    await db.delete(schema.invoices);
    await db.delete(schema.farmers);
    await db.delete(schema.products);

    await db.insert(schema.products).values({ id: 'prod1', name: 'دان مرغ گوشتی', type: 'finishedGood' });

    const now = new Date();
    await db.insert(schema.farmers).values([
        {
            id: 'farmerA',
            name: 'مرغدار الف',
            phone: '09120000000',
            broods: [{ id: options.sharedBroodId ? 'shared' : 'b1', startDate: '2026-01-01', chickCount: 10000, exceptionalFeed: [] }],
            isHidden: false,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'farmerB',
            name: 'مرغدار ب',
            phone: null,
            broods: [{ id: options.sharedBroodId ? 'shared' : 'b2', startDate: '2026-02-01', chickCount: 20000, exceptionalFeed: [] }],
            isHidden: false,
            createdAt: now,
            updatedAt: now,
        },
    ]);

    await db.insert(schema.invoices).values([
        { id: 'invA1', type: 'exit', date: '2026-01-05', productId: 'prod1', farmerId: 'farmerA', weight: '120', invoiceNumber: '1001', driverName: 'ر1', version: 1, createdAt: now, updatedAt: now },
        { id: 'invA2', type: 'exit', date: '2026-01-06', productId: 'prod1', farmerId: 'farmerA', weight: '80', invoiceNumber: '1002', driverName: 'ر2', version: 1, createdAt: now, updatedAt: now },
        { id: 'invB1', type: 'exit', date: '2026-02-02', productId: 'prod1', farmerId: 'farmerB', weight: '50', invoiceNumber: '2001', driverName: 'ر3', version: 1, createdAt: now, updatedAt: now },
    ]);
};

const invoice = async (id: string) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];
const farmer = async (id: string) => (await db.select().from(schema.farmers).where(eq(schema.farmers.id, id)))[0];

test('merge re-points EVERY invoice of the source to the target (the «ناشناس» fix)', async () => {
    await seed();
    const result = await mergeFarmers('farmerA', 'farmerB', actor);

    assert.equal(result.movedInvoices, 2, 'both source invoices must be reported as moved');
    assert.equal(result.movedBroods, 1);

    for (const id of ['invA1', 'invA2']) {
        const row = await invoice(id);
        assert.equal(row.farmerId, 'farmerB', `${id} must now belong to the surviving farmer`);
        assert.equal(row.version, 2, 'the version must be bumped so a stale client cannot overwrite it');
    }
    // Row integrity: only the FK changed - weights/numbers/drivers stay with their own row.
    const row = await invoice('invA1');
    assert.equal(row.weight, '120');
    assert.equal(row.invoiceNumber, '1001');
    assert.equal(row.driverName, 'ر1');
    assert.equal((await invoice('invB1')).farmerId, 'farmerB', 'invoices of the target are untouched');
});


test('merge transfers the brood periods (Period Management) without duplicates', async () => {
    await seed();
    await mergeFarmers('farmerA', 'farmerB', actor);

    const target = await farmer('farmerB');
    const broodIds = (target.broods || []).map((b: any) => b.id).sort();
    assert.deepEqual(broodIds, ['b1', 'b2'], 'both periods now belong to the surviving farmer');
    assert.equal(target.phone, '09120000000', 'contact info only the source had is preserved');
    assert.equal(target.isHidden, false);

    const source = await farmer('farmerA');
    assert.ok(source.deletedAt, 'the source row is SOFT-deleted: no FK can ever dangle');
    assert.deepEqual(source.broods, [], 'its periods are cleared so a re-merge cannot double-count');
    assert.equal(source.isHidden, true);
});

test('a brood id present on both sides is only counted once', async () => {
    await seed({ sharedBroodId: true });
    const result = await mergeFarmers('farmerA', 'farmerB', actor);

    const target = await farmer('farmerB');
    assert.equal((target.broods || []).length, 1, 'the shared period must not be duplicated');
    assert.equal(result.movedBroods, 0);
    assert.equal(result.skippedBroods, 1);
});

test('the merge is audited in the same transaction', async () => {
    await seed();
    await mergeFarmers('farmerA', 'farmerB', actor);

    const audits = await db.select().from(schema.audit_logs);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'MERGE');
    assert.equal(audits[0].entity, 'farmer');
    assert.equal(audits[0].username, 'tester');
    assert.deepEqual(audits[0].targetIds, ['farmerA', 'farmerB']);
});


test('a REJECTED merge changes absolutely nothing (atomicity)', async () => {
    await seed();
    // Target already deleted -> the transaction must abort before touching anything.
    await db.update(schema.farmers).set({ deletedAt: new Date() }).where(eq(schema.farmers.id, 'farmerB'));

    await assert.rejects(() => mergeFarmers('farmerA', 'farmerB', actor), /حذف شده/);

    assert.equal((await invoice('invA1')).farmerId, 'farmerA', 'invoices stay with the source');

test('merge DEDUPLICATES periods that are logically the same (no visual duplicates)', async () => {
    // Same starting invoice on both farmers = the same period, entered twice.
    const now = new Date();
    await db.delete(schema.audit_logs);
    await db.delete(schema.invoices);
    await db.delete(schema.farmers);
    await db.delete(schema.products);
    await db.insert(schema.products).values({ id: 'prod1', name: 'دان', type: 'finishedGood' });
    await db.insert(schema.farmers).values([
        { id: 'farmerA', name: 'مرغدار الف', phone: null, isHidden: false, createdAt: now, updatedAt: now,
          broods: [{ id: 'bA', startInvoiceId: 'shared-inv', startDate: '2026-01-01', chickCount: 10000, exceptionalFeed: [] }] },
        { id: 'farmerB', name: 'مرغدار ب', phone: null, isHidden: false, createdAt: now, updatedAt: now,
          broods: [
              { id: 'bB', startInvoiceId: 'shared-inv', startDate: '2026-01-01', chickCount: 12000, endDate: '2026-03-01', exceptionalFeed: [] },
              { id: 'bC', startDate: '2026-07-01', chickCount: 5000, exceptionalFeed: [] },
          ] },
    ]);

    const result = await mergeFarmers('farmerA', 'farmerB', actor);
    const target = await farmer('farmerB');
    const ids = (target.broods || []).map((b: any) => b.id).sort();

    assert.deepEqual(ids, ['bB', 'bC'], 'the duplicated period is folded into ONE entry');
    assert.equal(result.movedBroods, 0, 'the only transferable period already existed');
    assert.equal(result.skippedBroods, 1);

    const shared = (target.broods || []).find((b: any) => b.id === 'bB');
    assert.equal(shared.chickCount, 12000, 'the largest flock survived');
    assert.equal(shared.endDate, '2026-03-01');
});

test('brood soft delete keeps the period in the JSON with a deletedAt flag', async () => {
    await seed();
    const result = await deleteBrood('farmerA', 'b1', actor);

    const row = await farmer('farmerA');
    assert.equal((row.broods || []).length, 1, 'the period is NOT removed from the array');
    const period: any = (row.broods || [])[0];
    assert.ok(period.deletedAt, 'it carries an ISO deletedAt flag');
    assert.equal(new Date(period.deletedAt).toISOString(), period.deletedAt, 'the flag is a valid ISO timestamp');
    assert.equal(result.deletedCount, 1);
    assert.equal(result.activeCount, 0);
    assert.equal(row.version, 2, 'the optimistic-concurrency version is bumped');

    // The feeds/invoice links of the period survive the delete untouched.
    assert.ok(Array.isArray(period.exceptionalFeed));
    assert.equal(period.startDate, '2026-01-01');
});

test('a soft-deleted period can be restored, and the audit trail records both steps', async () => {
    await seed();
    await deleteBrood('farmerA', 'b1', actor);
    await restoreBrood('farmerA', 'b1', actor);

    const row = await farmer('farmerA');
    const period: any = (row.broods || [])[0];
    assert.equal(period.deletedAt, undefined, 'the flag is cleared');
    assert.equal(row.version, 3);

    const audits = await db.select().from(schema.audit_logs);
    assert.deepEqual(audits.map((a: any) => a.action).sort(), ['DELETE', 'RESTORE']);
    assert.ok(audits.every((a: any) => a.entity === 'brood'));
});

test('brood delete/restore target ONLY the given farmer (id collisions are harmless)', async () => {
    await seed();
    // Two farmers carrying the SAME period id (the old `brood_${Date.now()}` scheme could produce
    // this). The farmer-scoped API must only touch the one that was asked for.
    const sharedPeriod = [{ id: 'dup', startDate: '2026-01-01', chickCount: 1, exceptionalFeed: [] }];
    await db.update(schema.farmers).set({ broods: sharedPeriod }).where(eq(schema.farmers.id, 'farmerA'));
    await db.update(schema.farmers).set({ broods: sharedPeriod }).where(eq(schema.farmers.id, 'farmerB'));

    await deleteBrood('farmerA', 'dup', actor);

    const a: any = (await farmer('farmerA')).broods?.[0];
    const b: any = (await farmer('farmerB')).broods?.[0];
    assert.ok(a.deletedAt, 'the requested farmer period is deleted');
    assert.equal(b.deletedAt, undefined, 'the other farmer with the same id is untouched');
});

test('deleting / restoring an unknown period fails cleanly and changes nothing', async () => {
    await seed();
    await assert.rejects(() => deleteBrood('farmerA', 'nope', actor), /یافت نشد/);
    await assert.rejects(() => deleteBrood('ghost', 'b1', actor), /یافت نشد/);
    await assert.rejects(() => restoreBrood('farmerA', 'nope', actor), /یافت نشد/);

    const row = await farmer('farmerA');
    assert.equal((row.broods || []).length, 1);
    assert.equal((row.broods as any)[0].deletedAt, undefined);
    assert.equal(row.version, 1, 'a failed mutation must not bump the version');
    assert.equal((await db.select().from(schema.audit_logs)).length, 0);
});

    assert.equal((await invoice('invA2')).farmerId, 'farmerA');
    const source = await farmer('farmerA');
    assert.equal(source.deletedAt, null, 'the source is NOT retired');
    assert.equal((source.broods || []).length, 1, 'its periods are intact');
    assert.equal((await db.select().from(schema.audit_logs)).length, 0, 'no audit row is written on failure');
});

test('merging a farmer into itself, or with unknown ids, is refused', async () => {
    await seed();
    await assert.rejects(() => mergeFarmers('farmerA', 'farmerA', actor), /یکسان/);
    await assert.rejects(() => mergeFarmers('nope', 'farmerB', actor), /یافت نشد/);
    await assert.rejects(() => mergeFarmers('farmerA', 'nope', actor), /یافت نشد/);
    assert.equal((await invoice('invA1')).farmerId, 'farmerA');
});

test('re-running a merge is harmless (the retired source has no invoices and no periods)', async () => {
    await seed();
    await mergeFarmers('farmerA', 'farmerB', actor);
    const second = await mergeFarmers('farmerA', 'farmerB', actor);

    assert.equal(second.movedInvoices, 0);
    assert.equal(second.movedBroods, 0);
    const target = await farmer('farmerB');
    assert.deepEqual((target.broods || []).map((b: any) => b.id).sort(), ['b1', 'b2'], 'periods are not duplicated');
});

test('adoptInvoices re-links orphaned EXIT invoices only', async () => {
    await seed();
    const now = new Date();
    await db.insert(schema.invoices).values([
        { id: 'orphanExit', type: 'exit', date: '2026-01-09', productId: 'prod1', farmerId: null, weight: '33', invoiceNumber: '3001', version: 1, createdAt: now, updatedAt: now },
        { id: 'entryRow', type: 'entry', date: '2026-01-09', productId: 'prod1', sellerName: 'فروشنده', scaleWeight: '10', version: 1, createdAt: now, updatedAt: now },
    ]);

    const result = await adoptInvoices('farmerB', ['orphanExit', 'entryRow'], actor);

    assert.equal(result.movedInvoices, 1, 'an entry invoice can never carry a farmer');
    assert.equal((await invoice('orphanExit')).farmerId, 'farmerB');
    assert.equal((await invoice('entryRow')).farmerId, null);
    assert.equal((await db.select().from(schema.audit_logs)).length, 1);
});
