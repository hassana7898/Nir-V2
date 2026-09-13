import express from 'express';
import { sql, eq } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { recordInventoryTransaction, deleteTransactionsByReference, getInventoryStockByDate } from '../services/inventoryService';
import { createInvoiceInTransaction, updateInvoiceInTransaction } from '../services/invoiceService';
import { createProductionRecordInTransaction } from '../services/productionService';
import { requireRole } from '../middleware/auth';

const router = express.Router();

type Mutation = { id?: string; action: 'create' | 'update' | 'delete'; entityType: string; data: any; timestamp?: number | string };
const asDate = (value: any, fallback = new Date()) => {
  if (value instanceof Date) return value;
  const d = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
};
const nullable = (value: any) => value === undefined || value === '' ? null : value;

const applySimpleMutation = async (tx: any, entityType: string, action: Mutation['action'], data: any) => {
  switch (entityType) {
    case 'poultryAppSettings':
      if (action !== 'delete') await tx.insert(schema.settings).values({ id: 'default', data: data ?? {} }).onConflictDoUpdate({ target: schema.settings.id, set: { data: data ?? {}, updatedAt: new Date() } });
      return;
    case 'poultryAppFarmers': {
      const item = data; if (!item?.id) throw new Error('Farmer mutation requires id');
      if (action === 'delete') return tx.update(schema.farmers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.farmers.id, String(item.id)));
      return tx.insert(schema.farmers).values({ id: String(item.id), name: String(item.name ?? ''), phone: nullable(item.phone), broods: item.broods ?? [], isHidden: Boolean(item.isHidden), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) }).onConflictDoUpdate({ target: schema.farmers.id, set: { name: String(item.name ?? ''), phone: nullable(item.phone), broods: item.broods ?? [], isHidden: Boolean(item.isHidden), deletedAt: null, updatedAt: asDate(item.updatedAt) } });
    }
    case 'poultryAppDrivers': {
      const item = typeof data === 'string' ? { id: data, name: data } : data; if (!item?.id && !item?.name) throw new Error('Driver mutation requires id or name');
      const id = String(item.id ?? item.name);
      if (action === 'delete') return tx.update(schema.drivers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.drivers.id, id));
      return tx.insert(schema.drivers).values({ id, name: String(item.name ?? id), phone: nullable(item.phone), iban: nullable(item.iban), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt), deletedAt: null }).onConflictDoUpdate({ target: schema.drivers.id, set: { name: String(item.name ?? id), phone: nullable(item.phone), iban: nullable(item.iban), deletedAt: null, updatedAt: asDate(item.updatedAt) } });
    }
    case 'poultryAppOrigins': {
      const item = typeof data === 'string' ? { id: data, name: data } : data; if (!item?.id && !item?.name) throw new Error('Origin mutation requires id or name');
      const id = String(item.id ?? item.name);
      if (action === 'delete') return tx.update(schema.origins).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.origins.id, id));
      return tx.insert(schema.origins).values({ id, name: String(item.name ?? id), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt), deletedAt: null }).onConflictDoUpdate({ target: schema.origins.id, set: { name: String(item.name ?? id), deletedAt: null, updatedAt: asDate(item.updatedAt) } });
    }
    case 'poultryAppFormulas': {
      const item = data; if (!item?.id) throw new Error('Formula mutation requires id');
      const id = String(item.id);
      if (action === 'delete') return tx.update(schema.formulas).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.formulas.id, id));
      const items = Array.isArray(item.items) ? item.items : [];
      await tx.insert(schema.formulas).values({ id, name: String(item.name ?? ''), finishedGoodId: String(item.finishedGoodId ?? ''), items, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt), deletedAt: null }).onConflictDoUpdate({ target: schema.formulas.id, set: { name: String(item.name ?? ''), finishedGoodId: String(item.finishedGoodId ?? ''), items, deletedAt: null, updatedAt: asDate(item.updatedAt) } });
      await tx.delete(schema.formula_items).where(eq(schema.formula_items.formulaId, id));
      const rows = items.filter((x: any) => x?.productId).map((x: any) => ({ id: String(x.id || crypto.randomUUID()), formulaId: id, productId: String(x.productId), percentage: x.percentage == null ? null : String(x.percentage), quantity: x.quantity == null ? null : String(x.quantity), createdAt: new Date(), updatedAt: new Date() }));
      if (rows.length) await tx.insert(schema.formula_items).values(rows);
      return;
    }
    case 'poultryAppLogs': {
      if (action === 'delete' || !data?.id) return;
      return tx.insert(schema.logs).values({ id: String(data.id), timestamp: asDate(data.timestamp), action: String(data.action ?? ''), actionText: nullable(data.actionText), type: nullable(data.type), details: nullable(data.details), by: nullable(data.by) }).onConflictDoNothing();
    }
    default:
      throw new Error(`Unsupported entity type: ${entityType}`);
  }
};

