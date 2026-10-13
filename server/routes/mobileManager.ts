import { Router, type Request, type Response } from 'express';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { delivery_proofs, drivers, farmer_orders, farmers, invoices, products } from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { findClosestName, normalizePersianText, normalizePhone, textMatchKey } from '../../shared/persianText';

/**
 * Manager cartable (کارتابل) endpoints.
 *
 * These three routes were the missing half of the manager experience: `ApprovalsScreen.tsx` has
 * always called them, they were never implemented on the server, and the client-side mock engine
 * answered with fabricated rows, so the tab looked alive while nothing real was behind it.
 *
 *   GET   /api/mobile/manager/orders?status=pending&limit=50
 *   PATCH /api/mobile/manager/orders/:orderId   { status: 'approved' | 'rejected' }
 *   GET   /api/mobile/manager/proofs?limit=50
 *
 * Access is restricted to ADMIN/MANAGER (requireRole also lets ADMIN through everywhere).
 */
const router = Router();

const clampLimit = (raw: unknown, fallback = 50, max = 200): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

/** Absolute URL for a stored `/uploads/...` path, so the app can render it directly. */
const toAbsoluteUrl = (req: Request, value: string | null): string | null => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = req.get('host');
  return host ? `${proto}://${host}${value.startsWith('/') ? '' : '/'}${value}` : value;
};

const ORDER_STATUSES = ['pending', 'approved', 'rejected', 'completed'] as const;

/**
 * PATCH /api/mobile/manager/orders/:orderId
 * Approve or reject a feed order. Only the statuses the cartable offers are accepted, so a typo
 * cannot park an order in a state no screen understands.
 */
router.patch('/orders/:orderId', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'شناسه سفارش نامعتبر است.' });
    }

    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!ORDER_STATUSES.includes(nextStatus as any)) {
      return res.status(400).json({
        error: 'وضعیت ارسالی نامعتبر است. مقادیر مجاز: pending | approved | rejected | completed',
      });
    }

    const updated = await db
      .update(farmer_orders)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(farmer_orders.id, orderId))
      .returning();

    if (!updated.length) {
      return res.status(404).json({ error: 'سفارش مورد نظر یافت نشد.' });
    }

    const message =
      nextStatus === 'approved'
        ? 'سفارش جیره تایید شد.'
        : nextStatus === 'rejected'
        ? 'سفارش جیره رد شد.'
        : 'وضعیت سفارش به‌روزرسانی شد.';

    return res.json({ success: true, message, order: updated[0] });
  } catch (err: any) {
    console.error('[MANAGER ORDER UPDATE ERROR]:', err);
    return res.status(500).json({ error: 'خطا در به‌روزرسانی وضعیت سفارش.' });
  }
});

/**
 * GET /api/mobile/manager/proofs
 * Delivery receipts (POD) submitted by drivers, newest first, with image URLs usable by the app.
 */
router.get('/proofs', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const limit = clampLimit(req.query.limit);

    const rows = await db
      .select({
        id: delivery_proofs.id,
        invoiceId: delivery_proofs.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDriverName: invoices.driverName,
        driverId: delivery_proofs.driverId,
        driverName: drivers.name,
        farmerName: farmers.name,
        photoBillUrl: delivery_proofs.photoBillUrl,
        photoScaleUrl: delivery_proofs.photoScaleUrl,
        signatureUrl: delivery_proofs.signatureUrl,
        latitude: delivery_proofs.latitude,
        longitude: delivery_proofs.longitude,
        deliveredAt: delivery_proofs.deliveredAt,
        createdAt: delivery_proofs.createdAt,
      })
      .from(delivery_proofs)
      .leftJoin(invoices, eq(delivery_proofs.invoiceId, invoices.id))
      .leftJoin(drivers, eq(delivery_proofs.driverId, drivers.id))
      .leftJoin(farmers, eq(invoices.farmerId, farmers.id))
      .orderBy(desc(delivery_proofs.createdAt), desc(delivery_proofs.id))
      .limit(limit);

    const proofs = rows.map((row: any) => ({
      ...row,
      driverName: row.driverName || row.invoiceDriverName || null,
      photoBillUrl: toAbsoluteUrl(req, row.photoBillUrl),
      photoScaleUrl: toAbsoluteUrl(req, row.photoScaleUrl),
      signatureUrl: toAbsoluteUrl(req, row.signatureUrl),
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
    }));

    return res.json({ proofs, count: proofs.length });
  } catch (err: any) {
    console.error('[MANAGER PROOFS ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت رسیدهای تحویل بار.' });
  }
});

