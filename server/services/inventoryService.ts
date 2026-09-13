import { and, eq, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { inventory_transactions, inventory_adjustments, products } from '../db/schema';

export interface RecordTransactionParams {
  date: string;
  productId: string;
  type: 'entry' | 'exit' | 'production_in' | 'production_out' | 'adjustment' | 'return_in' | 'return_out' | 'return';
  quantity: number;
  referenceType?: 'invoice' | 'production_record' | 'inventory_adjustment' | 'manual';
  referenceId?: string;
  batchId?: string;
  notes?: string;
}

const calculateStock = async (tx: any, productId: string, untilDateStr?: string): Promise<number> => {
  const condition = untilDateStr
    ? and(eq(inventory_transactions.productId, productId), lte(inventory_transactions.date, untilDateStr))
    : eq(inventory_transactions.productId, productId);

  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(cast(${inventory_transactions.quantity} as numeric)), 0)` })
    .from(inventory_transactions)
    .where(condition);

  return parseFloat(rows[0]?.total || '0') || 0;
};

export const recalculateProductStock = async (tx: any, productId: string): Promise<number> => {
  const total = await calculateStock(tx, productId);
  const existing = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (existing.length > 0) {
    await tx.update(products).set({ currentStock: String(total), updatedAt: new Date() }).where(eq(products.id, productId));
  }
  return total;
};

export const recordInventoryTransaction = async (tx: any, params: RecordTransactionParams): Promise<string> => {
  if (!Number.isFinite(params.quantity)) throw new Error('مقدار تراکنش انبار نامعتبر است.');
  if (!params.productId) throw new Error('محصول برای تراکنش انبار الزامی است.');

  const transactionId = randomUUID();
  await tx.insert(inventory_transactions).values({
    id: transactionId,
    date: params.date,
    productId: params.productId,
    type: params.type,
    quantity: String(params.quantity),
    referenceType: params.referenceType || 'manual',
    referenceId: params.referenceId || null,
    batchId: params.batchId || null,
    notes: params.notes || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await recalculateProductStock(tx, params.productId);
  return transactionId;
};

export const createReversingTransaction = async (tx: any, referenceId: string): Promise<void> => {
  const affected = await tx.select().from(inventory_transactions).where(eq(inventory_transactions.referenceId, referenceId));
  for (const trans of affected) {
    // Avoid double reversing
    if (trans.type === 'reversal') continue;
    
    await recordInventoryTransaction(tx, {
      date: trans.date, // Preserve original date for correct historical calculation
      productId: trans.productId,
      type: 'reversal' as any, // Assuming we allow 'reversal' as a string in type
      quantity: -Number(trans.quantity),
      referenceType: trans.referenceType as any,
      referenceId: referenceId, // keep reference to original entity
      notes: `Reversal of transaction ${trans.id}`
    });
  }
};

export const getInventoryStockByDate = async (untilDateStr?: string, txArg?: any): Promise<Record<string, number>> => {
  const executor = txArg || db;
  const rows = untilDateStr
    ? await executor.select({ productId: inventory_transactions.productId, total: sql<string>`coalesce(sum(cast(${inventory_transactions.quantity} as numeric)), 0)` }).from(inventory_transactions).where(lte(inventory_transactions.date, untilDateStr)).groupBy(inventory_transactions.productId)
    : await executor.select({ productId: inventory_transactions.productId, total: sql<string>`coalesce(sum(cast(${inventory_transactions.quantity} as numeric)), 0)` }).from(inventory_transactions).groupBy(inventory_transactions.productId);

  const stockMap: Record<string, number> = {};
  for (const row of rows) stockMap[row.productId] = parseFloat(row.total || '0') || 0;
  return stockMap;
};

export const performInventoryAdjustment = async (data: { date: string; productId: string; newQuantity: number; reason?: string }): Promise<string> => {
  if (!Number.isFinite(data.newQuantity)) throw new Error('موجودی جدید نامعتبر است.');

  return db.transaction(async (tx: any) => {
    const adjustmentId = randomUUID();
    const currentStocks = await getInventoryStockByDate(data.date, tx);
    const currentQty = currentStocks[data.productId] || 0;
    const diff = data.newQuantity - currentQty;

    await tx.insert(inventory_adjustments).values({ id: adjustmentId, date: data.date, productId: data.productId, newQuantity: String(data.newQuantity), reason: data.reason || null, createdAt: new Date(), updatedAt: new Date() });
    if (diff !== 0) {
      await recordInventoryTransaction(tx, { date: data.date, productId: data.productId, type: 'adjustment', quantity: diff, referenceType: 'inventory_adjustment', referenceId: adjustmentId, notes: data.reason || 'تعدیل دستی موجودی انبار' });
    }
    return adjustmentId;
  });
};
