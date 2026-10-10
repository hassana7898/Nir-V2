import express from 'express';
import { db } from '../db';
import { farmers } from '../db/schema';
import { eq, isNull, asc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireRole } from '../middleware/auth';
import { actorFromRequest, recordAudit } from '../services/auditService';
import { mergeFarmers, adoptInvoices, deleteBrood, restoreBrood } from '../services/farmerService';
import { createSuccessResponse, toApiError } from '../../shared/apiContract';
import { farmerNameKey, normalizePersianText, normalizePhone } from '../../shared/persianText';
import { mergeBroods } from '../../shared/broodMerge';

const router = express.Router();

/**
 * Sanitise a farmer payload.
 * `normalizePersianText` also fixes the duplicate-farmer bug: Arabic ي/ك and stray/NBSP spaces
 * are folded into their Persian equivalents BEFORE the row is written, so the same human can no
 * longer exist twice (which is what broke Period Management).
 */
const sanitizeFarmerName = (name: unknown): string => normalizePersianText(name);
const sanitizePhone = (phone: unknown): string | null => {
  if (phone === undefined || phone === null) return null;
  const normalized = normalizePhone(phone);
  return normalized === '' ? null : normalized;
};

type FarmerRow = typeof farmers.$inferSelect;
const farmerNameCollides = (a: string | null, b: string | null): boolean => {
  const ka = farmerNameKey(a || '');
  const kb = farmerNameKey(b || '');
  return ka !== '' && ka === kb;
};
/** Two rows are the same person when their phones do not contradict each other. */
const phonesCompatible = (a: string | null, b: string | null): boolean => {
  const pa = normalizePhone(a || '');
  const pb = normalizePhone(b || '');
  return pa === '' || pb === '' || pa === pb;
};

// GET /api/farmers - Get all active farmers
router.get('/', async (_req, res) => {
  try {
    const list = await db
      .select()
      .from(farmers)
      .where(isNull(farmers.deletedAt))
      .orderBy(asc(farmers.name));
    res.json({ data: list });
  } catch (error: any) {
    console.error('Fetch farmers error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch farmers.' });
  }
});

