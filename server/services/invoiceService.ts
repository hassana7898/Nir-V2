import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { invoices, inventory_transactions } from '../db/schema';
import { getInventoryStockByDate, recordInventoryTransaction, createReversingTransaction } from './inventoryService';

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
  weight?: number | string;
  invoiceNumber?: string;
  productVariant?: string;
  isCrumble?: boolean;
  isPageBreak?: boolean;
}

const ensureSufficientStock = async (tx: any, productId: string, date: string, quantity: number) => {
  if (quantity <= 0) throw new Error('مقدار حواله خروج باید بیشتر از صفر باشد.');
  const stock = await getInventoryStockByDate(date, tx);
  const available = stock[productId] || 0;
  if (available < quantity) throw new Error(`موجودی محصول کافی نیست. موجودی فعلی: ${available}، مقدار خروج: ${quantity}`);
};

export const createInvoiceWithTransaction = async (data: InvoiceInput): Promise<string> =>
  db.transaction(async (tx: any) => createInvoiceInTransaction(tx, data));

export const createInvoiceInTransaction = async (tx: any, data: InvoiceInput): Promise<string> => {
  const id = data.id || randomUUID();

  if (data.type === 'entry') {
    const qty = Number(data.scaleWeight || 0);
    if (qty <= 0) throw new Error('وزن باسکول برای ورود باید بیشتر از صفر باشد.');
  }
  if (data.type === 'exit') await ensureSufficientStock(tx, data.productId, data.date, Number(data.weight || 0));

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
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  if (data.type === 'entry') {
    await recordInventoryTransaction(tx, { date: data.date, productId: data.productId, type: 'entry', quantity: Number(data.scaleWeight), referenceType: 'invoice', referenceId: id, notes: `ورود بار از ${data.sellerName || 'نامشخص'} - بارنامه ${data.billNumber || '-'}` });
  } else if (data.type === 'exit') {
    const qty = Number(data.weight);
    await recordInventoryTransaction(tx, { date: data.date, productId: data.productId, type: 'exit', quantity: -qty, referenceType: 'invoice', referenceId: id, notes: `خروج دان برای مرغدار - حواله ${data.invoiceNumber || '-'}` });
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
    const error = new Error('متاسفانه اطلاعات توسط کاربر دیگری تغییر یافته است. لطفا مجددا تلاش کنید.');
    (error as any).code = 'CONFLICT';
    (error as any).authoritativeRecord = prev;
    throw error;
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

  await createReversingTransaction(tx, id);

  if (invoiceType === 'entry') {
    const qty = Number(data.scaleWeight !== undefined ? data.scaleWeight : prev.scaleWeight || 0);
    if (qty <= 0) throw new Error('وزن ورود نامعتبر است.');
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'entry', quantity: qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش ورود بار - بارنامه ${data.billNumber || prev.billNumber || '-'}` });
  } else if (invoiceType === 'exit') {
    const qty = Number(data.weight !== undefined ? data.weight : prev.weight || 0);
    await ensureSufficientStock(tx, productId, invDate, qty);
    await recordInventoryTransaction(tx, { date: invDate, productId, type: 'exit', quantity: -qty, referenceType: 'invoice', referenceId: id, notes: `ویرایش خروج دان - حواله ${data.invoiceNumber || prev.invoiceNumber || '-'}` });
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
    for (const id of ids) {
      await tx.update(invoices).set({ date: targetDate, updatedAt: new Date() }).where(eq(invoices.id, id));
      await tx.update(inventory_transactions).set({ date: targetDate, updatedAt: new Date() }).where(eq(inventory_transactions.referenceId, id));
      count++;
    }
    return count;
  });
};
