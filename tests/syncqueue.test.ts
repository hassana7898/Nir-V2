import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB,
  enqueueMutation,
  getPendingMutations,
  getSyncQueueCount,
  moveToFailedMutations,
  getFailedMutationList,
  getFailedMutationCount,
  requeueFailedMutation,
  discardFailedMutation,
  clearFailedMutations,
  MAX_SYNC_RETRIES,
} from '../services/dbStore';

// Rule: "Failed validations go to failedMutations queue, NOT the active syncQueue."
// A permanently failing mutation must never keep blocking every other change.

const reset = async () => {
  const db = await initDB();
  await db.clear('syncQueue');
  await db.clear('failedMutations');
};

const enqueue = (id: string, extra: Record<string, unknown> = {}) =>
  enqueueMutation({ id, entityType: 'poultryAppInvoices', action: 'create', payload: { id, ...extra } } as any);

test('a permanently failed validation leaves the active queue and lands in failedMutations', async () => {
  await reset();
  await enqueue('op-stock');
  await enqueue('op-ok');
  assert.equal(await getSyncQueueCount(), 2);

  await moveToFailedMutations('op-stock', { code: 'INSUFFICIENT_STOCK', message: 'موجودی کافی نیست' });

  assert.equal(await getSyncQueueCount(), 1, 'the dead letter must leave syncQueue');
  assert.equal(await getFailedMutationCount(), 1, 'the dead letter must exist in failedMutations');

  const remaining = await getPendingMutations();
  assert.deepEqual(remaining.map((m) => m.id), ['op-ok'], 'untouched mutations stay retryable');

  const [dead] = await getFailedMutationList();
  assert.equal(dead.id, 'op-stock');
  assert.equal(dead.status, 'failed');
  assert.equal(dead.failureCode, 'INSUFFICIENT_STOCK');
  assert.ok((dead.failedAt ?? 0) > 0, 'failedAt timestamp recorded');
});

test('a dead letter no longer blocks the queue (the old stuck-mutation bug)', async () => {
  await reset();
  await enqueue('op-1');
  await moveToFailedMutations('op-1', { code: 'VALIDATION_FAILED' });
  // hydration is gated on an EMPTY active queue - it must now be empty
  assert.equal(await getSyncQueueCount(), 0);
  assert.equal(await getFailedMutationCount(), 1);
});

test('requeue moves a dead letter back with retries reset', async () => {
  await reset();
  await enqueue('op-retry');
  await moveToFailedMutations('op-retry', { code: 'CONFLICT' });

  const ok = await requeueFailedMutation('op-retry');
  assert.equal(ok, true);
  assert.equal(await getFailedMutationCount(), 0);
  const pending = await getPendingMutations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');
  assert.equal(pending[0].retryCount, 0, 'retry budget is reset');
});

test('discard and clear remove dead letters without touching the active queue', async () => {
  await reset();
  await enqueue('op-active');
  await enqueue('op-dead-1');
  await enqueue('op-dead-2');
  await moveToFailedMutations('op-dead-1', { code: 'UNKNOWN_FARMER' });
  await moveToFailedMutations('op-dead-2', { code: 'UNKNOWN_FARMER' });
  assert.equal(await getFailedMutationCount(), 2);

  await discardFailedMutation('op-dead-1');
  assert.equal(await getFailedMutationCount(), 1);

  await clearFailedMutations();
  assert.equal(await getFailedMutationCount(), 0);
  assert.equal(await getSyncQueueCount(), 1, 'the retryable mutation is untouched');
});

test('the retry cap is bounded and documented', () => {
  assert.equal(MAX_SYNC_RETRIES, 5);
});