// POST /api/farmers - Create a new farmer (or reuse/merge into the existing one with the same name)
//
// DUPLICATE PREVENTION: the client's local id is honoured (`id` in the body), and before inserting
// we look for a live farmer whose *normalised* name matches. When the phone does not contradict it,
// the payload is folded into that row instead of creating a twin, and the response reports
// `reused: true` together with the surviving id so the client can re-link its local references.
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const operationId = (req.headers['x-operation-id'] as string) || randomUUID();
  try {
    const { id, name, phone, broods, isHidden } = req.body;
    const farmerName = sanitizeFarmerName(name);
    if (!farmerName) {
      return res.status(400).json({ error: 'Farmer name is required.' });
    }
    const farmerPhone = sanitizePhone(phone);
    const farmerBroods = Array.isArray(broods) ? broods : [];
    const requestedId = id ? String(id) : randomUUID();

    const result = await db.transaction(async (tx: any) => {
      const live: FarmerRow[] = await tx.select().from(farmers).where(isNull(farmers.deletedAt));

      const duplicate = live.find(
        (f) => f.id !== requestedId
          && farmerNameCollides(f.name, farmerName)
          && phonesCompatible(f.phone, farmerPhone),
      );

      if (duplicate) {
        // Same person, second row: fold the new broods/phone in and report the surviving id.
        // `mergeBroods` applies the same deep de-duplication as the farmer merge, so a period that
        // already exists on the surviving row is combined instead of duplicated.
        const updated = {
          broods: mergeBroods(duplicate.broods, farmerBroods),
          phone: duplicate.phone || farmerPhone,
          isHidden: false,
          updatedAt: new Date(),
          version: sql`${farmers.version} + 1`,
        };
        await tx.update(farmers).set(updated).where(eq(farmers.id, duplicate.id));
        await recordAudit(tx, actorFromRequest(req), {
          action: 'UPDATE',
          entity: 'farmer',
          targetIds: [duplicate.id, requestedId],
          context: { reused: true, requestedId, name: farmerName },
          details: `جلوگیری از ثبت مرغدار تکراری «${farmerName}»؛ سوابق به رکورد موجود منتقل شد`,
        });
        return { farmer: { ...duplicate, ...updated }, reused: duplicate.id !== requestedId, requestedId };
      }

      const newFarmer = {
        id: requestedId,
        name: farmerName,
        phone: farmerPhone,
        broods: farmerBroods,
        isHidden: Boolean(isHidden),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      await tx.insert(farmers).values(newFarmer).onConflictDoUpdate({
        target: farmers.id,
        set: {
          name: newFarmer.name,
          phone: newFarmer.phone,
          broods: newFarmer.broods,
          isHidden: newFarmer.isHidden,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });

      return { farmer: newFarmer, reused: false, requestedId };
    });

    res.status(201).json(createSuccessResponse({ ...result.farmer, reused: result.reused, requestedId: result.requestedId }, operationId, (result.farmer as any).version || 1));
  } catch (error: any) {
    console.error('Create farmer error:', error);
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// POST /api/farmers/merge - Merge a farmer (source) into another (target) inside ONE transaction.
router.post('/merge', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const operationId = (req.headers['x-operation-id'] as string) || randomUUID();
  try {
    const { sourceId, targetId } = req.body || {};
    const result = await mergeFarmers(String(sourceId || ''), String(targetId || ''), actorFromRequest(req));
    console.log(`[NIR] farmer merge ${result.sourceName} -> ${result.targetName}: ${result.movedInvoices} invoice(s) re-pointed, ${result.movedBroods} brood(s) moved`);
    res.json(createSuccessResponse(result, operationId, 1));
  } catch (error: any) {
    console.error('Merge farmers error:', error);
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// POST /api/farmers/:id/adopt-invoices - Re-link orphaned exit invoices to this farmer.
router.post('/:id/adopt-invoices', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const operationId = (req.headers['x-operation-id'] as string) || randomUUID();
  try {
    const { invoiceIds } = req.body || {};
    const result = await adoptInvoices(String(req.params.id), Array.isArray(invoiceIds) ? invoiceIds : [], actorFromRequest(req));
    res.json(createSuccessResponse(result, operationId, 1));
  } catch (error: any) {
    console.error('Adopt invoices error:', error);
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// PUT /api/farmers/:id - Update an existing farmer
router.put('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name, phone, broods, isHidden } = req.body;

    const updatePayload: any = { updatedAt: new Date() };
    if (name !== undefined) {
      const sanitized = sanitizeFarmerName(name);
      if (!sanitized) return res.status(400).json({ error: 'Farmer name is required.' });
      updatePayload.name = sanitized;
    }
    if (phone !== undefined) updatePayload.phone = sanitizePhone(phone);
    if (broods !== undefined) updatePayload.broods = Array.isArray(broods) ? broods : [];
    if (isHidden !== undefined) updatePayload.isHidden = Boolean(isHidden);

    await db.update(farmers).set(updatePayload).where(eq(farmers.id, id));

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Update farmer error:', error);
    res.status(400).json({ error: error.message || 'Failed to update farmer.' });
  }
});

// DELETE /api/farmers/:id - Soft delete a farmer
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = String(req.params.id);
    await db
      .update(farmers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(farmers.id, id));

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete farmer error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete farmer.' });
  }
});

// DELETE /api/farmers/:id/broods/:broodId - SOFT delete one period (recycle bin, restorable)
router.delete('/:id/broods/:broodId', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const operationId = (req.headers['x-operation-id'] as string) || randomUUID();
  try {
    const result = await deleteBrood(String(req.params.id), String(req.params.broodId), actorFromRequest(req));
    res.json(createSuccessResponse(result, operationId, 1));
  } catch (error: any) {
    console.error('Delete brood error:', error);
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// PUT /api/farmers/:id/broods/:broodId/restore - clear the soft-delete flag of one period
router.put('/:id/broods/:broodId/restore', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const operationId = (req.headers['x-operation-id'] as string) || randomUUID();
  try {
    const result = await restoreBrood(String(req.params.id), String(req.params.broodId), actorFromRequest(req));
    res.json(createSuccessResponse(result, operationId, 1));
  } catch (error: any) {
    console.error('Restore brood error:', error);
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

export default router;