router.get('/orders', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const limit = clampLimit(req.query.limit);
    const status = req.query.status ? String(req.query.status).trim() : null;

    const base = db
      .select({
        id: farmer_orders.id,
        farmerId: farmer_orders.farmerId,
        farmerName: farmers.name,
        productId: farmer_orders.productId,
        productName: products.name,
        requestedWeight: farmer_orders.requestedWeight,
        targetDate: farmer_orders.targetDate,
        notes: farmer_orders.notes,
        status: farmer_orders.status,
        createdAt: farmer_orders.createdAt,
        updatedAt: farmer_orders.updatedAt,
      })
      .from(farmer_orders)
      .leftJoin(farmers, eq(farmer_orders.farmerId, farmers.id))
      .leftJoin(products, eq(farmer_orders.productId, products.id));

    const rows = await (status ? base.where(eq(farmer_orders.status, status)) : base)
      .orderBy(desc(farmer_orders.createdAt))
      .limit(limit);

    const orders = rows.map((row: any) => ({
      ...row,
      // numeric columns arrive as strings from PostgreSQL; the app formats numbers.
      requestedWeight: row.requestedWeight != null ? Number(row.requestedWeight) : 0,
    }));

    return res.json({ orders, count: orders.length, status: status || 'all' });
  } catch (err: any) {
    console.error('[MANAGER ORDERS ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت کارتابل سفارش‌های جیره.' });
  }
});

// ============================================================================
// Phase 2 (G-7): unmatched driver names - «راننده‌های نامطابق»
// ============================================================================

/** Safety cap on the scan, so a pathological database cannot turn this screen into a full-table read. */
const UNMATCHED_SCAN_CAP = 5000;

/**
 * GET /api/mobile/manager/unmatched-drivers
 *
 * Remittances that carry a driver *name* but no `driver_id` link, grouped by that name. Phase 1
 * backfilled 2,855 of the 3,123 remittances on dev by exact/normalised name; the leftovers are rows
 * whose name has no driver record at all, which is what the office needs to see: either the driver is
 * missing from the registry, or the name on the waybill is spelled differently.
 *
 * Read-only by design. The response carries the grouped evidence plus the best candidate per name
 * (`phone` > exact normalised name > typo-level match, and explicitly `ambiguous` when a name matches
 * more than one driver), so the actual write (create / link the driver) stays a separate, deliberate
 * action that can never silently move a waybill onto the wrong driver.
 *
 *   GET /api/mobile/manager/unmatched-drivers?type=exit&search=حسن&page=1&limit=50
 */
