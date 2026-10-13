import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  delivery_proofs,
  device_tokens,
  drivers,
  farmer_orders,
  farmers,
  invoices,
  products,
  users,
  weighbridge_records,
} from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { dayDistance, jalaliText } from '../../shared/jalali';
import { normalizeIranianPhone } from '../services/smsService';

const router = Router();

// Setup multer storage for proof of delivery uploads
const uploadsDir = path.resolve(
  process.env.UPLOAD_DIR || process.env.NIR_UPLOADS_PATH || path.join(process.cwd(), 'data', 'uploads')
);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueName = `pod-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit per image
});

const podUploadMiddleware = upload.fields([
  { name: 'photo_bill', maxCount: 1 },
  { name: 'photo_scale', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]);

/**
 * Save Base64 data URL to uploads directory
 */
const saveBase64Image = (dataUrl: string, prefix = 'img'): string | null => {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
  const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9-+.]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const filePath = path.join(uploadsDir, filename);

  fs.writeFileSync(filePath, buffer);
  return `/uploads/${filename}`;
};

// ============================================================================
// 1. App Metadata & Version Check (Public)
// ============================================================================

/**
 * GET /api/mobile/meta
 * Returns minAppVersion, currentAppVersion and maintenanceMode
 */
router.get('/meta', (_req: Request, res: Response) => {
  res.json({
    minAppVersion: process.env.MIN_MOBILE_APP_VERSION || '1.0.0',
    currentAppVersion: process.env.CURRENT_MOBILE_APP_VERSION || '1.0.0',
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
    serverTime: new Date().toISOString(),
    todayJalali: jalaliText(new Date()),
  });
});

// ============================================================================
// 2. Push Notification Device Token Registration
// ============================================================================

/**
 * POST /api/mobile/device-token
 * Registers or updates push notification token for the authenticated user
 */
router.post('/device-token', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || 'android').toLowerCase().trim();

    if (!token) {
      return res.status(400).json({ error: 'توکن دستگاه الزامی است.' });
    }

    const userId = req.user!.id;
    const existing = await db
      .select()
      .from(device_tokens)
      .where(and(eq(device_tokens.userId, userId), eq(device_tokens.token, token)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(device_tokens)
        .set({ platform, updatedAt: new Date() })
        .where(eq(device_tokens.id, existing[0].id));
    } else {
      await db.insert(device_tokens).values({
        userId,
        token,
        platform,
        updatedAt: new Date(),
      });
    }

    return res.json({ success: true, message: 'توکن نوتیفیکیشن با موفقیت ثبت شد.' });
  } catch (err: any) {
    console.error('[DEVICE TOKEN ERROR]:', err);
    return res.status(500).json({ error: 'خطا در ثبت توکن دستگاه.' });
  }
});

// ============================================================================
// 3. Driver Experience Endpoints
// ============================================================================

/**
 * GET /api/mobile/driver/loads
 * Returns active and completed loads assigned to the driver
 */
router.get('/driver/loads', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = (req.user?.role || '').toUpperCase();
    let driverId = req.user?.driverId;

    // Allow managers/admins to view loads for a specific driver via query param
    if ((userRole === 'ADMIN' || userRole === 'MANAGER') && req.query.driverId) {
      driverId = String(req.query.driverId);
    }

    // Resolve driver profile
    let driverRow: any = null;
    if (driverId) {
      const rows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
      driverRow = rows[0];
    } else if (req.user?.phone) {
      const normalizedPhone = normalizeIranianPhone(req.user.phone);
      const allDrivers = await db.select().from(drivers).where(isNull(drivers.deletedAt));
      driverRow = allDrivers.find((d: any) => normalizeIranianPhone(d.phone) === normalizedPhone);
    }

    if (!driverRow) {
      return res.json({
        driver: null,
        activeLoads: [],
        completedLoads: [],
      });
    }

    // Fetch invoices assigned to this driver by name or phone
    const driverName = driverRow.name;
    const driverPhone = driverRow.phone;

    // Phase 2 (G-16): the history is unbounded - the busiest driver on dev carries 526 loads, and the
    // server used to cap the whole list at the 100 newest rows, so older trips simply did not exist
    // for the app. `scope` now pages the list the screen actually renders (the POD-presence predicate
    // runs in SQL, so a page of "completed" is a page of completed loads), and the defaults reproduce
    // the pre-Phase-2 answer for APKs built before it: page 1, 100 rows, active + completed together.
    const scope = ['active', 'completed'].includes(String(req.query.scope)) ? String(req.query.scope) : 'all';
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit || '100'), 10) || 100));

    // Phase 1: the FK link is authoritative and is what the backfill populates. The legacy name/phone
    // predicates stay as a safety net for rows that are not mapped yet, so a driver never loses a
    // load that the old string matching used to find.
    const ownedByDriver = or(
      eq(invoices.driverId, driverRow.id),
      eq(invoices.driverName, driverName),
      driverPhone ? eq(invoices.driverPhone, driverPhone) : sql`FALSE`
    )!;
    const proofExists = sql`EXISTS (SELECT 1 FROM delivery_proofs p WHERE p.invoice_id = ${invoices.id})`;
    const loadWhere = and(
      isNull(invoices.deletedAt),
      ownedByDriver,
      ...(scope === 'active' ? [sql`NOT ${proofExists}`] : scope === 'completed' ? [proofExists] : [])
    );

    const totalRows = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(loadWhere);
    const total = Number(totalRows[0]?.count || 0);

    const invoiceList = await db
      .select()
      .from(invoices)
      .where(loadWhere)
      .orderBy(desc(invoices.date), desc(invoices.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const invoiceIds = invoiceList.map((i: any) => i.id);

    // Fetch existing delivery proofs
    const proofs = invoiceIds.length > 0
      ? await db
          .select()
          .from(delivery_proofs)
          .where(inArray(delivery_proofs.invoiceId, invoiceIds))
      : [];

    const proofMap = new Map<string, any>();
    for (const p of proofs) {
      if (p.invoiceId) proofMap.set(p.invoiceId, p);
    }

    // Fetch linked weighbridge tickets
    const wbTickets = invoiceIds.length > 0
      ? await db
          .select()
          .from(weighbridge_records)
          .where(inArray(weighbridge_records.mappedRemittanceId, invoiceIds))
      : [];

    const wbMap = new Map<string, any>();
    for (const wb of wbTickets) {
      if (wb.mappedRemittanceId) wbMap.set(wb.mappedRemittanceId, wb);
    }

    const activeLoads: any[] = [];
    const completedLoads: any[] = [];

    for (const inv of invoiceList) {
      const proof = proofMap.get(inv.id) || null;
      const wbTicket = wbMap.get(inv.id) || null;
      // A weighbridge ticket only has a «وزن خالص» once BOTH weighings exist (same rule as the web list
      // and the weighbridge monitor): the scale software persists `net = gross` for a first-weighing
      // ticket, so a stored net must never be handed to the app as a finished load.
      const wbGross = wbTicket?.grossWeight ? Number(wbTicket.grossWeight) : 0;
      const wbTare = wbTicket?.tareWeight ? Number(wbTicket.tareWeight) : 0;
      const wbNetted = wbGross > 0 && wbTare > 0;

      const item = {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber || inv.billNumber || '-',
        type: inv.type, // 'entry' | 'exit'
        date: inv.date,
        productName: inv.productName || 'نامشخص',
        sellerName: inv.sellerName || null,
        origin: inv.origin || null,
        destination: inv.farmerId ? 'مرغداری' : inv.factory || 'کارخانه آرادان',
        billWeight: inv.billWeight ? Number(inv.billWeight) : null,
        scaleWeight: inv.scaleWeight ? Number(inv.scaleWeight) : null,
        netWeight: inv.weight ? Number(inv.weight) : null,
        // `status` stays the coarse two-state field the pre-Phase-2 APKs render; `tripStatus` (Phase 2,
        // G-8) is the driver-reported progress. The delivery receipt stays authoritative: a load with a
        // proof is delivered whatever the reported column says (the PATCH endpoint refuses a
        // `delivered` report without a receipt, so the two can never contradict each other in practice).
        status: proof ? 'delivered' : 'in_transit',
        tripStatus: proof ? 'delivered' : inv.tripStatus || 'assigned',
        tripStatusAt: inv.tripStatusAt || null,
        hasProofOfDelivery: !!proof,
        proofOfDelivery: proof,
        weighbridge: wbTicket
          ? {
              ticketNumber: wbTicket.ticketNumber,
              grossWeight: wbGross || null,
              tareWeight: wbTare || null,
              netWeight: wbNetted ? (wbTicket.netWeight ? Number(wbTicket.netWeight) : wbGross - wbTare) : null,
              weighTime: wbTicket.weighTime,
              status: wbTicket.status,
            }
          : null,
      };

      if (proof) {
        completedLoads.push(item);
      } else {
        activeLoads.push(item);
      }
    }

    return res.json({
      driver: {
        id: driverRow.id,
        name: driverRow.name,
        phone: driverRow.phone,
        iban: driverRow.iban,
      },
      activeLoads,
      completedLoads,
      // Phase 2 paging metadata (extra fields; APKs built before Phase 2 ignore them).
      scope,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      activeCount: activeLoads.length,
      completedCount: completedLoads.length,
    });
  } catch (err: any) {
    console.error('[DRIVER LOADS ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت لیست بارهای راننده.' });
  }
});

/**
 * PATCH /api/mobile/driver/loads/:invoiceId/trip-status   (Phase 2, G-8)
 *
 * The driver reports where the truck is: assigned -> at the origin -> loading -> at the destination
 * -> unloading -> delivered. Phase 1 could only tell two states apart (`delivered` / `in_transit`)
 * and both were DERIVED from the delivery receipt, so the office had no way to see progress while a
 * truck was on the road.
 *
 * Contract rules (all enforced here, so no screen can corrupt a trip):
 *   * forward-only: a report can only move a load along the flow, never back (a stale offline queue
 *     replaying "at_origin" after "loading" is rejected with 409 instead of rewinding the trip);
 *   * `delivered` needs the delivery receipt (POD) - the receipt is the proof, not a button tap;
 *   * `cancelled` is a terminal state reachable from anything except `delivered`;
 *   * re-sending the state the load already has is a 200 no-op (`unchanged: true`), so an offline
 *     retry is safe;
 *   * a driver may only touch their own loads (FK when present, else the legacy name/phone match used
 *     by GET /driver/loads); ADMIN/MANAGER may correct any load.
 */
const TRIP_STATUS_FLOW = ['assigned', 'at_origin', 'loading', 'at_destination', 'unloading', 'delivered'] as const;
type TripStatus = (typeof TRIP_STATUS_FLOW)[number] | 'cancelled';
const isTripStatus = (value: string): value is TripStatus =>
  value === 'cancelled' || (TRIP_STATUS_FLOW as readonly string[]).includes(value);
const tripStatusRank = (value: TripStatus): number =>
  value === 'cancelled' ? -1 : TRIP_STATUS_FLOW.indexOf(value);

router.patch('/driver/loads/:invoiceId/trip-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const requested = String(req.body?.status || '').trim().toLowerCase();

    if (!invoiceId || !isTripStatus(requested)) {
      return res.status(400).json({
        error: `وضعیت ارسالی نامعتبر است. مقادیر مجاز: ${[...TRIP_STATUS_FLOW, 'cancelled'].join(' | ')}`,
      });
    }

    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)))
      .limit(1);
    if (!rows.length) {
      return res.status(404).json({ error: 'حواله مورد نظر یافت نشد.' });
    }
    const invoice: any = rows[0];

    // Authorization: staff may correct any load, a driver only their own.
    const role = String(req.user?.role || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      const myDriverId = req.user?.driverId || null;
      const myDriver = myDriverId
        ? (await db.select().from(drivers).where(eq(drivers.id, myDriverId)).limit(1))[0]
        : null;
      const ownsByFk = !!myDriverId && invoice.driverId === myDriverId;
      const ownsByLegacy =
        !!myDriver &&
        (invoice.driverName === myDriver.name || (!!myDriver.phone && invoice.driverPhone === myDriver.phone));
      if (!ownsByFk && !ownsByLegacy) {
        return res.status(403).json({ error: 'این حواله به شما تخصیص داده نشده است.' });
      }
    }

    const proofRows = await db
      .select({ id: delivery_proofs.id })
      .from(delivery_proofs)
      .where(eq(delivery_proofs.invoiceId, invoiceId))
      .limit(1);
    const hasProof = proofRows.length > 0;

    const current: TripStatus = (invoice.tripStatus as TripStatus) || (hasProof ? 'delivered' : 'assigned');

    if (requested === current) {
      return res.json({
        success: true,
        unchanged: true,
        invoiceId,
        tripStatus: current,
        tripStatusAt: invoice.tripStatusAt || null,
        message: 'این وضعیت قبلاً ثبت شده است.',
      });
    }
    if (current === 'delivered') {
      return res.status(409).json({ error: 'این سفر بسته شده است (رسید تحویل ثبت شده) و تغییر وضعیت آن مجاز نیست.' });
    }
    if (current === 'cancelled' && requested !== 'cancelled') {
      return res.status(409).json({ error: 'این سفر لغو شده است و بازگشت به وضعیت قبلی مجاز نیست.' });
    }
    if (requested === 'delivered' && !hasProof) {
      return res.status(409).json({ error: 'برای بستن سفر ابتدا رسید تحویل بار را ثبت کنید.' });
    }
    if (requested !== 'cancelled' && tripStatusRank(requested) < tripStatusRank(current)) {
      return res.status(409).json({
        error: `بازگشت به وضعیت «${requested}» از «${current}» مجاز نیست (فقط حرکت رو به جلو).`,
      });
    }

    const now = new Date();
    const [updated] = await db
      .update(invoices)
      .set({ tripStatus: requested, tripStatusAt: now, updatedBy: req.user?.username || req.user?.id || invoice.updatedBy })
      .where(eq(invoices.id, invoiceId))
      .returning();

    return res.json({
      success: true,
      unchanged: false,
      invoiceId,
      previousStatus: current,
      tripStatus: (updated as any)?.tripStatus || requested,
      tripStatusAt: (updated as any)?.tripStatusAt || now,
      message: 'وضعیت سفر به‌روزرسانی شد.',
    });
  } catch (err: any) {
    console.error('[DRIVER TRIP STATUS ERROR]:', err);
    return res.status(500).json({ error: 'خطا در به‌روزرسانی وضعیت سفر.' });
  }
});

/**
 * Proof of delivery (POD).
 *
 * POST /api/mobile/driver/delivery-receipt   <- canonical (the app calls this, see api/endpoints.ts)
 * POST /api/mobile/driver/proof              <- DEPRECATED alias for APKs built before Phase 1:
 *                                                the client used to call this path while the server
 *                                                only had the other one, and the old client mock
 *                                                engine hid the resulting 404.
 *
 * Phase 1 fixes inside the shared handler:
 *   * `driver_id` (FK to drivers) used to be filled with the invoice's driver *name*
 *     (`invRows[0].driverName`) when the caller had no driverId - a text value inside a FK column.
 *     It now uses the authenticated driver, else the invoice's linked driver, else NULL.
 *   * idempotency: re-submitting the same invoice returns the stored receipt instead of inserting
 *     a duplicate record (a retry after a timeout no longer creates a phantom delivery).
 */
const submitDeliveryReceipt = async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.body?.invoice_id || req.body?.invoiceId || '').trim();
    if (!invoiceId) {
      return res.status(400).json({ error: 'شناسه حواله (invoice_id) الزامی است.' });
    }

    // Verify invoice exists
    const invRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invRows.length) {
      return res.status(404).json({ error: 'حواله مورد نظر یافت نشد.' });
    }

    const invoice = invRows[0];

    // Idempotent replay: this invoice already carries a delivery receipt.
    const existingProofs = await db
      .select()
      .from(delivery_proofs)
      .where(eq(delivery_proofs.invoiceId, invoiceId))
      .orderBy(desc(delivery_proofs.id))
      .limit(1);

    if (existingProofs.length > 0) {
      return res.json({
        success: true,
        alreadyRegistered: true,
        message: 'رسید تحویل این حواله قبلاً ثبت شده است.',
        proof: existingProofs[0],
      });
    }

    // FK integrity: the authenticated driver first, then the invoice's linked driver. The free-text
    // driver_name is deliberately NOT used here any more (it is not a drivers.id).
    const driverId = req.user?.driverId || invoice.driverId || null;

    // Handle files from multipart upload or base64 fallback in body
    const files = (req as any).files || {};

    let photoBillUrl: string | null = null;
    let photoScaleUrl: string | null = null;
    let signatureUrl: string | null = null;

    if (files.photo_bill && files.photo_bill[0]) {
      photoBillUrl = `/uploads/${files.photo_bill[0].filename}`;
    } else if (req.body?.photo_bill_base64) {
      photoBillUrl = saveBase64Image(req.body.photo_bill_base64, 'bill');
    }

    if (files.photo_scale && files.photo_scale[0]) {
      photoScaleUrl = `/uploads/${files.photo_scale[0].filename}`;
    } else if (req.body?.photo_scale_base64) {
      photoScaleUrl = saveBase64Image(req.body.photo_scale_base64, 'scale');
    }

    if (files.signature && files.signature[0]) {
      signatureUrl = `/uploads/${files.signature[0].filename}`;
    } else if (req.body?.signature_base64) {
      signatureUrl = saveBase64Image(req.body.signature_base64, 'sig');
    }

    const latitude = req.body?.latitude != null ? String(req.body.latitude) : null;
    const longitude = req.body?.longitude != null ? String(req.body.longitude) : null;

    // Save Proof of Delivery record
    const [proof] = await db
      .insert(delivery_proofs)
      .values({
        invoiceId,
        driverId,
        photoBillUrl,
        photoScaleUrl,
        signatureUrl,
        latitude: latitude ? (latitude as any) : null,
        longitude: longitude ? (longitude as any) : null,
        deliveredAt: new Date(),
        createdAt: new Date(),
      })
      .returning();

    // Phase 2 (G-8): the delivery receipt IS the end of the trip, so the reported state follows the
    // receipt (the PATCH /driver/loads/:id/trip-status endpoint enforces the same rule from the other
    // side). The guard keeps an idempotent retry from rewriting a row that is already `delivered` -
    // and it is written with raw SQL on purpose, so it stays a single no-op UPDATE.
    await db
      .update(invoices)
      .set({ tripStatus: 'delivered', tripStatusAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), sql`${invoices.tripStatus} IS DISTINCT FROM 'delivered'`));

    return res.status(201).json({
      success: true,
      message: 'رسید تحویل بار با موفقیت ثبت شد.',
      proof,
    });
  } catch (err: any) {
    console.error('[DELIVERY RECEIPT ERROR]:', err);
    return res.status(500).json({ error: 'خطا در ثبت رسید تحویل بار.' });
  }
};

router.post('/driver/delivery-receipt', requireAuth, podUploadMiddleware, submitDeliveryReceipt);
router.post('/driver/proof', requireAuth, podUploadMiddleware, submitDeliveryReceipt);

// ============================================================================
// 4. Farmer Experience Endpoints
// ============================================================================

/**
 * GET /api/mobile/farmer/dashboard
 * Active breeding cycle, herd age, total consumed feed, last delivery
 */
router.get('/farmer/dashboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = (req.user?.role || '').toUpperCase();
    let farmerId = req.user?.farmerId;

    if ((userRole === 'ADMIN' || userRole === 'MANAGER') && req.query.farmerId) {
      farmerId = String(req.query.farmerId);
    }

    let farmerRow: any = null;
    if (farmerId) {
      const rows = await db.select().from(farmers).where(eq(farmers.id, farmerId)).limit(1);
      farmerRow = rows[0];
    } else if (req.user?.phone) {
      const normalizedPhone = normalizeIranianPhone(req.user.phone);
      const allFarmers = await db.select().from(farmers).where(isNull(farmers.deletedAt));
      farmerRow = allFarmers.find((f: any) => normalizeIranianPhone(f.phone) === normalizedPhone);
    }

    if (!farmerRow) {
      return res.json({
        farmer: null,
        activeBrood: null,
        herdAgeDays: 0,
        totalFeedKg: 0,
        lastDelivery: null,
      });
    }

    // Identify active breeding period from farmer.broods
    const broods = Array.isArray(farmerRow.broods) ? farmerRow.broods : [];
    const activeBroods = broods.filter((b: any) => !b.deletedAt && !b.isArchived);
    // Select the latest active brood period
    const activeBrood = activeBroods.length > 0 ? activeBroods[activeBroods.length - 1] : null;

    let herdAgeDays = 0;
    const todayJalali = jalaliText(new Date());

    if (activeBrood && activeBrood.startDate) {
      const distance = dayDistance(activeBrood.startDate, todayJalali);
      herdAgeDays = distance != null ? distance : 0;
    }

    // Query exit invoices for this farmer
    const farmerInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          isNull(invoices.deletedAt),
          eq(invoices.farmerId, farmerRow.id),
          eq(invoices.type, 'exit')
        )
      )
      .orderBy(desc(invoices.date), desc(invoices.createdAt));

    let totalFeedKg = 0;
    for (const inv of farmerInvoices) {
      // If active brood has a start date, sum only invoices on or after startDate
      if (activeBrood?.startDate && inv.date < activeBrood.startDate) {
        continue;
      }
      const w = Number(inv.scaleWeight || inv.weight || inv.billWeight || 0);
      totalFeedKg += w;
    }

    const lastDelivery = farmerInvoices.length > 0
      ? {
          id: farmerInvoices[0].id,
          date: farmerInvoices[0].date,
          productName: farmerInvoices[0].productName,
          weight: Number(farmerInvoices[0].scaleWeight || farmerInvoices[0].weight || 0),
          invoiceNumber: farmerInvoices[0].invoiceNumber,
        }
      : null;

    return res.json({
      farmer: {
        id: farmerRow.id,
        name: farmerRow.name,
        phone: farmerRow.phone,
      },
      activeBrood,
      herdAgeDays,
      totalFeedKg,
      lastDelivery,
      totalDeliveriesCount: farmerInvoices.length,
    });
  } catch (err: any) {
    console.error('[FARMER DASHBOARD ERROR]:', err);
    return res.status(500).json({ error: 'خطا در بارگذاری داشبورد مرغدار.' });
  }
});

/**
 * GET /api/mobile/farmer/invoices
 * Invoices list with factory scale weight, bill weight, and computed weight delta
 */
router.get('/farmer/invoices', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = (req.user?.role || '').toUpperCase();
    let farmerId = req.user?.farmerId;

    if ((userRole === 'ADMIN' || userRole === 'MANAGER') && req.query.farmerId) {
      farmerId = String(req.query.farmerId);
    }

    if (!farmerId) {
      return res.status(400).json({ error: 'شناسه مرغدار مشخص نشده است.' });
    }

    const rows = await db
      .select()
      .from(invoices)
      .where(
        and(
          isNull(invoices.deletedAt),
          eq(invoices.farmerId, farmerId),
          eq(invoices.type, 'exit')
        )
      )
      .orderBy(desc(invoices.date), desc(invoices.createdAt))
      .limit(200);

    const formatted = rows.map((inv: any) => {
      const billWeight = inv.billWeight ? Number(inv.billWeight) : 0;
      const scaleWeight = inv.scaleWeight ? Number(inv.scaleWeight) : Number(inv.weight || 0);
      const weightDelta = scaleWeight - billWeight;
      const isMatched = Math.abs(weightDelta) <= 50; // Tolerance of 50kg

      return {
        id: inv.id,
        date: inv.date,
        invoiceNumber: inv.invoiceNumber || '-',
        productName: inv.productName || 'دان مصرفی',
        driverName: inv.driverName || 'نامشخص',
        billWeight,
        scaleWeight,
        weightDelta,
        toleranceStatus: isMatched ? 'matched' : 'discrepancy',
      };
    });

    return res.json({ invoices: formatted });
  } catch (err: any) {
    console.error('[FARMER INVOICES ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت لیست حواله‌های مرغدار.' });
  }
});

/**
 * POST /api/mobile/farmer/orders
 * Creates a feed order in farmer_orders table
 */
router.post('/farmer/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = (req.user?.role || '').toUpperCase();
    let farmerId = req.user?.farmerId;

    if ((userRole === 'ADMIN' || userRole === 'MANAGER') && req.body?.farmerId) {
      farmerId = String(req.body.farmerId);
    }

    if (!farmerId) {
      return res.status(400).json({ error: 'حساب کاربری به هیچ مرغداری متصل نیست.' });
    }

    const productId = req.body?.productId ? String(req.body.productId) : null;
    const requestedWeight = Number(req.body?.requestedWeight || req.body?.requested_weight || 0);
    const targetDate = String(req.body?.targetDate || req.body?.target_date || '').trim();
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;

    if (requestedWeight <= 0) {
      return res.status(400).json({ error: 'تناژ درخواستی باید بزرگتر از صفر باشد.' });
    }

    if (!targetDate) {
      return res.status(400).json({ error: 'تاریخ پیشنهادی تحویل (شمسی) الزامی است.' });
    }

    const [order] = await db
      .insert(farmer_orders)
      .values({
        farmerId,
        productId,
        requestedWeight: String(requestedWeight) as any,
        targetDate,
        notes,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'سفارش دان با موفقیت ثبت شد و در انتظار تایید کارخانه قرار گرفت.',
      order,
    });
  } catch (err: any) {
    console.error('[FARMER ORDER CREATE ERROR]:', err);
    return res.status(500).json({ error: 'خطا در ثبت سفارش دان.' });
  }
});

// ============================================================================
// 5. Manager Experience Endpoints
// ============================================================================

/**
 * GET /api/mobile/manager/kpi
 * Cumulative entry/exit tonnage for today, synced weighbridge count, live warehouse stock
 */
router.get('/manager/kpi', requireAuth, requireRole('ADMIN', 'MANAGER'), async (_req: Request, res: Response) => {
  try {
    const todayJalali = jalaliText(new Date());

    // Invoices for today
    const todayInvoices = await db
      .select()
      .from(invoices)
      .where(and(isNull(invoices.deletedAt), eq(invoices.date, todayJalali)));

    let entryTonnageKg = 0;
    let exitTonnageKg = 0;

    for (const inv of todayInvoices) {
      const w = Number(inv.scaleWeight || inv.weight || inv.billWeight || 0);
      if (inv.type === 'entry') {
        entryTonnageKg += w;
      } else if (inv.type === 'exit') {
        exitTonnageKg += w;
      }
    }

    // Weighbridge records synced or weighed today
    const wbTodayCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(weighbridge_records)
      .where(sql`weigh_time::date = CURRENT_DATE OR last_synced_at::date = CURRENT_DATE`);

    // Live inventory for active products
    const productRows = await db
      .select({
        id: products.id,
        name: products.name,
        type: products.type,
        unit: products.unit,
        currentStock: products.currentStock,
        minStock: products.minStock,
      })
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.isActive, true)));

    const inventory = productRows.map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      unit: p.unit || 'kg',
      currentStock: Number(p.currentStock || 0),
      minStock: p.minStock ? Number(p.minStock) : null,
    }));

    return res.json({
      todayJalali,
      entryTonnageKg,
      exitTonnageKg,
      entryTonnageTon: Number((entryTonnageKg / 1000).toFixed(2)),
      exitTonnageTon: Number((exitTonnageKg / 1000).toFixed(2)),
      todayInvoicesCount: todayInvoices.length,
      weighbridgeTicketsToday: Number(wbTodayCount[0]?.count || 0),
      inventory,
    });
  } catch (err: any) {
    console.error('[MANAGER KPI ERROR]:', err);
    return res.status(500).json({ error: 'خطا در بارگذاری شاخص‌های کلیدی (KPI).' });
  }
});

/**
 * GET /api/mobile/manager/weighbridge
 * List of active weighbridge records from weighbridge_records table
 */
router.get('/manager/weighbridge', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const status = req.query.status ? String(req.query.status) : null;

    let query = db.select().from(weighbridge_records);

    if (status) {
      query = query.where(eq(weighbridge_records.status, status)) as any;
    }

    const records = await query
      .orderBy(desc(weighbridge_records.weighTime), desc(weighbridge_records.createdAt))
      .limit(limit);

    const formatted = records.map((r: any) => {
      const gross = r.grossWeight ? Number(r.grossWeight) : 0;
      const tare = r.tareWeight ? Number(r.tareWeight) : 0;
      // «خالص‌شده» needs BOTH weighings: the old `gross - tare` fallback returned the FULL load as «net»
      // for a ticket that had only been weighed once (its other column still 0), so the monitor screen
      // showed a half-weighed truck as netted. The stored net is only trusted once both weighings exist,
      // and the net stays null (→ «در انتظار خروج» in the app) until then.
      const net = gross > 0 && tare > 0 ? (r.netWeight ? Number(r.netWeight) : gross - tare) : null;

      return {
        id: r.id,
        externalId: r.externalId,
        ticketNumber: r.ticketNumber || '-',
        plateNumber: r.plateNumber || '-',
        driverName: r.driverName || 'نامشخص',
        customerName: r.customerName || null,
        goods: r.goods || null,
        direction: r.direction,
        status: r.status,
        grossWeight: gross,
        tareWeight: tare,
        netWeight: net,
        weighTime: r.weighTime,
        isMapped: !!r.mappedRemittanceId,
        mappedRemittanceId: r.mappedRemittanceId,
      };
    });

    return res.json({ records: formatted });
  } catch (err: any) {
    console.error('[MANAGER WEIGHBRIDGE ERROR]:', err);
    return res.status(500).json({ error: 'خطا در دریافت اطلاعات قبوض باسکول.' });
  }
});

export default router;
