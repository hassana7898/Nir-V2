import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { invoices, inventory_transactions, products, farmers } from '../db/schema';
import { getInventoryStockByDate, recordInventoryTransaction, createReversingTransaction, recalculateLedgerBalances, recalculateProductStock } from './inventoryService';

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
const ensureFarmerExists = async (tx: any, farmerId: string, farmerName?: string) => {
  if (!farmerId) {
    throw contractError('UNKNOWN_FARMER', 'برای حواله خروج انتخاب مرغدار الزامی است.', 422);
  }
  const existing = await tx.select({ id: farmers.id }).from(farmers).where(eq(farmers.id, farmerId)).limit(1);
  if (existing.length > 0) return;

  if (farmerName && farmerName.trim()) {
    await tx.insert(farmers).values({
      id: farmerId,
      name: farmerName.trim(),
      broods: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
    console.log(`[NIR] auto-provisioned farmer "${farmerId}" referenced by invoice`);
    return;
  }

  throw contractError('UNKNOWN_FARMER', 'مرغدار انتخاب‌شده در سرور یافت نشد. لطفاً ابتدا مرغدار را ذخیره کنید و سپس حواله را ثبت کنید.', 422);
};

const ensureSufficientStock = async (tx: any, productId: string, date: string, quantity: number) => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw contractError('VALIDATION_FAILED', 'مقدار وزن حواله باید بزرگ‌تر از صفر باشد.', 400);
  }
  const stock = await getInventoryStockByDate(date, tx);
  const available = stock[productId] || 0;
  if (available < quantity) {
    throw contractError(
      'INSUFFICIENT_STOCK',
      `موجودی کافی نیست. موجودی فعلی: ${available} کیلوگرم، مقدار درخواستی: ${quantity} کیلوگرم`,
      422,
      { available, requested: quantity, productId }
    );
  }
};

export const createInvoiceWithTransaction = async (data: InvoiceInput): Promise<string> =>
  db.transaction(async (tx: any) => createInvoiceInTransaction(tx, data));

export const createInvoiceInTransaction = async (tx: any, data: InvoiceInput): Promise<string> => {
  const id = data.id || randomUUID();

  await ensureProductExists(tx, data.productId, data.productName, data.type);

  if (data.type === 'entry') {
    const qty = Number(data.scaleWeight || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw contractError('VALIDATION_FAILED', 'وزن باسکول حواله ورود باید بزرگ‌تر از صفر باشد.', 400);
  }
  if (data.type === 'exit') {
    await ensureFarmerExists(tx, String(data.farmerId || ''), data.farmerName);
    await ensureSufficientStock(tx, data.productId, data.date, Number(data.weight || 0));
  }

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
    wastage: data.wastage !== undefined ? String(data.wastage) : null,
    farmerId: data.farmerId || null,
    weight: data.weight !== undefined ? String(data.weight) : null,
    invoiceNumber: data.invoiceNumber || null,
    productVariant: data.productVariant || null,
    isCrumble: Boolean(data.isCrumble),
    isPageBreak: Boolean(data.isPageBreak),
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

  return id;
};

export const updateInvoiceWithTransaction = async (id: string, data: Partial<InvoiceInput>): Promise<void> => {
  await db.transaction(async (tx: any) => updateInvoiceInTransaction(tx, id, data));
};

export const updateInvoiceInTransaction = async (tx: any, id: string, data: Partial<InvoiceInput>): Promise<void> => {
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

  const invoiceType = data.type || prev.type;
  const invDate = data.date || prev.date;
  const productId = data.productId || prev.productId;
  const farmerId = data.farmerId !== undefined ? data.farmerId : prev.farmerId;

  await ensureProductExists(tx, productId, data.productName || prev.productName || undefined, invoiceType);

  await createReversingTransaction(tx, id);

  if (invoiceType === 'entry') {
    const qty = Number(data.scaleWeight !== undefined ? data.scaleWeight : prev.scaleWeight || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw contractError('VALIDATION_FAILED', 'وزن حواله نامعتبر است.', 400);
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'entry', quantity: qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش حواله ورود - بارنامه ${data.billNumber || prev.billNumber || '-'}` });
  } else if (invoiceType === 'exit') {
    const qty = Number(data.weight !== undefined ? data.weight : prev.weight || 0);
    if (farmerId) await ensureFarmerExists(tx, String(farmerId), data.farmerName);
    await ensureSufficientStock(tx, productId, invDate, qty);
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'exit', quantity: -qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش حواله خروج - فاکتور ${data.invoiceNumber || prev.invoiceNumber || '-'}` });
  }

  await tx.update(invoices).set(updatePayload).where(eq(invoices.id, id));
};

export const deleteInvoiceWithTransaction = async (id: string): Promise<void> => {
  await db.transaction(async (tx: any) => {
    await deleteInvoiceInTransaction(tx, id);
  });
};

export const deleteInvoiceInTransaction = async (tx: any, id: string): Promise<void> => {
  await tx.update(invoices).set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id));
  await createReversingTransaction(tx, id);
};

export const bulkMoveInvoicesWithTransaction = async (ids: string[], targetDate: string): Promise<number> => {
  return db.transaction(async (tx: any) => {
    let count = 0;
    const touchedProducts = new Set<string>();
    for (const id of ids) {
      await tx.update(invoices).set({ date: targetDate, updatedAt: new Date() }).where(eq(invoices.id, id));
      const affected = await tx
        .select({ productId: inventory_transactions.productId })
        .from(inventory_transactions)
        .where(eq(inventory_transactions.referenceId, id));
      affected.forEach((r: any) => r.productId && touchedProducts.add(String(r.productId)));
      await tx.update(inventory_transactions).set({ date: targetDate, updatedAt: new Date() }).where(eq(inventory_transactions.referenceId, id));
      count++;
    }
    // Re-dating ledger rows changes their ordering, so the running snapshots move too.
    await recalculateLedgerBalances(tx, [...touchedProducts]);
    for (const pid of touchedProducts) await recalculateProductStock(tx, pid);
    return count;
  });
};
