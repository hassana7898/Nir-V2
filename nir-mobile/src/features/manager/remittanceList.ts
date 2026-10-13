/**
 * Pure helpers for the manager «حواله‌ها» (remittance) screen.
 *
 * Why this file exists: the Phase 1 screen called the shared invoice list endpoint (Endpoints.web.invoices)
 * with NO parameters, filtered the
 * answer in memory and silently dropped everything past the server's first page — so the manager was
 * really looking at "the newest 50 rows of one type" while the dev server holds 2,393 exit and 713
 * entry rows. The query builder, the page normaliser and the row decorations live here (no React, no
 * axios) so `tests/phase2ManagerScreens.test.ts` can pin them.
 *
 * Contract source: `server/routes/invoices.ts` (GET '/') -> `findInvoicesWithPagination`
 * (`server/repositories/invoiceRepository.ts`): params page | limit (<=200) | type | search |
 * startDate | endDate, response `{ data, total, page, limit, totalPages }`.
 */

import { addDays, jalaliText } from '../../utils/jalali';

export type RemittanceTab = 'exit' | 'entry';

export interface InvoiceQueryInput {
  tab: RemittanceTab;
  search?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  pageSize?: number;
}

export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/** Jalali `1405/07/21` — the format the server compares against the TEXT column `invoices.date`. */
export const JALALI_DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

export const isValidJalaliDate = (value: unknown): boolean =>
  JALALI_DATE_PATTERN.test(String(value ?? '').trim());

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const clampPage = (page: unknown): number => clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER);

export const clampPageSize = (size: unknown): number =>
  clampInt(size, DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE);

/**
 * Query string for `GET /api/invoices`.
 *
 * `startDate` / `endDate` must be Jalali: an unparsable value is dropped instead of being sent, so a
 * Gregorian ISO range cannot silently match zero rows and make the screen look "empty" for no reason.
 */
export const buildInvoiceQuery = (input: InvoiceQueryInput): Record<string, string | number> => {
  const params: Record<string, string | number> = {
    type: input.tab,
    page: clampPage(input.page),
    limit: clampPageSize(input.pageSize),
  };

  const search = String(input.search ?? '').trim();
  if (search) params.search = search;

  if (isValidJalaliDate(input.startDate)) params.startDate = String(input.startDate).trim();
  if (isValidJalaliDate(input.endDate)) params.endDate = String(input.endDate).trim();

  return params;
};

export interface InvoiceRow {
  id: string;
  type?: string | null;
  date?: string | null;
  invoiceNumber?: string | null;
  billNumber?: string | null;
  productName?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  sellerName?: string | null;
  origin?: string | null;
  factory?: string | null;
  farmerId?: string | null;
  billWeight?: number | string | null;
  scaleWeight?: number | string | null;
  weight?: number | string | null;
  /** Additive field the web list API attaches when the row's own `productName` is empty. */
  masterProductName?: string | null;
  [key: string]: unknown;
}

export interface InvoicesPage {
  rows: InvoiceRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Never throws on a shapeless payload: a bad answer renders as an empty page, not a crash. */
export const normalizeInvoicesPage = (
  raw: unknown,
  fallbackPageSize: number = DEFAULT_PAGE_SIZE
): InvoicesPage => {
  const body = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(body.data) ? (body.data as InvoiceRow[]) : [];
  const limit = clampPageSize(body.limit ?? fallbackPageSize);
  const total = Math.max(0, Number(body.total) || rows.length);
  const reportedPages = Math.max(0, Number(body.totalPages) || 0);
  const totalPages = Math.max(1, reportedPages || Math.ceil(total / Math.max(1, limit)));
  const page = Math.min(clampPage(body.page ?? 1), totalPages);

  return {
    rows,
    total,
    page,
    limit,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
};

export type WeighState = 'weighed' | 'pending';

/**
 * Whether the office has weighed this waybill. `invoices.status` is only 'active' vs soft-deleted, so
 * the old `matched` / `pending` / `mismatch` chip on the screen read a column that cannot hold those
 * values. The real signal on the row itself is the recorded scale weight.
 */
export const weighStateOf = (row: InvoiceRow): WeighState =>
  Number(row.scaleWeight ?? 0) > 0 ? 'weighed' : 'pending';

export const WEIGH_STATE_LABELS: Record<WeighState, string> = {
  weighed: 'توزین شده',
  pending: 'در انتظار توزین',
};

/** What the office should see as «وزن» — the scale reading when it exists, else the bill figure. */
export const displayWeightKg = (row: InvoiceRow): number => {
  const scale = Number(row.scaleWeight ?? 0);
  if (scale > 0) return scale;
  const bill = Number(row.billWeight ?? 0);
  if (bill > 0) return bill;
  return Number(row.weight ?? 0) || 0;
};

/** Buyer for an exit waybill, seller/source for an entry one; never an invented name. */
export const partyName = (row: InvoiceRow): string =>
  String(row.sellerName || row.origin || row.factory || '').trim() || 'نامشخص';

export const remittanceLabel = (row: InvoiceRow): string =>
  String(row.invoiceNumber || row.billNumber || row.id || '—');

/**
 * The product the office should read. `invoices.product_name` is empty on nearly every real row, so the
 * list API adds `masterProductName` resolved from the product master; `نامشخص` only appears when both
 * are genuinely missing.
 */
export const productLabel = (row: InvoiceRow): string =>
  String(row.productName || row.masterProductName || '').trim() || 'نامشخص';

export const counterpartyLabel = (row: InvoiceRow): string =>
  row.type === 'exit' ? 'خریدار / مرغدار' : 'فروشنده / مبدأ';

export type RangePreset = 'today' | 'last7' | 'last30';

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'امروز',
  last7: '۷ روز اخیر',
  last30: '۳۰ روز اخیر',
};

/** Inclusive Jalali window for the quick presets (the pickers use the same `YYYY/MM/DD` format). */
export const quickRange = (
  preset: RangePreset,
  now: Date = new Date()
): { startDate: string; endDate: string } => {
  const daysBack = preset === 'today' ? 0 : preset === 'last7' ? 6 : 29;
  return { startDate: jalaliText(addDays(now, -daysBack)), endDate: jalaliText(now) };
};

export const rangeLabel = (startDate?: string | null, endDate?: string | null): string => {
  const from = isValidJalaliDate(startDate) ? String(startDate).trim() : '';
  const to = isValidJalaliDate(endDate) ? String(endDate).trim() : '';
  if (!from && !to) return 'همه تاریخ‌ها';
  if (from && to) return `از ${from} تا ${to}`;
  return from ? `از ${from}` : `تا ${to}`;
};

/** «۱۲۰ از ۲۳۹۳ حواله» — the line that makes it obvious the list is paged, not truncated. */
export const pageSummary = (page: InvoicesPage): string =>
  `${page.rows.length} از ${page.total} حواله`;

