import express from 'express';
import { z } from 'zod';
import { findInvoicesWithPagination } from '../repositories/invoiceRepository';
import {
  createInvoiceInTransaction,
  updateInvoiceInTransaction,
  deleteInvoiceInTransaction,
  bulkMoveInvoicesWithTransaction
} from '../services/invoiceService';
import { requireRole } from '../middleware/auth';
import { executeIdempotentOperation } from '../services/idempotencyService';
import { createSuccessResponse, createErrorResponse, toApiError } from '../../shared/apiContract';
import { db } from '../db';
import { invoices } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

const InvoiceSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['entry', 'exit']),
  date: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().optional(),
  driverName: z.string().optional(),
  sellerName: z.string().optional(),
  billWeight: z.union([z.string(), z.number()]).optional(),
  scaleWeight: z.union([z.string(), z.number()]).optional(),
  factory: z.string().optional(),
  billNumber: z.string().optional(),
  origin: z.string().optional(),
  transportCost: z.union([z.string(), z.number()]).optional(),
  driverPhone: z.string().optional(),
  driverIBAN: z.string().optional(),
  wastage: z.union([z.string(), z.number()]).optional(),
  farmerId: z.string().optional(),
  farmerName: z.string().optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  invoiceNumber: z.string().optional(),
  productVariant: z.string().optional(),
  isCrumble: z.boolean().optional(),
  isPageBreak: z.boolean().optional(),
  expectedVersion: z.number().optional(),
});

// GET /api/invoices - Paginated, filtered invoice list
router.get('/', async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const limit = parseInt(String(req.query.limit || '50'), 10) || 50;
    const type = req.query.type === 'entry' || req.query.type === 'exit' ? req.query.type : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const farmerId = typeof req.query.farmerId === 'string' ? req.query.farmerId : undefined;
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const result = await findInvoicesWithPagination({ page, limit, type, search, startDate, endDate, farmerId, productId });
    res.json(result);
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// POST /api/invoices/bulk-move - Move multiple invoices inside one transaction
router.post('/bulk-move', requireRole('ADMIN', 'MANAGER', 'ACCOUNTING', 'OPERATOR'), async (req, res) => {
  try {
    const { ids, targetDate } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !targetDate) {
      return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'ids array and targetDate are required.'));
    }
    const movedCount = await bulkMoveInvoicesWithTransaction(ids, String(targetDate));
    res.json(createSuccessResponse({ movedCount }, (req.headers['x-operation-id'] as string) || 'bulk', 1));
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// POST /api/invoices - Create invoice (idempotent, transactional)
router.post('/', requireRole('ADMIN', 'MANAGER', 'ACCOUNTING', 'OPERATOR'), async (req, res) => {
  try {
    const operationId = req.headers['x-operation-id'] as string;
    if (!operationId) return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'X-Operation-Id header is required.'));

    const parsed = InvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'اطلاعات ارسالی نامعتبر است.', { errors: parsed.error.issues }));
    }
    const parsedData = parsed.data;

    const outcome = await executeIdempotentOperation({
      operationId,
      userId: (req as any).user?.id || null,
      resourceType: 'invoices',
      operationType: 'create',
      payload: parsedData,
      execute: async (tx) => {
        const id = await createInvoiceInTransaction(tx, parsedData as any);
        return { id, version: 1 };
      }
    });

    const version = (outcome.result && outcome.result.version) || 1;
    res.status(201).json(createSuccessResponse(outcome.result, operationId, version));
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// PUT /api/invoices/:id - Update invoice (OCC + idempotent, transactional)
router.put('/:id', requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const operationId = req.headers['x-operation-id'] as string;
    if (!operationId) return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'X-Operation-Id header is required.'));
    const id = String(req.params.id);

    const parsed = InvoiceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'اطلاعات ارسالی نامعتبر است.', { errors: parsed.error.issues }));
    }
    const parsedData = parsed.data;

    const outcome = await executeIdempotentOperation({
      operationId,
      userId: (req as any).user?.id || null,
      resourceType: 'invoices',
      operationType: 'update',
      resourceId: id,
      payload: parsedData,
      execute: async (tx) => {
        await updateInvoiceInTransaction(tx, id, parsedData as any);
        const updated = await tx.select({ version: invoices.version }).from(invoices).where(eq(invoices.id, id)).limit(1);
        return { id, version: updated[0]?.version || 1 };
      }
    });

    res.json(createSuccessResponse({ id }, operationId, outcome.result.version));
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

// DELETE /api/invoices/:id - Soft-delete invoice + reversing ledger entry
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const operationId = req.headers['x-operation-id'] as string;
    if (!operationId) return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'X-Operation-Id header is required.'));

    const id = String(req.params.id);
    const outcome = await executeIdempotentOperation({
      operationId,
      userId: (req as any).user?.id || null,
      resourceType: 'invoices',
      operationType: 'delete',
      resourceId: id,
      payload: {},
      execute: async (tx) => {
        await deleteInvoiceInTransaction(tx, id);
        return { id };
      }
    });
    res.json(createSuccessResponse(outcome.result, operationId, 0));
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

export default router;