router.get('/state', async (_req, res) => {
  try {
    const [settings, farmers, drivers, origins, invoices, formulas, production, adjustments] = await Promise.all([
      db.select().from(schema.settings),
      db.select().from(schema.farmers),
      db.select().from(schema.drivers),
      db.select().from(schema.origins),
      db.select().from(schema.invoices),
      db.select().from(schema.formulas),
      db.select().from(schema.production_records),
      db.select().from(schema.inventory_adjustments),
    ]);
    const formulaRows = await Promise.all(formulas.filter((f: any) => !f.deletedAt).map(async (f: any) => ({
      ...f,
      items: await db.select().from(schema.formula_items).where(eq(schema.formula_items.formulaId, f.id)),
    })));
    res.json({
      settings: settings[0]?.data ?? null,
      farmers: farmers.filter((x: any) => !x.deletedAt),
      drivers: drivers.filter((x: any) => !x.deletedAt),
      origins: origins.filter((x: any) => !x.deletedAt),
      invoices: invoices.filter((x: any) => !x.deletedAt),
      formulas: formulaRows,
      production: production.filter((x: any) => !x.deletedAt),
      adjustments: adjustments.filter((x: any) => !x.deletedAt),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync state error:', error);
    res.status(500).json({ error: 'Could not load synchronized state.' });
  }
});

router.post('/', requireRole('ADMIN', 'MANAGER', 'ACCOUNTING', 'OPERATOR'), async (req, res) => {
  const body = req.body as Mutation;
  const mutationId = String(body?.id || '');
  if (!mutationId || !body.entityType || !body.action) return res.status(400).json({ error: 'Invalid sync mutation.' });

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: schema.sync_mutations.id }).from(schema.sync_mutations).where(eq(schema.sync_mutations.id, mutationId)).limit(1);
      if (existing.length) return { duplicate: true };

      switch (body.entityType) {
        case 'poultryAppInvoices': {
          if (body.action === 'create') await createInvoiceInTransaction(tx, body.data);
          else if (body.action === 'update') await updateInvoiceInTransaction(tx, String(body.data?.id), body.data);
          else {
            const id = String(body.data?.id);
            await deleteTransactionsByReference(tx, id);
            await tx.update(schema.invoices).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.invoices.id, id));
          }
          break;
        }
        case 'poultryAppProduction': {
          const id = String(body.data?.id || '');
          if (body.action === 'create') {
            await createProductionRecordInTransaction(tx, body.data);
          } else if (body.action === 'delete') {
            await deleteTransactionsByReference(tx, id);
            await tx.update(schema.production_records).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.production_records.id, id));
            await tx.update(schema.batches).set({ deletedAt: new Date(), status: 'voided', updatedAt: new Date() }).where(eq(schema.batches.productionRecordId, id));
          } else {
            throw new Error('به‌روزرسانی تولید ثبت‌شده از طریق Sync آفلاین مجاز نیست.');
          }
          break;
        }
        case 'poultryAppAdjustments': {
          const item = body.data;
          if (!item?.id) throw new Error('Adjustment mutation requires id');
          if (body.action === 'delete') {
            await deleteTransactionsByReference(tx, String(item.id));
            await tx.update(schema.inventory_adjustments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.inventory_adjustments.id, String(item.id)));
            break;
          }
          const productId = String(item.productId);
          const date = String(item.date);
          const stockRows = await tx.select({ total: sql<string>`coalesce(sum(cast(${schema.inventory_transactions.quantity} as numeric)), 0)` }).from(schema.inventory_transactions).where(eq(schema.inventory_transactions.productId, productId));
          const currentQty = Number(stockRows[0]?.total || 0);
          const newQty = Number(item.newQuantity);
          if (!Number.isFinite(newQty)) throw new Error('موجودی جدید نامعتبر است.');
          const diff = newQty - currentQty;
          await tx.insert(schema.inventory_adjustments).values({ id: String(item.id), date, productId, newQuantity: String(newQty), reason: nullable(item.reason), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt), deletedAt: null }).onConflictDoUpdate({ target: schema.inventory_adjustments.id, set: { date, productId, newQuantity: String(newQty), reason: nullable(item.reason), deletedAt: null, updatedAt: new Date() } });
          await deleteTransactionsByReference(tx, String(item.id));
          if (diff !== 0) await recordInventoryTransaction(tx, { date, productId, type: 'adjustment', quantity: diff, referenceType: 'inventory_adjustment', referenceId: String(item.id), notes: nullable(item.reason) || 'تعدیل موجودی انبار' });
          break;
        }
        default: {
          const items = Array.isArray(body.data) && body.entityType !== 'poultryAppSettings' ? body.data : [body.data];
          for (const item of items) await applySimpleMutation(tx, body.entityType, body.action, item);
        }
      }

      await tx.insert(schema.sync_mutations).values({ id: mutationId, entityType: body.entityType, action: body.action, payload: body.data ?? null, userId: req.user?.id ?? null });
      return { duplicate: false };
    });

    res.json({ success: true, mutationId, duplicate: result.duplicate, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Sync failed' });
  }
});

export default router;
