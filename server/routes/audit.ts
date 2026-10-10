import express from 'express';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { audit_logs } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { createSuccessResponse, toApiError } from '../../shared/apiContract';

const router = express.Router();

const MAX_LIMIT = 200;

/**
 * GET /api/audit - Server-authoritative audit trail (ردپای کاربران).
 * Restricted to ADMIN + MANAGER (requireRole). Writes are produced by the services inside the
 * same transaction as the change, so this endpoint only reads.
 *
 * Filters: action, entity, user (username, partial), from/to (ISO date), search (details or
 * target ids), page, limit.
 */
router.get('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (typeof req.query.action === 'string' && req.query.action.trim()) {
      conditions.push(eq(audit_logs.action, req.query.action.trim().toUpperCase()));
    }
    if (typeof req.query.entity === 'string' && req.query.entity.trim()) {
      conditions.push(eq(audit_logs.entity, req.query.entity.trim()));
    }
    if (typeof req.query.user === 'string' && req.query.user.trim()) {
      conditions.push(ilike(audit_logs.username, `%${req.query.user.trim()}%`));
    }
    if (typeof req.query.from === 'string' && req.query.from.trim()) {
      const from = new Date(req.query.from.trim());
      if (!Number.isNaN(from.getTime())) conditions.push(gte(audit_logs.createdAt, from));
    }
    if (typeof req.query.to === 'string' && req.query.to.trim()) {
      const to = new Date(req.query.to.trim());
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        conditions.push(lte(audit_logs.createdAt, to));
      }
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const q = `%${req.query.search.trim()}%`;
      conditions.push(or(ilike(audit_logs.details, q), sql`${audit_logs.targetIds}::text ILIKE ${q}`)!);
    }

    const whereClause: any = conditions.length > 1 ? and(...conditions) : conditions[0];

    const [totalRows, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(audit_logs).where(whereClause),
      db.select().from(audit_logs).where(whereClause).orderBy(desc(audit_logs.createdAt)).limit(limit).offset(offset),
    ]);

    const total = Number(totalRows[0]?.count || 0);
    res.json(createSuccessResponse({
      logs: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    }, (req.headers['x-operation-id'] as string) || 'audit-list', 1));
  } catch (error: any) {
    const { status, body } = toApiError(error);
    res.status(status).json(body);
  }
});

export default router;