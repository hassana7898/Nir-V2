import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { farmers, invoices } from '../db/schema';
import { recordAudit, type AuditActor } from './auditService';
import { mergeBroods, softDeleteBrood, restoreBroodInList, isBroodDeleted } from '../../shared/broodMerge';

/**
 * Farmer domain writes (merge / adopt).
 *
 * DATA-INTEGRITY CONTRACT (the reason this file exists):
 *  - a merge NEVER hard-deletes a farmer row. The invoice FK `invoices.farmer_id -> farmers.id`
 *    must always resolve, so the source row is soft-deleted (deleted_at) and kept forever.
 *    The old client-side merge simply dropped the farmer locally, which is what made every
 *    historical exit invoice render as «ناشناس».
 *  - the whole cascade runs inside ONE transaction: re-point the invoices, move the brood
 *    periods, retire the source, write the audit row. If any step fails, nothing is applied.
 *  - the invoices' `version` is bumped so a stale client holding `expectedVersion` cannot
 *    silently overwrite the re-pointed rows, and every change is attributable in audit_logs.
 */

/** Error carrying an API-contract code so the route layer can answer precisely. */
const contractError = (code: string, message: string, status = 422) => {
  const error = new Error(message);
  (error as any).code = code;
  (error as any).status = status;
  return error;
};

type FarmerRow = typeof farmers.$inferSelect;

const asBroodArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export interface MergeResult {
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  movedInvoices: number;
  movedBroods: number;
  skippedBroods: number;
}


/**
 * Merge `sourceId` into `targetId` inside a single transaction.
 *
 * Order matters:
 *   1. lock both farmer rows FOR UPDATE (deterministic id order -> no deadlocks)
 *   2. re-point EVERY invoice of the source to the target (the cascade that was missing)
 *   3. transfer the brood periods (Period Management) without duplicating ids
 *   4. keep contact info that only the source had
 *   5. SOFT-delete the source and clear its periods (a re-merge can never double-count)
 *   6. audit row in the same transaction
 */
export const mergeFarmersInTransaction = async (
  tx: any,
  sourceId: string,
  targetId: string,
  actor?: AuditActor,
): Promise<MergeResult> => {
  const source = String(sourceId || '').trim();
  const target = String(targetId || '').trim();

  if (!source || !target) throw contractError('VALIDATION_FAILED', 'انتخاب مرغدار مبدا و مقصد الزامی است.', 400);
  if (source === target) throw contractError('VALIDATION_FAILED', 'مرغدار مبدا و مقصد نمی‌توانند یکسان باشند.', 400);

  // (1) Lock both rows. Sorted ids keep concurrent merges (A->B and B->A) deadlock-free.
  const locked: FarmerRow[] = await tx
    .select()
    .from(farmers)
    .where(inArray(farmers.id, [source, target].sort()))
    .for('update');

  const sourceFarmer = locked.find((f) => f.id === source);
  const targetFarmer = locked.find((f) => f.id === target);

  if (!sourceFarmer) throw contractError('NOT_FOUND', 'مرغدار مبدا یافت نشد.', 404);
  if (!targetFarmer) throw contractError('NOT_FOUND', 'مرغدار مقصد یافت نشد.', 404);
  if (targetFarmer.deletedAt) throw contractError('VALIDATION_FAILED', 'مرغدار مقصد حذف شده است؛ ابتدا آن را بازیابی کنید.', 422);

  // (2) THE CASCADE. Every historical invoice (and therefore every report, weight and ledger
  //     figure) now belongs to the surviving farmer. Only the FK column changes, so each row
  //     keeps its own weights/dates/drivers - nothing can detach from its parent record.
  const movedRows: { id: string }[] = await tx
    .update(invoices)
    .set({ farmerId: target, updatedAt: new Date(), version: sql`${invoices.version} + 1` })
    .where(eq(invoices.farmerId, source))
    .returning({ id: invoices.id });

  // (3) Period Management: transfer the broods. `mergeBroods` DEEPLY de-duplicates them - periods
  //     with the same id OR the same business identity (start invoice / start date + flock size)
  //     are combined into one logical entry, so the UI can never show a duplicated period and the
  //     quota/feed math is never double-counted.
  const targetBroods = asBroodArray(targetFarmer.broods);
  const sourceBroods = asBroodArray(sourceFarmer.broods);
  const mergedBroods = mergeBroods(targetBroods, sourceBroods);
  const movedBroods = mergedBroods.length - targetBroods.length;
  const skippedBroods = sourceBroods.length - movedBroods;

  // (4) Keep what would otherwise be lost with the retired row.
  const phone = targetFarmer.phone && String(targetFarmer.phone).trim() ? targetFarmer.phone : (sourceFarmer.phone || null);

  await tx
    .update(farmers)
    .set({ broods: mergedBroods, phone, isHidden: false, updatedAt: new Date(), version: sql`${farmers.version} + 1` })
    .where(eq(farmers.id, target));

  // (5) Retire the source: soft delete + cleared periods. The row is never removed, so no FK
  //     (invoice, audit or otherwise) can ever dangle, and a wrong merge stays auditable.
  await tx
    .update(farmers)
    .set({ deletedAt: new Date(), isHidden: true, broods: [], updatedAt: new Date(), version: sql`${farmers.version} + 1` })
    .where(eq(farmers.id, source));

  // (6) Audit trail, atomic with the change.
  await recordAudit(tx, actor, {
    action: 'MERGE',
    entity: 'farmer',
    targetIds: [source, target],
    context: {
      sourceId: source,
      targetId: target,
      sourceName: sourceFarmer.name,
      targetName: targetFarmer.name,
      movedInvoices: movedRows.length,
      movedBroods,
      skippedBroods,
      invoiceIds: movedRows.slice(0, 200).map((r) => r.id),
    },
    details: `ادغام مرغدار «${sourceFarmer.name}» در «${targetFarmer.name}» — ${movedRows.length} حواله و ${movedBroods} دوره منتقل شد`,
  });

  return {
    sourceId: source,
    targetId: target,
    sourceName: sourceFarmer.name,
    targetName: targetFarmer.name,
    movedInvoices: movedRows.length,
    movedBroods,
    skippedBroods,
  };
};