router.get('/unmatched-drivers', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const type = req.query.type === 'entry' || req.query.type === 'exit' ? String(req.query.type) : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = clampLimit(req.query.limit);

    const conditions = [
      isNull(invoices.deletedAt),
      isNull(invoices.driverId),
      isNotNull(invoices.driverName),
      sql`btrim(${invoices.driverName}) <> ''`,
    ];
    if (type) conditions.push(eq(invoices.type, type));

    const rows = await db
      .select({
        id: invoices.id,
        type: invoices.type,
        date: invoices.date,
        driverName: invoices.driverName,
        driverPhone: invoices.driverPhone,
        invoiceNumber: invoices.invoiceNumber,
        billNumber: invoices.billNumber,
        productName: invoices.productName,
      })
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.date), desc(invoices.createdAt))
      .limit(UNMATCHED_SCAN_CAP);

    const driverRows = await db
      .select({ id: drivers.id, name: drivers.name, phone: drivers.phone })
      .from(drivers)
      .where(isNull(drivers.deletedAt));

    // Suggestion indexes. A phone that belongs to more than one driver is recorded as ambiguous
    // instead of being dropped, so the screen can say "this number is duplicated" rather than nothing.
    const byNameKey = new Map<string, { id: string; name: string }[]>();
    const byPhone = new Map<string, { id: string; name: string } | 'ambiguous'>();
    for (const d of driverRows) {
      const nameKey = textMatchKey(d.name);
      if (nameKey) {
        const bucket = byNameKey.get(nameKey) || [];
        bucket.push({ id: d.id, name: d.name });
        byNameKey.set(nameKey, bucket);
      }
      const phoneKey = normalizePhone(d.phone);
      if (phoneKey) {
        byPhone.set(phoneKey, byPhone.has(phoneKey) ? 'ambiguous' : { id: d.id, name: d.name });
      }
    }

    type UnmatchedGroup = {
      key: string;
      nameCounts: Map<string, number>;
      count: number;
      exitCount: number;
      entryCount: number;
      oldestDate: string | null;
      newestDate: string | null;
      phones: Set<string>;
      sampleInvoices: string[];
      invoiceIds: string[];
    };

    const groups = new Map<string, UnmatchedGroup>();
    for (const row of rows) {
      const key = textMatchKey(row.driverName);
      if (!key) continue;

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          nameCounts: new Map(),
          count: 0,
          exitCount: 0,
          entryCount: 0,
          oldestDate: null,
          newestDate: null,
          phones: new Set(),
          sampleInvoices: [],
          invoiceIds: [],
        };
        groups.set(key, group);
      }

      const display = normalizePersianText(row.driverName) || String(row.driverName || '');
      group.nameCounts.set(display, (group.nameCounts.get(display) || 0) + 1);
      group.count += 1;
      if (row.type === 'exit') group.exitCount += 1;
      else group.entryCount += 1;
      if (row.date) {
        if (!group.newestDate || row.date > group.newestDate) group.newestDate = row.date;
        if (!group.oldestDate || row.date < group.oldestDate) group.oldestDate = row.date;
      }
      const phone = normalizePhone(row.driverPhone);
      if (phone) group.phones.add(phone);
      if (group.sampleInvoices.length < 3) {
        const label = row.invoiceNumber || row.billNumber;
        if (label) group.sampleInvoices.push(label);
      }
      group.invoiceIds.push(row.id);
    }

    const searchKey = textMatchKey(search);
    const all = [...groups.values()]
      .map((group) => {
        // The most frequent spelling wins, so the screen shows the name the office actually types.
        const driverName = [...group.nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

        let suggested: { id: string; name: string } | null = null;
        let reason: 'phone' | 'name-exact' | 'name-close' | 'ambiguous' | 'none' = 'none';

        // 1) A phone on the waybill that belongs to exactly one driver is the strongest evidence.
        for (const phone of group.phones) {
          const hit = byPhone.get(phone);
          if (hit === 'ambiguous') {
            reason = 'ambiguous';
            break;
          }
          if (hit) {
            suggested = hit;
            reason = 'phone';
            break;
          }
        }

        // 2) Otherwise the normalised name, but only when it identifies ONE driver.
        if (!suggested && reason !== 'ambiguous') {
          const exact = byNameKey.get(group.key) || [];
          if (exact.length === 1) {
            suggested = exact[0];
            reason = 'name-exact';
          } else if (exact.length > 1) {
            reason = 'ambiguous';
          }
        }

        // 3) Last resort: a typo-level match, clearly labelled as a suggestion.
        if (!suggested && reason === 'none') {
          const close = findClosestName(driverName, driverRows as any[], (d: any) => d.name, 2);
          if (close) {
            suggested = { id: close.candidate.id, name: close.name };
            reason = 'name-close';
          }
        }

        return {
          driverName,
          nameKey: group.key,
          count: group.count,
          exitCount: group.exitCount,
          entryCount: group.entryCount,
          oldestDate: group.oldestDate,
          newestDate: group.newestDate,
          phones: [...group.phones],
          sampleInvoices: group.sampleInvoices,
          // Bounded so one pathological name cannot bloat the payload; `count` above stays exact.
          invoiceIds: group.invoiceIds.slice(0, 200),
          suggestedDriverId: suggested?.id || null,
          suggestedDriverName: suggested?.name || null,
          suggestionReason: reason,
        };
      })
      .filter((group) => (searchKey ? textMatchKey(group.driverName).includes(searchKey) : true))
      .sort((a, b) => b.count - a.count || String(b.newestDate).localeCompare(String(a.newestDate)));

    const totalGroups = all.length;
    const pageGroups = all.slice((page - 1) * limit, (page - 1) * limit + limit);

    return res.json({
      groups: pageGroups,
      totalGroups,
      totalInvoices: all.reduce((sum, group) => sum + group.count, 0),
      scannedInvoices: rows.length,
      scanCap: UNMATCHED_SCAN_CAP,
      truncated: rows.length >= UNMATCHED_SCAN_CAP,
      driversIndexed: driverRows.length,
      type: type || 'all',
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalGroups / limit)),
    });
  } catch (err: any) {
    console.error('[MANAGER UNMATCHED DRIVERS ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت لیست راننده‌های نامطابق.' });
  }
});

export default router;
