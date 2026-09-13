import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { production_records, batches, formulas, formula_items, products } from '../db/schema';
import { recordInventoryTransaction, deleteTransactionsByReference, getInventoryStockByDate } from './inventoryService';

export interface ProductionInput {
  id?: string;
  date: string;
  finishedGoodId: string;
  formulaId?: string;
  quantityProduced: number | string;
  batchNumber?: string;
}

export const createProductionRecordWithTransaction = async (data: ProductionInput): Promise<string> => {
  return db.transaction(async (tx: any) => createProductionRecordInTransaction(tx, data));
};

export const createProductionRecordInTransaction = async (tx: any, data: ProductionInput): Promise<string> => {
  const id = data.id || randomUUID();
  const qty = Number(data.quantityProduced);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('مقدار تولید باید بیشتر از صفر باشد.');

  const product = await tx.select({ id: products.id, type: products.type })
    .from(products).where(eq(products.id, data.finishedGoodId)).limit(1);
  if (product.length === 0) throw new Error('محصول نهایی انتخاب‌شده وجود ندارد.');

  const batchNum = data.batchNumber?.trim() || `BATCH-${Date.now().toString().slice(-6)}`;

  let formulaItemRows: any[] = [];
  if (data.formulaId) {
    const formula = await tx.select({ id: formulas.id, finishedGoodId: formulas.finishedGoodId })
      .from(formulas).where(eq(formulas.id, data.formulaId)).limit(1);
    if (formula.length === 0 || formula[0].finishedGoodId !== data.finishedGoodId) {
      throw new Error('فرمول انتخاب‌شده با محصول نهایی سازگار نیست.');
    }
    formulaItemRows = await tx.select().from(formula_items).where(eq(formula_items.formulaId, data.formulaId));
    if (formulaItemRows.length === 0) throw new Error('فرمول تولید فاقد مواد اولیه است.');
  }

  const stock = await getInventoryStockByDate(data.date, tx);
  for (const item of formulaItemRows) {
    const percentage = Number(item.percentage || 0);
    const explicitQty = Number(item.quantity || 0);
    const ratio = percentage > 0 ? percentage / 100 : 0;
    const rawMaterialQty = ratio > 0 ? qty * ratio : explicitQty;
    if (!Number.isFinite(rawMaterialQty) || rawMaterialQty <= 0) continue;
    const available = stock[item.productId] || 0;
    if (available < rawMaterialQty) {
      throw new Error(`موجودی ماده اولیه کافی نیست: ${item.productId}. موجودی ${available} و مقدار موردنیاز ${rawMaterialQty} است.`);
    }
  }

  await tx.insert(production_records).values({
    id,
    date: data.date,
    finishedGoodId: data.finishedGoodId,
    formulaId: data.formulaId || null,
    quantityProduced: String(qty),
    batchNumber: batchNum,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  const batchId = randomUUID();
  await tx.insert(batches).values({
    id: batchId,
    batchNumber: batchNum,
    productId: data.finishedGoodId,
    productionRecordId: id,
    initialQuantity: String(qty),
    remainingQuantity: String(qty),
    productionDate: data.date,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await recordInventoryTransaction(tx, {
    date: data.date,
    productId: data.finishedGoodId,
    type: 'production_in',
    quantity: qty,
    referenceType: 'production_record',
    referenceId: id,
    batchId,
    notes: `تولید محصول نهایی - به مقدار ${qty} کیلوگرم`,
  });

  for (const item of formulaItemRows) {
    const percentage = Number(item.percentage || 0);
    const explicitQty = Number(item.quantity || 0);
    const ratio = percentage > 0 ? percentage / 100 : 0;
    const rawMaterialQty = ratio > 0 ? qty * ratio : explicitQty;
    if (!Number.isFinite(rawMaterialQty) || rawMaterialQty <= 0 || !item.productId) continue;
    await recordInventoryTransaction(tx, {
      date: data.date,
      productId: String(item.productId),
      type: 'production_out',
      quantity: -rawMaterialQty,
      referenceType: 'production_record',
      referenceId: id,
      batchId,
      notes: `مصرف ماده اولیه جهت تولید ${qty} کیلوگرم`,
    });
  }

  return id;
};

export const deleteProductionRecordWithTransaction = async (id: string): Promise<void> => {
  await db.transaction(async (tx: any) => {
    await tx.update(production_records).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(production_records.id, id));
    await tx.update(batches).set({ deletedAt: new Date(), status: 'voided', updatedAt: new Date() }).where(eq(batches.productionRecordId, id));
    await deleteTransactionsByReference(tx, id);
  });
};