/** Public wrapper: one transaction for the whole merge. */
export const mergeFarmers = async (sourceId: string, targetId: string, actor?: AuditActor): Promise<MergeResult> =>
  db.transaction(async (tx: any) => mergeFarmersInTransaction(tx, sourceId, targetId, actor));


export interface AdoptResult {
  targetId: string;
  targetName: string;
  movedInvoices: number;
}

/**
 * Adoption / re-linking: attach a set of orphaned EXIT invoices to a farmer.
 *
 * This is the repair tool for rows that lost their owner before this fix (they point at a
 * soft-deleted farmer, so the UI could only show «ناشناس»). Only `type='exit'` rows can carry a
 * farmer, so entry invoices are ignored by design.
 */
export const adoptInvoicesInTransaction = async (
  tx: any,
  targetId: string,
  invoiceIds: string[],
  actor?: AuditActor,
): Promise<AdoptResult> => {
  const target = String(targetId || '').trim();
  const ids = Array.from(new Set((invoiceIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!target) throw contractError('VALIDATION_FAILED', 'انتخاب مرغدار مقصد الزامی است.', 400);
  if (ids.length === 0) throw contractError('VALIDATION_FAILED', 'هیچ حواله‌ای برای انتساب انتخاب نشده است.', 400);

  const targetFarmer = (await tx.select().from(farmers).where(eq(farmers.id, target)).limit(1).for('update'))[0];
  if (!targetFarmer || targetFarmer.deletedAt) throw contractError('NOT_FOUND', 'مرغدار مقصد یافت نشد.', 404);

  const movedRows: { id: string }[] = await tx
    .update(invoices)
    .set({ farmerId: target, updatedAt: new Date(), version: sql`${invoices.version} + 1` })
    .where(and(inArray(invoices.id, ids), eq(invoices.type, 'exit')))
    .returning({ id: invoices.id });

  await recordAudit(tx, actor, {
    action: 'UPDATE',
    entity: 'farmer',
    targetIds: [target, ...movedRows.slice(0, 200).map((r) => r.id)],
    context: { adoptedInvoices: movedRows.length, requested: ids.length, farmerName: targetFarmer.name },
    details: `انتساب ${movedRows.length} حواله خروج بدون مرغدار به «${targetFarmer.name}»`,
  });

  return { targetId: target, targetName: targetFarmer.name, movedInvoices: movedRows.length };
};

export const adoptInvoices = async (targetId: string, invoiceIds: string[], actor?: AuditActor): Promise<AdoptResult> =>
  db.transaction(async (tx: any) => adoptInvoicesInTransaction(tx, targetId, invoiceIds, actor));

// ---------------------------------------------------------------- brood soft delete / restore

export interface BroodMutationResult {
  farmerId: string;
  broodId: string;
  deletedAt: string | null;
  /** Periods still awaiting the recycle bin (number of soft-deleted periods after the change). */
  deletedCount: number;
  activeCount: number;
}

/** Load one farmer with a row lock, or fail with a precise contract error. */
const lockFarmer = async (tx: any, farmerId: string): Promise<FarmerRow> => {
  const id = String(farmerId || '').trim();
  if (!id) throw contractError('VALIDATION_FAILED', 'شناسه مرغدار الزامی است.', 400);
  const row = (await tx.select().from(farmers).where(eq(farmers.id, id)).limit(1).for('update'))[0];
  if (!row) throw contractError('NOT_FOUND', 'مرغدار یافت نشد.', 404);
  return row;
};

const mutateBroods = async (
  tx: any,
  farmerId: string,
  broodId: string,
  mutate: (broods: any[]) => any[],
  actor: AuditActor | undefined,
  mode: 'delete' | 'restore',
): Promise<BroodMutationResult> => {
  const target = String(broodId || '').trim();
  if (!target) throw contractError('VALIDATION_FAILED', 'شناسه دوره الزامی است.', 400);

  const farmer = await lockFarmer(tx, farmerId);
  const broods = asBroodArray(farmer.broods);
  const exists = broods.some((brood: any) => brood?.id === target);
  if (!exists) throw contractError('NOT_FOUND', 'دوره مورد نظر روی این مرغدار یافت نشد.', 404);

  const nextBroods = mutate(broods);
  const changed = nextBroods.find((brood: any) => brood?.id === target);

  await tx
    .update(farmers)
    .set({ broods: nextBroods, updatedAt: new Date(), version: sql`${farmers.version} + 1` })
    .where(eq(farmers.id, farmer.id));

  const activeCount = nextBroods.filter((brood: any) => !isBroodDeleted(brood)).length;
  const deletedCount = nextBroods.length - activeCount;

  await recordAudit(tx, actor, {
    action: mode === 'delete' ? 'DELETE' : 'RESTORE',
    entity: 'brood',
    targetIds: [farmer.id, target],
    context: {
      farmerId: farmer.id,
      farmerName: farmer.name,
      broodId: target,
      broodStartDate: changed?.startDate ?? null,
      softDelete: mode === 'delete',
      activeCount,
      deletedCount,
    },
    details: mode === 'delete'
      ? `حذف نرم دوره ${changed?.startDate || ''} از مرغدار «${farmer.name}» (قابل بازیابی)`
      : `بازیابی دوره ${changed?.startDate || ''} برای مرغدار «${farmer.name}»`,
  });

  return {
    farmerId: farmer.id,
    broodId: target,
    deletedAt: mode === 'delete' ? String(changed?.deletedAt || '') : null,
    deletedCount,
    activeCount,
  };
};

/**
 * SOFT delete a period: the JSON object stays in the array with a `deletedAt` ISO flag.
 * Nothing is ever physically removed, so the history (and its feeds/invoice links) is preserved
 * and the user can restore it from the recycle bin.
 */
export const deleteBroodInTransaction = async (tx: any, farmerId: string, broodId: string, actor?: AuditActor) => {
  const deletedAt = new Date().toISOString();
  return mutateBroods(tx, farmerId, broodId, (broods) => softDeleteBrood<any>(broods, String(broodId).trim(), deletedAt), actor, 'delete');
};

export const restoreBroodInTransaction = async (tx: any, farmerId: string, broodId: string, actor?: AuditActor) =>
  mutateBroods(tx, farmerId, broodId, (broods) => restoreBroodInList<any>(broods, String(broodId).trim()), actor, 'restore');

export const deleteBrood = async (farmerId: string, broodId: string, actor?: AuditActor): Promise<BroodMutationResult> =>
  db.transaction(async (tx: any) => deleteBroodInTransaction(tx, farmerId, broodId, actor));

export const restoreBrood = async (farmerId: string, broodId: string, actor?: AuditActor): Promise<BroodMutationResult> =>
  db.transaction(async (tx: any) => restoreBroodInTransaction(tx, farmerId, broodId, actor));
