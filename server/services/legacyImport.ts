/**
 * Legacy (pre-V2) backup importer.
 *
 * Backups produced by the old client are a flat `key -> value` map
 * (`poultryAppInvoices`, `poultryAppFarmers`, `sortOrder_*`, ...) instead of the
 * `{ tables: { entity: rows[] } }` shape emitted by the V2 `/api/backup/export`.
 * Importing such a file used to land ONLY in the browser's local cache, which is
 * why a restore "saved" but the application stayed empty.
 *
 * This module maps the legacy map onto the real PostgreSQL entities in a single
 * transaction. It is IDEMPOTENT: every row is keyed by its legacy id and every
 * ledger row gets a deterministic id, so re-importing the same file never
 * duplicates data (a hard requirement of the NIR anti-bug contract).
 *
 * Financial/inventory truth is reconstructed as an immutable ledger: invoice
 * lines, production lines and stock adjustments are replayed in chronological
 * order and each gets a `balance_after` snapshot. Historical rows are restored
 * as-is - stock availability is NOT re-validated, because the data represents
 * what actually happened, not a new transaction.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

export interface LegacyRestoreReport {
  restoredTables: Record<string, number>;
  skippedKeys: string[];
  warnings: string[];
  totalRows: number;
}

/** Keys that belong to the legacy business payload. */
const LEGACY_DATA_KEYS = [
  'poultryAppSettings',
  'poultryAppProducts',
  'poultryAppFarmers',
  'poultryAppDrivers',
  'poultryAppOrigins',
  'poultryAppFormulas',
  'poultryAppInvoices',
  'poultryAppAdjustments',
  'poultryAppProduction',
  'poultryAppLogs',
  'origins',
];

export const isLegacySnapshot = (input: any): boolean => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (input.tables && typeof input.tables === 'object') return false; // that is the V2 shape
  return LEGACY_DATA_KEYS.some((k) => input[k] !== undefined);
};

const asDate = (value: any, fallback = new Date()): Date => {
  if (value instanceof Date) return value;
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value);
  if (typeof value === 'number' || /^\d+$/.test(raw)) {
    const d = new Date(Number(value));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

const asTimestamp = (value: any, fallback = Date.now()): number => {
  const d = asDate(value, new Date(fallback));
  return d.getTime();
};

const str = (v: any): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const dec = (v: any): string | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};

