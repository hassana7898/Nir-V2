import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { invoices, inventory_transactions, products, farmers, weighbridge_records } from '../db/schema';
import { getInventoryStockByDate, recordInventoryTransaction, createReversingTransaction, recalculateLedgerBalances, recalculateProductStock } from './inventoryService';
import { recordAudit, buildInvoiceDiff, describeChanges, type AuditActor } from './auditService';
import { farmerNameKey, normalizePersianText } from '../../shared/persianText';

export interface InvoiceInput {
  id?: string;
  expectedVersion?: number;
  type: 'entry' | 'exit';
  date: string;
  productId: string;
  productName?: string;
  driverName?: string;
  sellerName?: string;
  billWeight?: number | string;
  scaleWeight?: number | string;
  factory?: string;
  billNumber?: string;
  origin?: string;
  transportCost?: number | string;
  driverPhone?: string;
  driverIBAN?: string;
  wastage?: number | string;
  farmerId?: string;
  farmerName?: string;
  weight?: number | string;
  invoiceNumber?: string;
  productVariant?: string;
  isCrumble?: boolean;
  isPageBreak?: boolean;
  notes?: string;
}

/** Error carrying an API-contract code so the route layer can answer precisely. */
const contractError = (code: string, message: string, status = 422, extra: Record<string, any> = {}) => {
  const error = new Error(message);
  (error as any).code = code;
  (error as any).status = status;
  Object.assign(error, extra);
  return error;
};

/**
 * The product catalogue is client-owned configuration. When an invoice references a
 * product the server has never seen (fresh install, or a product added offline), the
 * insert would fail on `invoices_product_id_products_id_fk`. Provision the parent row
 * inside the same transaction so referential integrity is satisfied - the invoice's own
 * validation (type, quantity, stock) is unchanged.
 */
