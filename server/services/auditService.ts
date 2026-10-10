import crypto from 'crypto';
import { audit_logs } from '../db/schema';

/**
 * Server-authoritative audit trail (ردپای کاربران).
 *
 * WHY a new table instead of the existing `logs`:
 *   `logs` rows are authored by the BROWSER (`dataService.logAction` → /api/sync). A client can
 *   omit, delay or alter them, and they carry no authenticated actor guarantee.
 *   Rows written here are created inside the SAME transaction as the change they describe, so the
 *   trail is atomic with the data and always names the real, server-verified user.
 */

/** Who performed the action - built from the authenticated request, never from the body. */
export interface AuditActor {
  userId?: string | null;
  username?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditChange { field: string; label: string; from: any; to: any; }

export interface AuditEntry {
  action: string;                          // CREATE | UPDATE | DELETE | REORDER | BULK_MOVE
  entity?: string;                         // defaults to 'invoice'
  targetIds?: string[];
  changes?: AuditChange[];                 // machine-readable, field-level diff
  context?: Record<string, any>;           // extra facts (targetDate, counts, order preview...)
  details?: string;                        // Persian one-line summary (auto-built when omitted)
}

export const actorFromRequest = (req: any): AuditActor => ({
  userId: req?.user?.id ?? null,
  username: req?.user?.username ?? null,
  role: req?.user?.role ?? null,
  ip: (req?.ip || req?.socket?.remoteAddress || null) as string | null,
  userAgent: req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 300) : null,
});

/** Persian labels for every invoice field the trail can report. */
export const FIELD_LABELS: Record<string, string> = {
  date: 'تاریخ',
  productId: 'محصول',
  productName: 'نام محصول',
  farmerId: 'مرغدار',
  sellerName: 'فروشنده',
  driverName: 'راننده',
  driverPhone: 'تلفن راننده',
  driverIBAN: 'شبا راننده',
  factory: 'کارخانه',
  billNumber: 'شماره بارنامه',
  origin: 'مبدا',
  invoiceNumber: 'شماره حواله',
  billWeight: 'وزن بارنامه',
  scaleWeight: 'وزن باسکول',
  weight: 'وزن',
  wastage: 'افت',
  transportCost: 'کرایه حمل',
  productVariant: 'توضیحات / نوع',
  notes: 'توضیحات',
  isCrumble: 'کرامبل',
  isPageBreak: 'شکست صفحه',
  sortOrder: 'ترتیب',
};

const TRACKED_FIELDS = Object.keys(FIELD_LABELS);

const norm = (v: any): any => (v === undefined || v === null || v === '' ? null : v);
const asText = (v: any): string => (v === null || v === undefined || v === '' ? '-' : String(v));

/** Field-by-field diff of a patch against the stored row (declared order, no no-op entries). */
export const buildInvoiceDiff = (prev: any, incoming: any): AuditChange[] => {
  const changes: AuditChange[] = [];
  for (const field of TRACKED_FIELDS) {
    if (!incoming || !(field in incoming)) continue;
    const from = norm(prev?.[field]);
    const to = norm(incoming[field]);
    if (String(from ?? '') === String(to ?? '')) continue;
    changes.push({ field, label: FIELD_LABELS[field], from, to });
  }
  return changes;
};

/** Compact Persian one-liner, e.g. «وزن باسکول: 1200 ← 1500 | تاریخ: 1404/06/25 ← 1404/06/26». */
export const describeChanges = (changes: AuditChange[], limit = 6): string => {
  if (!changes || changes.length === 0) return '';
  const head = changes.slice(0, limit).map(c => `${c.label}: ${asText(c.from)} ← ${asText(c.to)}`).join(' | ');
  return changes.length > limit ? `${head} | +${changes.length - limit} تغییر دیگر` : head;
};

/**
 * Append one audit row using the caller's transaction.
 * The trail is deliberately atomic with the business change: if the insert fails the caller's
 * transaction fails too (no silent gaps). The error is logged with full context first so the
 * cause is obvious (e.g. a missing migration).
 */
export const recordAudit = async (tx: any, actor: AuditActor | undefined, entry: AuditEntry): Promise<void> => {
  try {
    await tx.insert(audit_logs).values({
      id: crypto.randomUUID(),
      userId: actor?.userId ?? null,
      username: actor?.username ?? null,
      role: actor?.role ?? null,
      action: String(entry.action || 'UNKNOWN').toUpperCase(),
      entity: entry.entity || 'invoice',
      targetIds: entry.targetIds ?? [],
      summary: { changes: entry.changes ?? [], ...(entry.context ? { context: entry.context } : {}) },
      details: entry.details ?? describeChanges(entry.changes ?? []) ?? null,
      ipAddress: actor?.ip ?? null,
      userAgent: actor?.userAgent ?? null,
      createdAt: new Date(),
    });
  } catch (error: any) {
    console.error('[NIR AUDIT] failed to record', entry.action, entry.entity, '->', error?.message || error);
    throw error;
  }
};