const chunk = <T>(rows: T[], size = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

/** Normalise the legacy product type vocabulary onto the V2 one. */
const normaliseProductType = (raw: any, fallback: string): string => {
  const t = String(raw ?? '').trim();
  if (t === 'finishedGood' || t === 'finished' || t === 'finished_good') return 'finishedGood';
  if (t === 'rawMaterial' || t === 'raw' || t === 'raw_material') return 'rawMaterial';
  return fallback;
};

type LedgerEvent =
  | { kind: 'invoice'; date: string; ts: number; productId: string; refId: string; quantity: number; entry: boolean }
  | { kind: 'production'; date: string; ts: number; productId: string; refId: string; quantity: number }
  | { kind: 'adjustment'; date: string; ts: number; productId: string; refId: string; newQuantity: number };

export const restoreLegacySnapshot = async (legacy: any): Promise<LegacyRestoreReport> => {
  if (!isLegacySnapshot(legacy)) {
    throw new Error('Fingerprint does not match a legacy NIR backup (no known poultryApp* keys).');
  }

  const warnings: string[] = [];
  const skippedKeys: string[] = [];
  for (const key of Object.keys(legacy)) {
    if (!LEGACY_DATA_KEYS.includes(key)) skippedKeys.push(key);
  }

  const settingsObj = legacy.poultryAppSettings && typeof legacy.poultryAppSettings === 'object' ? legacy.poultryAppSettings : null;
  const rawInvoices: any[] = Array.isArray(legacy.poultryAppInvoices) ? legacy.poultryAppInvoices : [];
  const rawFarmers: any[] = Array.isArray(legacy.poultryAppFarmers) ? legacy.poultryAppFarmers : [];
  const rawDrivers: any[] = Array.isArray(legacy.poultryAppDrivers) ? legacy.poultryAppDrivers : [];
  const rawOrigins: any[] = Array.isArray(legacy.poultryAppOrigins) ? legacy.poultryAppOrigins : Array.isArray(legacy.origins) ? legacy.origins : [];
  const rawFormulas: any[] = Array.isArray(legacy.poultryAppFormulas) ? legacy.poultryAppFormulas : [];
  const rawAdjustments: any[] = Array.isArray(legacy.poultryAppAdjustments) ? legacy.poultryAppAdjustments : [];
  const rawProduction: any[] = Array.isArray(legacy.poultryAppProduction) ? legacy.poultryAppProduction : [];
  const rawLogs: any[] = Array.isArray(legacy.poultryAppLogs) ? legacy.poultryAppLogs : [];

  return db.transaction(async (tx: any) => {
    const restoredTables: Record<string, number> = {};

    // ---------------------------------------------------------------- settings
    if (settingsObj) {
      await tx.insert(schema.settings)
        .values({ id: 'default', data: settingsObj, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.settings.id, set: { data: settingsObj, updatedAt: new Date() } });
      restoredTables.settings = 1;
    }

    // ---------------------------------------------------------------- products
    const now = new Date();
    interface ProductRow { id: string; name: string; type: string; isActive: boolean; deletedAt: Date | null; }
    const productMap = new Map<string, ProductRow>();

    const addProduct = (id: any, name: any, type: any, isDeleted: any, fallbackType = 'rawMaterial') => {
      const pid = str(id) ?? str(name);
      if (!pid) return;
      const existing = productMap.get(pid);
      const row: ProductRow = {
        id: pid,
        name: String(name ?? existing?.name ?? pid),
        type: normaliseProductType(type, existing?.type ?? fallbackType),
        isActive: !isDeleted,
        deletedAt: isDeleted ? now : null,
      };
      productMap.set(pid, row);
    };

    const settingsProducts: any[] = Array.isArray(settingsObj?.products) ? settingsObj!.products : [];
    for (const p of settingsProducts) addProduct(p?.id, p?.name, p?.type, p?.isDeleted);

    // Any product referenced by a document but absent from the catalogue.
    const referenced: Array<{ id: any; name?: any; type?: any }> = [];
    for (const inv of rawInvoices) referenced.push({ id: inv?.productId, name: inv?.productName, type: inv?.type === 'exit' ? 'finishedGood' : undefined });
    for (const f of rawFormulas) {
      referenced.push({ id: f?.finishedGoodId, type: 'finishedGood' });
      for (const item of Array.isArray(f?.items) ? f.items : []) referenced.push({ id: item?.productId });
    }
    for (const a of rawAdjustments) referenced.push({ id: a?.productId });
    for (const p of rawProduction) referenced.push({ id: p?.finishedGoodId, type: 'finishedGood' });
    for (const q of Array.isArray(settingsObj?.feedQuotas) ? settingsObj!.feedQuotas : []) referenced.push({ id: q?.productId });
    for (const r of referenced) if (r.id && !productMap.has(String(r.id))) addProduct(r.id, r.id, r.type, false, 'rawMaterial');

    const productRows = [...productMap.values()].map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      unit: 'kg',
      isActive: p.isActive,
      createdAt: now,
      updatedAt: now,
      deletedAt: p.deletedAt,
    }));
    for (const part of chunk(productRows)) {
      if (part.length) await tx.insert(schema.products).values(part).onConflictDoUpdate({
        target: schema.products.id,
        set: { name: sql`excluded.name`, type: sql`excluded.type`, isActive: sql`excluded.is_active`, deletedAt: sql`excluded.deleted_at`, updatedAt: sql`excluded.updated_at` },
      });
    }
    restoredTables.products = productRows.length;

    // ---------------------------------------------------------------- farmers
    interface FarmerRow { id: string; name: string; broods: any; isHidden: boolean; deletedAt: Date | null; }
    const farmerMap = new Map<string, FarmerRow>();
    for (const f of rawFarmers) {
      const id = str(f?.id);
      if (!id) continue;
      farmerMap.set(id, {
        id,
        name: String(f?.name ?? id),
        broods: Array.isArray(f?.broods) ? f.broods : [],
        isHidden: Boolean(f?.isHidden),
        deletedAt: f?.isDeleted ? now : null,
      });
    }
    // Invoices may reference a farmer that is absent from the list (auto-provisioned in the old app).
    for (const inv of rawInvoices) {
      const fid = str(inv?.farmerId);
      if (fid && !farmerMap.has(fid)) farmerMap.set(fid, { id: fid, name: fid, broods: [], isHidden: false, deletedAt: null });
    }
    const farmerRows = [...farmerMap.values()].map((f) => ({ ...f, createdAt: now, updatedAt: now }));
    for (const part of chunk(farmerRows)) {
      if (part.length) await tx.insert(schema.farmers).values(part).onConflictDoUpdate({
        target: schema.farmers.id,
        set: { name: sql`excluded.name`, broods: sql`excluded.broods`, isHidden: sql`excluded.is_hidden`, deletedAt: sql`excluded.deleted_at`, updatedAt: sql`excluded.updated_at` },
      });
    }
    restoredTables.farmers = farmerRows.length;

    // ---------------------------------------------------------------- drivers
    const driverRows = new Map<string, any>();
    for (const d of rawDrivers) {
      const obj = typeof d === 'string' ? { id: d, name: d } : d;
      const id = str(obj?.id ?? obj?.name);
      if (!id) continue;
      driverRows.set(id, { id, name: String(obj?.name ?? id), phone: str(obj?.phone), iban: str(obj?.iban), createdAt: now, updatedAt: now, deletedAt: null });
    }
    for (const part of chunk([...driverRows.values()])) {
      if (part.length) await tx.insert(schema.drivers).values(part).onConflictDoUpdate({
        target: schema.drivers.id,
        set: { name: sql`excluded.name`, phone: sql`excluded.phone`, iban: sql`excluded.iban`, deletedAt: sql`excluded.deleted_at`, updatedAt: sql`excluded.updated_at` },
      });
    }
    restoredTables.drivers = driverRows.size;

    // ---------------------------------------------------------------- origins
    const originRows = new Map<string, any>();
    for (const o of rawOrigins) {
      const obj = typeof o === 'string' ? { id: o, name: o } : o;
      const id = str(obj?.id ?? obj?.name);
      if (!id) continue;
      originRows.set(id, { id, name: String(obj?.name ?? id), createdAt: now, updatedAt: now, deletedAt: null });
    }
    for (const part of chunk([...originRows.values()])) {
      if (part.length) await tx.insert(schema.origins).values(part).onConflictDoUpdate({
        target: schema.origins.id,
        set: { name: sql`excluded.name`, deletedAt: sql`excluded.deleted_at`, updatedAt: sql`excluded.updated_at` },
      });
    }
    restoredTables.origins = originRows.size;

    // ---------------------------------------------------------------- formulas
    let formulaCount = 0;
    let formulaItemCount = 0;
    for (const f of rawFormulas) {
      const id = str(f?.id) ?? `leg_formula_${formulaCount + 1}`;
      const finishedGoodId = str(f?.finishedGoodId);
      if (!finishedGoodId) { warnings.push(`formula ${id} skipped: no finishedGoodId`); continue; }
      const items = Array.isArray(f?.items) ? f.items : [];
      const name = str(f?.name) ?? productMap.get(finishedGoodId)?.name ?? finishedGoodId;
      await tx.insert(schema.formulas).values({ id, name, finishedGoodId, items, createdAt: now, updatedAt: now, deletedAt: null })
        .onConflictDoUpdate({ target: schema.formulas.id, set: { name: sql`excluded.name`, finishedGoodId: sql`excluded.finished_good_id`, items: sql`excluded.items`, deletedAt: sql`excluded.deleted_at`, updatedAt: sql`excluded.updated_at` } });
      formulaCount++;

      await tx.delete(schema.formula_items).where(sql`${schema.formula_items.formulaId} = ${id}`);
      const itemRows = items
        .filter((it: any) => it?.productId)
        .map((it: any, idx: number) => ({
          id: str(it?.id) ?? `leg_fi_${id}_${idx}`,
          formulaId: id,
          productId: String(it.productId),
          percentage: dec(it?.percentage),
          quantity: dec(it?.quantity),
          createdAt: now,
          updatedAt: now,
        }));
      for (const part of chunk(itemRows)) {
        if (part.length) await tx.insert(schema.formula_items).values(part).onConflictDoNothing();
      }
      formulaItemCount += itemRows.length;
    }
    restoredTables.formulas = formulaCount;
    restoredTables.formula_items = formulaItemCount;

    // ---------------------------------------------------------------- invoices
    interface InvoiceRow { id: string; data: any; entry: boolean; quantity: number; }
    const invoiceRows: InvoiceRow[] = [];
    const seenInvoice = new Set<string>();
    for (const inv of rawInvoices) {
      const id = str(inv?.id);
      if (!id || seenInvoice.has(id)) continue;
      const productId = str(inv?.productId);
      if (!productId) { warnings.push(`invoice ${id} skipped: no productId`); continue; }
      seenInvoice.add(id);
      const entry = inv?.type === 'entry';
      const quantity = entry ? Number(inv?.scaleWeight || inv?.billWeight || 0) : -Number(inv?.weight || 0);
      invoiceRows.push({ id, data: inv, entry, quantity });
    }

    const invoiceValues = invoiceRows.map(({ id, data, entry }) => ({
      id,
      type: entry ? 'entry' : 'exit',
      date: String(data?.date ?? ''),
      productId: String(data?.productId ?? ''),
      productName: str(data?.productName),
      driverName: str(data?.driverName),
      sellerName: str(data?.sellerName),
      billWeight: dec(data?.billWeight),
      scaleWeight: dec(data?.scaleWeight),
      factory: str(data?.factory) ?? str(settingsObj?.factoryName),
      billNumber: str(data?.billNumber),
      origin: str(data?.origin),
      transportCost: dec(data?.transportCost),
      driverPhone: str(data?.driverPhone),
      driverIBAN: str(data?.driverIBAN),
      wastage: dec(data?.wastage),
      farmerId: entry ? null : str(data?.farmerId),
      weight: dec(data?.weight),
      invoiceNumber: str(data?.invoiceNumber),
      productVariant: str(data?.productVariant),
      isCrumble: Boolean(data?.isCrumble),
      isPageBreak: Boolean(data?.isPageBreak),
      version: 1,
      createdAt: asDate(data?.createdAt, now),
      updatedAt: asDate(data?.createdAt, now),
      deletedAt: null,
    }));
    for (const part of chunk(invoiceValues)) {
      if (part.length) await tx.insert(schema.invoices).values(part).onConflictDoUpdate({
        target: schema.invoices.id,
        set: {
          type: sql`excluded.type`, date: sql`excluded.date`, productId: sql`excluded.product_id`,
          productName: sql`excluded.product_name`, driverName: sql`excluded.driver_name`, sellerName: sql`excluded.seller_name`,
          billWeight: sql`excluded.bill_weight`, scaleWeight: sql`excluded.scale_weight`, factory: sql`excluded.factory`,
          billNumber: sql`excluded.bill_number`, origin: sql`excluded.origin`, transportCost: sql`excluded.transport_cost`,
          driverPhone: sql`excluded.driver_phone`, driverIBAN: sql`excluded.driver_iban`, wastage: sql`excluded.wastage`,
          farmerId: sql`excluded.farmer_id`, weight: sql`excluded.weight`, invoiceNumber: sql`excluded.invoice_number`,
          productVariant: sql`excluded.product_variant`, isCrumble: sql`excluded.is_crumble`, isPageBreak: sql`excluded.is_page_break`,
          updatedAt: sql`excluded.updated_at`, deletedAt: sql`excluded.deleted_at`,
        },
      });
    }
    restoredTables.invoices = invoiceValues.length;

    // ------------------------------------------------------------- production
    const productionValues = rawProduction
      .filter((p: any) => p?.id && p?.finishedGoodId)
      .map((p: any) => ({
        id: String(p.id),
        date: String(p.date ?? ''),
        finishedGoodId: String(p.finishedGoodId),
        formulaId: str(p.formulaId),
        quantityProduced: dec(p.quantityProduced) ?? '0',
        batchNumber: `LEG-${String(p.id).replace(/[^0-9a-zA-Z]/g, '')}`,
        createdAt: asDate(p.createdAt, now),
        updatedAt: asDate(p.createdAt, now),
        deletedAt: null,
      }));
    for (const part of chunk(productionValues)) {
      if (part.length) await tx.insert(schema.production_records).values(part).onConflictDoUpdate({
        target: schema.production_records.id,
        set: { date: sql`excluded.date`, finishedGoodId: sql`excluded.finished_good_id`, quantityProduced: sql`excluded.quantity_produced`, updatedAt: sql`excluded.updated_at`, deletedAt: sql`excluded.deleted_at` },
      });
    }
    restoredTables.production = productionValues.length;

    // Batches mirror each production record (batch_number is UNIQUE, so it is derived from the id).
    const batchRows = productionValues.map((p: any) => ({
      id: `leg_batch_${p.id}`,
      batchNumber: `LEG-${String(p.id).replace(/[^0-9a-zA-Z]/g, '')}`.slice(0, 60),
      productId: p.finishedGoodId,
      productionRecordId: p.id,
      initialQuantity: p.quantityProduced,
      remainingQuantity: p.quantityProduced,
      productionDate: p.date,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
    for (const part of chunk(batchRows)) {
      if (part.length) await tx.insert(schema.batches).values(part).onConflictDoNothing();
    }
    restoredTables.batches = batchRows.length;

    // ------------------------------------------------------------ adjustments
    const adjustmentValues = rawAdjustments
      .filter((a: any) => a?.id && a?.productId)
      .map((a: any) => ({
        id: String(a.id),
        date: String(a.date ?? ''),
        productId: String(a.productId),
        newQuantity: dec(a.newQuantity) ?? '0',
        reason: str(a.reason),
        createdAt: asDate(a.createdAt, now),
        updatedAt: asDate(a.createdAt, now),
        deletedAt: null,
      }));
    for (const part of chunk(adjustmentValues)) {
      if (part.length) await tx.insert(schema.inventory_adjustments).values(part).onConflictDoUpdate({
        target: schema.inventory_adjustments.id,
        set: { date: sql`excluded.date`, productId: sql`excluded.product_id`, newQuantity: sql`excluded.new_quantity`, reason: sql`excluded.reason`, updatedAt: sql`excluded.updated_at`, deletedAt: sql`excluded.deleted_at` },
      });
    }
    restoredTables.adjustments = adjustmentValues.length;

    // ------------------------------------------------------------------ ledger
    const events: LedgerEvent[] = [];
    for (const inv of invoiceRows) {
      if (!inv.quantity) continue;
      events.push({ kind: 'invoice', date: String(inv.data?.date ?? ''), ts: asTimestamp(inv.data?.createdAt), productId: String(inv.data?.productId ?? ''), refId: inv.id, quantity: inv.quantity, entry: inv.entry });
    }
    for (const p of productionValues) {
      const qty = Number(p.quantityProduced);
      if (!Number.isFinite(qty) || qty === 0) continue;
      events.push({ kind: 'production', date: p.date, ts: asTimestamp(p.createdAt), productId: p.finishedGoodId, refId: p.id, quantity: qty });
    }
    for (const a of adjustmentValues) {
      const nq = Number(a.newQuantity);
      if (!Number.isFinite(nq)) continue;
      events.push({ kind: 'adjustment', date: a.date, ts: asTimestamp(a.createdAt), productId: a.productId, refId: a.id, newQuantity: nq });
    }

    const kindRank = (k: LedgerEvent['kind']) => (k === 'invoice' ? 0 : k === 'production' ? 1 : 2);
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts !== b.ts ? a.ts - b.ts : kindRank(a.kind) - kindRank(b.kind)));

    const balances = new Map<string, number>();
    const ledgerRows: any[] = [];
    const pushLedger = (id: string, ev: LedgerEvent, type: string, quantity: number, entry = false) => {
      if (!ev.productId || !Number.isFinite(quantity)) return;
      const balance = (balances.get(ev.productId) || 0) + quantity;
      balances.set(ev.productId, balance);
      ledgerRows.push({
        id,
        date: ev.date,
        productId: ev.productId,
        type,
        quantity: String(quantity),
        balanceAfter: String(balance),
        referenceType: ev.kind === 'invoice' ? 'invoice' : ev.kind === 'production' ? 'production_record' : 'inventory_adjustment',
        referenceId: ev.refId,
        reversalOf: null,
        batchId: null,
        notes: ev.kind === 'invoice' ? (entry ? 'legacy entry invoice' : 'legacy exit invoice') : ev.kind === 'production' ? 'legacy production' : 'legacy stock adjustment',
        createdAt: asDate(ev.ts, now),
        updatedAt: asDate(ev.ts, now),
      });
    };

    for (const ev of events) {
      if (ev.kind === 'adjustment') {
        const diff = ev.newQuantity - (balances.get(ev.productId) || 0);
        if (diff !== 0) pushLedger(`leg_adj_${ev.refId}`, ev, 'adjustment', diff);
        continue;
      }
      if (ev.kind === 'production') { pushLedger(`leg_prd_${ev.refId}`, ev, 'production_in', ev.quantity); continue; }
      pushLedger(`leg_inv_${ev.refId}`, ev, ev.entry ? 'entry' : 'exit', ev.quantity, ev.entry);
    }

    for (const part of chunk(ledgerRows)) {
      if (part.length) await tx.insert(schema.inventory_transactions).values(part).onConflictDoNothing();
    }
    restoredTables.inventory_transactions = ledgerRows.length;

    // ------------------------------------------- derived stock (single pass)
    await tx.execute(sql`
      UPDATE ${schema.products} p
      SET current_stock = COALESCE((
        SELECT SUM(CAST(t.quantity AS numeric)) FROM ${schema.inventory_transactions} t WHERE t.product_id = p.id
      ), 0)
    `);

    // -------------------------------------------------------------------- logs
    const logRows = rawLogs
      .filter((l: any) => l && (l.timestamp || l.action))
      .map((l: any, idx: number) => ({
        id: str(l.id) ?? `leg_log_${asTimestamp(l.timestamp, now.getTime())}_${idx}`,
        timestamp: asDate(l.timestamp, now),
        action: String(l.action ?? 'unknown'),
        actionText: str(l.actionText),
        type: str(l.type),
        details: str(l.details),
        by: str(l.by),
      }));
    for (const part of chunk(logRows)) {
      if (part.length) await tx.insert(schema.logs).values(part).onConflictDoNothing();
    }
    restoredTables.logs = logRows.length;

    const totalRows = Object.values(restoredTables).reduce((sum, n) => sum + n, 0);
    return { restoredTables, skippedKeys, warnings, totalRows };
  });
};