const ensureProductExists = async (tx: any, productId: string, productName?: string, invoiceType?: 'entry' | 'exit') => {
  if (!productId) throw contractError('VALIDATION_FAILED', 'شناسه محصول الزامی است.', 400);
  const existing = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (existing.length > 0) return;

  await tx.insert(products).values({
    id: productId,
    name: productName || productId,
    type: invoiceType === 'exit' ? 'finishedGood' : 'rawMaterial',
    unit: 'kg',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  console.log(`[NIR] auto-provisioned product "${productId}" referenced by invoice`);
};

/**
 * Farmers are real business entities (with broods), so they are not invented silently:
 * they are provisioned only when the client supplies a name; otherwise the caller gets a
 * precise, actionable error instead of a raw foreign-key failure.
 */
/**
 * Farmers are real business entities (with broods), so they are not invented silently:
 * they are provisioned only when the client supplies a name; otherwise the caller gets a
 * precise, actionable error instead of a raw foreign-key failure.
 *
 * DUPLICATE PREVENTION (returns the id that must be written on the invoice):
 * a farmer created offline can arrive with a local id while the same human already exists under
 * a differently-spelled name (Arabic ي/ك, extra spaces, ZWNJ...). Instead of inserting a twin row
 * - which splits that farmer's history and breaks Period Management - the existing row is reused.
 */
const ensureFarmerExists = async (tx: any, farmerId: string, farmerName?: string): Promise<string> => {
  if (!farmerId && !farmerName) {
    throw contractError('UNKNOWN_FARMER', 'برای حواله خروج انتخاب مرغدار الزامی است.', 422);
  }
  if (farmerId) {
    const existing = await tx.select({ id: farmers.id }).from(farmers).where(eq(farmers.id, farmerId)).limit(1);
    if (existing.length > 0) return farmerId;
  }

  const cleanName = normalizePersianText(farmerName);
  if (cleanName) {
    // Same human under another id? Reuse the existing row (normalised name + compatible phone).
    const live = await tx.select().from(farmers).where(isNull(farmers.deletedAt));
    const key = farmerNameKey(cleanName);
    const match = live.find((f: any) => f.name && farmerNameKey(f.name) === key);
    if (match) {
      console.log(`[NIR] reusing farmer "${match.name}" (${match.id}) instead of creating duplicate "${cleanName}"`);
      return match.id;
    }

    await tx.insert(farmers).values({
      id: farmerId || randomUUID(),
      name: cleanName,
      broods: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
    console.log(`[NIR] auto-provisioned farmer "${farmerId}" referenced by invoice`);
    return farmerId;
  }

  throw contractError('UNKNOWN_FARMER', 'مرغدار انتخاب‌شده در سرور یافت نشد. لطفاً ابتدا مرغدار را ذخیره کنید و سپس حواله را ثبت کنید.', 422);
};

/**
 * Negative inventory is ALLOWED by design: exits are frequently logged before the matching
 * production/entry in this business. Each movement still requires a positive quantity, but the
 * running stock may legitimately fall below zero, so the old hard block was removed.
 * Set ALLOW_NEGATIVE_INVENTORY to false to restore the previous strict behaviour.
 */
const ALLOW_NEGATIVE_INVENTORY = true;
const ensureSufficientStock = async (tx: any, productId: string, date: string, quantity: number) => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw contractError('VALIDATION_FAILED', 'مقدار وزن حواله باید بزرگ‌تر از صفر باشد.', 400);
  }
  const stock = await getInventoryStockByDate(date, tx);
  const available = stock[productId] || 0;
  if (!ALLOW_NEGATIVE_INVENTORY && available < quantity) {
    throw contractError(
      'INSUFFICIENT_STOCK',
      `موجودی کافی نیست. موجودی فعلی: ${available} کیلوگرم، مقدار درخواستی: ${quantity} کیلوگرم`,
      422,
      { available, requested: quantity, productId }
    );
  }
};

export const createInvoiceWithTransaction = async (data: InvoiceInput, actor?: AuditActor): Promise<string> =>
  db.transaction(async (tx: any) => createInvoiceInTransaction(tx, data, actor));

export const createInvoiceInTransaction = async (tx: any, data: InvoiceInput, actor?: AuditActor): Promise<string> => {
  const id = data.id || randomUUID();

  await ensureProductExists(tx, data.productId, data.productName, data.type);

  if (data.type === 'entry') {
    const qty = Number(data.scaleWeight || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw contractError('VALIDATION_FAILED', 'وزن باسکول حواله ورود باید بزرگ‌تر از صفر باشد.', 400);
  }
  // Resolve the farmer BEFORE the insert: an offline-created farmer id may resolve to an existing
  // row with the same normalised name, and the invoice must point at the surviving row.
  let resolvedFarmerId: string | null = data.farmerId || null;
  if (data.type === 'exit') {
    resolvedFarmerId = await ensureFarmerExists(tx, String(data.farmerId || ''), data.farmerName);
    await ensureSufficientStock(tx, data.productId, data.date, Number(data.weight || 0));
  }

  // The entry wastage (افت) is DERIVED from the two weights, never trusted from the payload: an
  // offline/queued client can still hold a stale `wastage` (e.g. 0 left over from "save & add
  // another"), which used to be persisted verbatim and silently corrupted the row.
  const resolvedWastage = data.type === 'entry' && data.billWeight !== undefined && data.scaleWeight !== undefined
    ? String(Number(data.scaleWeight || 0) - Number(data.billWeight || 0))
    : (data.wastage !== undefined ? String(data.wastage) : null);

  await tx.insert(invoices).values({
    id,
    type: data.type,
    date: data.date,
    productId: data.productId,
    productName: data.productName || null,
    driverName: data.driverName || null,
    sellerName: data.sellerName || null,
    billWeight: data.billWeight !== undefined ? String(data.billWeight) : null,
    scaleWeight: data.scaleWeight !== undefined ? String(data.scaleWeight) : null,
    factory: data.factory || null,
    billNumber: data.billNumber || null,
    origin: data.origin || null,
    transportCost: data.transportCost !== undefined ? String(data.transportCost) : null,
    driverPhone: data.driverPhone || null,
    driverIBAN: data.driverIBAN || null,
    wastage: resolvedWastage,
    farmerId: resolvedFarmerId,
    weight: data.weight !== undefined ? String(data.weight) : null,
    invoiceNumber: data.invoiceNumber || null,
    productVariant: data.productVariant || null,
    isCrumble: Boolean(data.isCrumble),
    isPageBreak: Boolean(data.isPageBreak),
    notes: data?.notes === undefined || data?.notes === null ? null : String(data.notes),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  if (data.type === 'entry') {
    await recordInventoryTransaction(tx, { date: data.date, productId: data.productId, type: 'entry', quantity: Number(data.scaleWeight), referenceType: 'invoice', referenceId: id, notes: `حواله ورود از ${data.sellerName || 'نامشخص'} - بارنامه ${data.billNumber || '-'}` });
  } else if (data.type === 'exit') {
    const qty = Number(data.weight);
    await recordInventoryTransaction(tx, { date: data.date, productId: data.productId, type: 'exit', quantity: -qty, referenceType: 'invoice', referenceId: id, notes: `حواله خروج به مرغدار - فاکتور ${data.invoiceNumber || '-'}` });
  }

  // Audit trail, inside the same transaction: it cannot be skipped by the client and always
  // names the authenticated user.
  await recordAudit(tx, actor, {
    action: 'CREATE',
    entity: 'invoice',
    targetIds: [id],
    context: {
      type: data.type,
      date: data.date,
      productId: data.productId,
      weight: data.type === 'entry' ? data.scaleWeight : data.weight,
      farmerId: data.farmerId || null,
    },
    details: `ایجاد حواله ${data.type === 'entry' ? 'ورود' : 'خروج'} — ${data.productName || data.productId} (تاریخ ${data.date})`,
  });

  return id;
};

export const updateInvoiceWithTransaction = async (id: string, data: Partial<InvoiceInput>, actor?: AuditActor): Promise<void> => {
  await db.transaction(async (tx: any) => updateInvoiceInTransaction(tx, id, data, actor));
};

export const updateInvoiceInTransaction = async (tx: any, id: string, data: Partial<InvoiceInput>, actor?: AuditActor): Promise<void> => {
  const existing = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!existing.length) return;
  const prev = existing[0];

  if (data.expectedVersion !== undefined && prev.version !== data.expectedVersion) {
    throw contractError(
      'CONFLICT',
      'این رکورد توسط کاربر دیگری تغییر کرده است. لطفاً صفحه را بروزرسانی کنید.',
      409,
      { authoritativeRecord: prev }
    );
  }

  const updatePayload: any = { updatedAt: new Date(), version: prev.version + 1 };
  for (const key of ['date','productId','productName','driverName','sellerName','factory','billNumber','origin','driverPhone','driverIBAN','farmerId','invoiceNumber','productVariant'] as const) {
    if ((data as any)[key] !== undefined) updatePayload[key] = (data as any)[key];
  }
  for (const key of ['billWeight','scaleWeight','transportCost','wastage','weight'] as const) {
    if ((data as any)[key] !== undefined) updatePayload[key] = String((data as any)[key]);
  }
  if (data.isCrumble !== undefined) updatePayload.isCrumble = Boolean(data.isCrumble);
  if (data.isPageBreak !== undefined) updatePayload.isPageBreak = Boolean(data.isPageBreak);
  if (data.notes !== undefined) updatePayload.notes = data.notes === null ? null : String(data.notes);

  const invoiceType = data.type || prev.type;
  const invDate = data.date || prev.date;
  const productId = data.productId || prev.productId;
  const farmerId = data.farmerId !== undefined ? data.farmerId : prev.farmerId;

  // A manual position only means something INSIDE its own (type, date) bucket. When an invoice
  // moves to another day, its ordinal from the old bucket must be dropped - otherwise the stale
  // position would fight the destination day's layout (the client renders ordinal-less rows
  // newest-first, which is exactly the intended "new arrival" behaviour).
  if (data.date !== undefined && String(data.date) !== String(prev.date)) {
    updatePayload.sortOrder = null;
  }

  await ensureProductExists(tx, productId, data.productName || prev.productName || undefined, invoiceType);

  await createReversingTransaction(tx, id);

  if (invoiceType === 'entry') {
    const qty = Number(data.scaleWeight !== undefined ? data.scaleWeight : prev.scaleWeight || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw contractError('VALIDATION_FAILED', 'وزن حواله نامعتبر است.', 400);
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'entry', quantity: qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش حواله ورود - بارنامه ${data.billNumber || prev.billNumber || '-'}` });
  } else if (invoiceType === 'exit') {
    const qty = Number(data.weight !== undefined ? data.weight : prev.weight || 0);
    if (farmerId) {
      // Same duplicate-prevention as the create path: the invoice must reference the surviving
      // (normalised-name) farmer row, never a twin that happens to share the name.
      const resolvedFarmerId = await ensureFarmerExists(tx, String(farmerId), data.farmerName);
      if (resolvedFarmerId !== farmerId) updatePayload.farmerId = resolvedFarmerId;
    }
    await ensureSufficientStock(tx, productId, invDate, qty);
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'exit', quantity: -qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش حواله خروج - فاکتور ${data.invoiceNumber || prev.invoiceNumber || '-'}` });
  }

  // Wastage (افت) stays DERIVED on edits too: whenever both weights are known for an entry, the
  // stored value is recomputed so a stale payload can never persist a wrong deduction.
  if (invoiceType === 'entry') {
    const bill = data.billWeight !== undefined ? Number(data.billWeight) : Number(prev.billWeight || 0);
    const scale = data.scaleWeight !== undefined ? Number(data.scaleWeight) : Number(prev.scaleWeight || 0);
    if (Number.isFinite(bill) && Number.isFinite(scale)) updatePayload.wastage = String(scale - bill);
  }

  // Audit trail: the field-level before/after of this edit (weights, date, farmer, ...).
  const changes = buildInvoiceDiff(prev, data as any);
  await recordAudit(tx, actor, {
    action: 'UPDATE',
    entity: 'invoice',
    targetIds: [id],
    changes,
    context: { type: invoiceType, date: invDate, previousDate: prev.date, version: updatePayload.version },
    details: changes.length
      ? `ویرایش حواله ${invoiceType === 'entry' ? 'ورود' : 'خروج'} (تاریخ ${invDate}) — ${describeChanges(changes)}`
      : `ویرایش حواله ${invoiceType === 'entry' ? 'ورود' : 'خروج'} بدون تغییر مقدار (تاریخ ${invDate})`,
  });

  await tx.update(invoices).set(updatePayload).where(eq(invoices.id, id));
};

export const deleteInvoiceWithTransaction = async (id: string, actor?: AuditActor): Promise<void> => {
  await db.transaction(async (tx: any) => {
    await deleteInvoiceInTransaction(tx, id, actor);
  });
};

export const deleteInvoiceInTransaction = async (tx: any, id: string, actor?: AuditActor): Promise<void> => {
  // Snapshot the key facts BEFORE the soft delete, so the audit row can name what was removed.
  const snapshot = await tx
    .select({
      id: invoices.id,
      type: invoices.type,
      date: invoices.date,
      productId: invoices.productId,
      productName: invoices.productName,
      weight: invoices.weight,
      scaleWeight: invoices.scaleWeight,
      invoiceNumber: invoices.invoiceNumber,
      billNumber: invoices.billNumber,
    })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  const row: any = snapshot?.[0] || null;

  await tx.update(invoices).set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id));
  await createReversingTransaction(tx, id);
  // Free any weighbridge ticket that pointed at this invoice: otherwise the weighbridge screen kept
  // showing «✓ متصل / تخصیص داده شده» for a remittance the operator had just deleted.
  await tx
    .update(weighbridge_records)
    .set({ status: 'unmapped', mappedRemittanceId: null, previousWeightValue: null, updatedAt: new Date() })
    .where(eq(weighbridge_records.mappedRemittanceId, id));

  const qty = row && row.type === 'exit' ? row.weight : row?.scaleWeight;
  await recordAudit(tx, actor, {
    action: 'DELETE',
    entity: 'invoice',
    targetIds: [id],
    context: {
      type: row?.type ?? null,
      date: row?.date ?? null,
      productId: row?.productId ?? null,
      invoiceNumber: row?.invoiceNumber ?? null,
      billNumber: row?.billNumber ?? null,
    },
    details: row
      ? `حذف حواله ${row.type === 'entry' ? 'ورود' : 'خروج'} — ${row.productName || row.productId} (تاریخ ${row.date}${qty ? `، مقدار ${qty}` : ''})`
      : `حذف حواله ${id}`,
  });
};

export const bulkMoveInvoicesWithTransaction = async (ids: string[], targetDate: string, actor?: AuditActor): Promise<number> => {
  return db.transaction(async (tx: any) => {
    let count = 0;
    const touchedProducts = new Set<string>();
    for (const id of ids) {
      await tx.update(invoices).set({ date: targetDate, sortOrder: null, updatedAt: new Date() }).where(eq(invoices.id, id));
      const affected = await tx
        .select({ productId: inventory_transactions.productId })
        .from(inventory_transactions)
        .where(eq(inventory_transactions.referenceId, id));
      affected.forEach((r: any) => r.productId && touchedProducts.add(String(r.productId)));
      await tx.update(inventory_transactions).set({ date: targetDate, updatedAt: new Date() }).where(eq(inventory_transactions.referenceId, id));
      count++;
    }
    // Serialize recomputation per product: an advisory xact lock keeps concurrent
    // bulk moves from interleaving their running-balance recalculation.
    for (const productId of touchedProducts) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${productId}))`);
    }
    // Re-dating ledger rows changes their ordering, so the running snapshots move too.
    await recalculateLedgerBalances(tx, [...touchedProducts]);
    for (const pid of touchedProducts) await recalculateProductStock(tx, pid);

    await recordAudit(tx, actor, {
      action: 'BULK_MOVE',
      entity: 'invoice',
      targetIds: ids,
      context: { targetDate, count },
      details: `انتقال ${count} حواله به تاریخ ${targetDate}`,
    });

    return count;
  });
};

/**
 * Persist the manual display order of ONE (type, date) bucket.
 *
 * `orderedIds` is the exact sequence the client renders - the same array it keeps in
 * `localStorage['sortOrder_<type>_<date>']` - and the server derives the 0-based `sort_order`
 * ordinals from it, so the client array and the database column cannot drift apart.
 *
 * Safety properties (deliberate):
 *  - Every UPDATE is scoped by `id AND type AND date AND deleted_at IS NULL`, so a stale or
 *    foreign id (the legacy cross-bucket conflicts seen in Phase 1) can never be written.
 *  - Rows in the same bucket that are missing from the payload lose their ordinal (NULL).
 *    The client renders ordinal-less rows newest-first - the intended "new arrival" position.
 *  - Only `sort_order` and `updated_at` are touched: no DELETE, no TRUNCATE, no schema change.
 */
export const reorderInvoicesInTransaction = async (
  tx: any,
  type: 'entry' | 'exit',
  date: string,
  orderedIds: string[],
  actor?: AuditActor
): Promise<number> => {
  const ids = Array.from(new Set(orderedIds.map((value) => String(value)).filter((value) => value.trim() !== '')));
  if (ids.length === 0) return 0;

  let updated = 0;
  for (let position = 0; position < ids.length; position += 1) {
    const rows = await tx
      .update(invoices)
      .set({ sortOrder: position, updatedAt: new Date() })
      .where(and(
        eq(invoices.id, ids[position]),
        eq(invoices.type, type),
        eq(invoices.date, date),
        isNull(invoices.deletedAt)
      ))
      .returning({ id: invoices.id });
    updated += Array.isArray(rows) ? rows.length : 0;
  }

  // Rows of this bucket that are absent from the saved layout become "unpositioned".
  // `isNotNull` keeps the write set to the rows that actually change.
  await tx
    .update(invoices)
    .set({ sortOrder: null, updatedAt: new Date() })
    .where(and(
      eq(invoices.type, type),
      eq(invoices.date, date),
      isNull(invoices.deletedAt),
      isNotNull(invoices.sortOrder),
      notInArray(invoices.id, ids)
    ));

  await recordAudit(tx, actor, {
    action: 'REORDER',
    entity: 'invoice',
    targetIds: ids,
    context: { type, date, updated, order: ids.slice(0, 25) },
    details: `ثبت ترتیب دستی ${ids.length} حواله ${type === 'entry' ? 'ورود' : 'خروج'} (تاریخ ${date}) — ${updated} ردیف به‌روزرسانی شد`,
  });

  return updated;
};

export const reorderInvoicesWithTransaction = async (
  type: 'entry' | 'exit',
  date: string,
  orderedIds: string[],
  actor?: AuditActor
): Promise<number> =>
  db.transaction(async (tx: any) => reorderInvoicesInTransaction(tx, type, date, orderedIds, actor));
