import express from 'express';
import { and, asc, desc, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { invoices } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { createSuccessResponse, createErrorResponse } from '../../shared/apiContract';

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GET /api/reports/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * All aggregation happens INSIDE PostgreSQL (`SUM` + `GROUP BY`), so the browser receives only the
 * totals instead of thousands of invoice rows:
 *   - `byProduct`: per product × type (entry/exit) - quantities, weights, wastage, transport cost
 *   - `byVariant`: per type × `productVariant` (the free-text «توضیحات / نوع»), with an explicit
 *      bucket for rows that carry no variant
 *   - `byDay`:     per day × type (a compact series for the dashboard)
 *   - `totals`:    grand totals, derived from `byProduct` (identical numbers, no extra round-trip)
 *
 * Weight semantics match the invoice screens: an ENTRY counts its scale (باسکول) weight, an EXIT
 * counts its delivered weight.
 *
 * Access: ADMIN / MANAGER / ACCOUNTING only (`requireAuth` + `requireRole`), and the router is
 * mounted behind `blockViewerWrites`, so a VIEWER can never read the financial aggregates.
 */
router.get('/summary', requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const endDate = typeof req.query.endDate === 'string' && DATE_RE.test(req.query.endDate)
      ? req.query.endDate
      : isoDay(new Date());
    const startDate = typeof req.query.startDate === 'string' && DATE_RE.test(req.query.startDate)
      ? req.query.startDate
      : isoDay(new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 29 * 86400000));

    if (startDate > endDate) {
      return res.status(422).json(createErrorResponse('VALIDATION_FAILED', 'بازه تاریخ نامعتبر است: تاریخ شروع بعد از پایان است.'));
    }

    const inRange = and(
      isNull(invoices.deletedAt),
      gte(invoices.date, startDate),
      lte(invoices.date, endDate),
    );

    const weightSum = sql<string>`coalesce(sum(case when ${invoices.type} = 'exit' then ${invoices.weight} else ${invoices.scaleWeight} end), 0)`;
    const variantKey = sql<string>`coalesce(nullif(btrim(${invoices.productVariant}), ''), '')`;

    const [byProductRows, byVariantRows, byDayRows, byDriverRows] = await Promise.all([
      db
        .select({
          productId: invoices.productId,
          productName: sql<string>`coalesce(max(nullif(btrim(${invoices.productName}), '')), ${invoices.productId})`,
          type: invoices.type,
          rows: sql<number>`count(*)::int`,
          totalWeight: weightSum,
          billWeight: sql<string>`coalesce(sum(${invoices.billWeight}), 0)`,
          wastage: sql<string>`coalesce(sum(${invoices.wastage}), 0)`,
          transportCost: sql<string>`coalesce(sum(${invoices.transportCost}), 0)`,
        })
        .from(invoices)
        .where(inRange)
        .groupBy(invoices.productId, invoices.type)
        .orderBy(asc(invoices.productId), asc(invoices.type)),

      db
        .select({
          type: invoices.type,
          variant: variantKey,
          rows: sql<number>`count(*)::int`,
          totalWeight: weightSum,
        })
        .from(invoices)
        .where(inRange)
        .groupBy(invoices.type, variantKey)
        .orderBy(asc(invoices.type), asc(variantKey)),

      db
        .select({
          date: invoices.date,
          type: invoices.type,
          rows: sql<number>`count(*)::int`,
          totalWeight: weightSum,
        })
        .from(invoices)
        .where(inRange)
        .groupBy(invoices.date, invoices.type)
        .orderBy(asc(invoices.date), asc(invoices.type)),

      // Drivers / logistics - ADVANCED: every invoice (entry + exit), split with CASE WHEN.
      // Weight semantics verified against the data: an ENTRY carries scale_weight (100% of entries,
      // and never `weight`), an EXIT carries `weight`. `transport_cost` is only populated on entries
      // (240 rows / 92.7 bn Rial), which is why entry_cost is the freight that matters.
      db
        .select({
          driver: sql<string>`coalesce(btrim(${invoices.driverName}), '')`,
          entryServices: sql<number>`sum(case when ${invoices.type} = 'entry' then 1 else 0 end)::int`,
          exitServices: sql<number>`sum(case when ${invoices.type} = 'exit' then 1 else 0 end)::int`,
          totalServices: sql<number>`count(*)::int`,
          entryWeight: sql<string>`coalesce(sum(case when ${invoices.type} = 'entry' then ${invoices.scaleWeight} else 0 end), 0)`,
          exitWeight: sql<string>`coalesce(sum(case when ${invoices.type} = 'exit' then ${invoices.weight} else 0 end), 0)`,
          totalWeight: sql<string>`coalesce(sum(case when ${invoices.type} = 'entry' then ${invoices.scaleWeight} when ${invoices.type} = 'exit' then ${invoices.weight} else 0 end), 0)`,
          entryCost: sql<string>`coalesce(sum(case when ${invoices.type} = 'entry' then ${invoices.transportCost} else 0 end), 0)`,
          exitCost: sql<string>`coalesce(sum(case when ${invoices.type} = 'exit' then ${invoices.transportCost} else 0 end), 0)`,
          totalCost: sql<string>`coalesce(sum(${invoices.transportCost}), 0)`,
          lastDate: sql<string>`coalesce(max(${invoices.date}), '')`,
        })
        .from(invoices)
        .where(inRange)
        .groupBy(sql`coalesce(btrim(${invoices.driverName}), '')`)
        .orderBy(desc(sql`count(*)`), asc(sql`coalesce(btrim(${invoices.driverName}), '')`)),
    ]);

    const byProduct = byProductRows.map((r: any) => ({
      productId: r.productId,
      productName: r.productName || r.productId,
      type: r.type,
      rows: Number(r.rows) || 0,
      totalWeight: Number(r.totalWeight) || 0,
      billWeight: Number(r.billWeight) || 0,
      wastage: Number(r.wastage) || 0,
      transportCost: Number(r.transportCost) || 0,
    }));

    const byVariant = byVariantRows.map((r: any) => ({
      type: r.type,
      variant: r.variant || '—',
      rows: Number(r.rows) || 0,
      totalWeight: Number(r.totalWeight) || 0,
    }));

    const byDay = byDayRows.map((r: any) => ({
      date: r.date,
      type: r.type,
      rows: Number(r.rows) || 0,
      totalWeight: Number(r.totalWeight) || 0,
    }));

    const byDriver = byDriverRows.map((r: any) => ({
      driver: r.driver || '',
      entryServices: Number(r.entryServices) || 0,
      exitServices: Number(r.exitServices) || 0,
      totalServices: Number(r.totalServices) || 0,
      entryWeight: Number(r.entryWeight) || 0,
      exitWeight: Number(r.exitWeight) || 0,
      totalWeight: Number(r.totalWeight) || 0,
      entryCost: Number(r.entryCost) || 0,
      exitCost: Number(r.exitCost) || 0,
      totalCost: Number(r.totalCost) || 0,
      lastDate: r.lastDate || '',
    }));

    const driverTotals = byDriver.reduce(
      (acc: any, r: any) => ({
        drivers: acc.drivers + 1,
        entryServices: acc.entryServices + r.entryServices,
        exitServices: acc.exitServices + r.exitServices,
        totalServices: acc.totalServices + r.totalServices,
        entryWeight: acc.entryWeight + r.entryWeight,
        exitWeight: acc.exitWeight + r.exitWeight,
        totalWeight: acc.totalWeight + r.totalWeight,
        entryCost: acc.entryCost + r.entryCost,
        exitCost: acc.exitCost + r.exitCost,
        totalCost: acc.totalCost + r.totalCost,
      }),
      { drivers: 0, entryServices: 0, exitServices: 0, totalServices: 0, entryWeight: 0, exitWeight: 0, totalWeight: 0, entryCost: 0, exitCost: 0, totalCost: 0 },
    );

    // Grand totals are folded from the per-product groups: same SUMs, no second pass over the table.
    const totals = byProduct.reduce(
      (acc: any, r: any) => {
        if (r.type === 'exit') {
          acc.exitWeight += r.totalWeight;
          acc.exitRows += r.rows;
        } else {
          acc.entryWeight += r.totalWeight;
          acc.entryRows += r.rows;
        }
        acc.billWeight += r.billWeight;
        acc.wastage += r.wastage;
        acc.transportCost += r.transportCost;
        return acc;
      },
      { entryWeight: 0, exitWeight: 0, entryRows: 0, exitRows: 0, billWeight: 0, wastage: 0, transportCost: 0 },
    );

    res.json(createSuccessResponse({
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      totals: {
        ...totals,
        netWeight: totals.entryWeight - totals.exitWeight,
        rows: totals.entryRows + totals.exitRows,
      },
      byProduct,
      byVariant,
      byDay,
      byDriver,
      driverTotals,
    }, (req.headers['x-operation-id'] as string) || 'report-summary', 1));
  } catch (error: any) {
    console.error('Report summary error:', error);
    res.status(500).json(createErrorResponse('SERVER_ERROR', 'خطا در تهیه گزارش.'));
  }
});

export default router;