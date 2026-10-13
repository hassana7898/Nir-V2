/**
 * Pure helpers for the manager «راننده‌های نامطابق» report (Phase 2, G-7).
 *
 * Contract source: `server/routes/mobileManager.ts`, GET /api/mobile/manager/unmatched-drivers.
 * Params: type (all | exit | entry) | search | page | limit (1..200, default 50).
 * Response: `{ groups, totalGroups, totalInvoices, scannedInvoices, scanCap, truncated, driversIndexed,
 * type, page, limit, totalPages }`, and each group carries `{ driverName, nameKey, count, exitCount,
 * entryCount, oldestDate, newestDate, phones, sampleInvoices, invoiceIds, suggestedDriverId,
 * suggestedDriverName, suggestionReason }`.
 *
 * The report is READ-ONLY on the server: it names the best candidate driver for a name that has no
 * `driver_id` link, but it never writes the link. The screen must say so instead of offering an action
 * that would silently do nothing.
 */

export type UnmatchedType = 'all' | 'exit' | 'entry';

export type SuggestionReason = 'phone' | 'name-exact' | 'name-close' | 'ambiguous' | 'none';

export interface UnmatchedGroup {
  driverName: string;
  nameKey?: string;
  count: number;
  exitCount: number;
  entryCount: number;
  oldestDate?: string | null;
  newestDate?: string | null;
  phones: string[];
  sampleInvoices: string[];
  invoiceIds: string[];
  suggestedDriverId: string | null;
  suggestedDriverName: string | null;
  suggestionReason: SuggestionReason;
}

export interface UnmatchedPage {
  groups: UnmatchedGroup[];
  totalGroups: number;
  totalInvoices: number;
  scannedInvoices: number;
  scanCap: number;
  truncated: boolean;
  driversIndexed: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const DEFAULT_UNMATCHED_LIMIT = 20;
export const MAX_UNMATCHED_LIMIT = 200;

export const UNMATCHED_TYPE_LABELS: Record<UnmatchedType, string> = {
  all: 'همه',
  exit: 'خروجی',
  entry: 'ورودی',
};

export const UNMATCHED_TYPE_HINTS: Record<UnmatchedType, string> = {
  all: 'حواله‌های خروجی و ورودی',
  exit: 'فقط حواله‌های خروجی (بارگیری برای مرغدار)',
  entry: 'فقط حواله‌های ورودی (خرید نهاده)',
};

export const clampUnmatchedLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UNMATCHED_LIMIT;
  return Math.min(MAX_UNMATCHED_LIMIT, Math.floor(parsed));
};

export const buildUnmatchedQuery = (input: {
  type?: UnmatchedType;
  search?: string | null;
  page?: number;
  limit?: number;
}): Record<string, string | number> => {
  const page = Number.parseInt(String(input.page ?? 1), 10);
  const params: Record<string, string | number> = {
    limit: clampUnmatchedLimit(input.limit),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
  if (input.type && input.type !== 'all') params.type = input.type;
  const search = String(input.search ?? '').trim();
  if (search) params.search = search;
  return params;
};

export const SUGGESTION_LABELS: Record<SuggestionReason, string> = {
  phone: 'شماره تماس روی حواله با این راننده یکی است',
  'name-exact': 'نام حواله دقیقاً با نام این راننده یکی است',
  'name-close': 'نام مشابه است (پیشنهاد احتمالی، نیازمند بررسی)',
  ambiguous: 'چند راننده با همین نام یا شماره ثبت شده‌اند',
  none: 'راننده‌ای برای این نام پیدا نشد',
};

export const SUGGESTION_TONES: Record<SuggestionReason, 'success' | 'warning' | 'error' | 'info'> = {
  phone: 'success',
  'name-exact': 'success',
  'name-close': 'warning',
  ambiguous: 'error',
  none: 'info',
};

/** Only these two reasons are evidence, not a guess — the other three need a human decision. */
export const isStrongSuggestion = (reason: SuggestionReason): boolean =>
  reason === 'phone' || reason === 'name-exact';

const isReason = (value: unknown): value is SuggestionReason =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUGGESTION_LABELS, value);

export const suggestionLabel = (reason: unknown): string =>
  isReason(reason) ? SUGGESTION_LABELS[reason] : SUGGESTION_LABELS.none;

export const suggestionTone = (reason: unknown): 'success' | 'warning' | 'error' | 'info' =>
  isReason(reason) ? SUGGESTION_TONES[reason] : 'info';

export const normalizeUnmatchedPage = (raw: unknown): UnmatchedPage => {
  const body = (raw ?? {}) as Record<string, unknown>;
  const rawGroups = Array.isArray(body.groups) ? (body.groups as any[]) : [];
  const limit = clampUnmatchedLimit(body.limit);
  const groups: UnmatchedGroup[] = rawGroups.map((g) => ({
    driverName: String(g?.driverName ?? '').trim() || 'بدون نام',
    nameKey: g?.nameKey ? String(g.nameKey) : undefined,
    count: Number(g?.count ?? 0) || 0,
    exitCount: Number(g?.exitCount ?? 0) || 0,
    entryCount: Number(g?.entryCount ?? 0) || 0,
    oldestDate: g?.oldestDate ?? null,
    newestDate: g?.newestDate ?? null,
    phones: Array.isArray(g?.phones) ? g.phones.map((p: unknown) => String(p)) : [],
    sampleInvoices: Array.isArray(g?.sampleInvoices)
      ? g.sampleInvoices.map((s: unknown) => String(s))
      : [],
    invoiceIds: Array.isArray(g?.invoiceIds) ? g.invoiceIds.map((s: unknown) => String(s)) : [],
    suggestedDriverId: g?.suggestedDriverId ? String(g.suggestedDriverId) : null,
    suggestedDriverName: g?.suggestedDriverName ? String(g.suggestedDriverName) : null,
    suggestionReason: isReason(g?.suggestionReason) ? g.suggestionReason : 'none',
  }));

  const reportedPages = Math.max(0, Number(body.totalPages) || 0);
  const page = Math.max(1, Number(body.page) || 1);
  const totalGroups = Math.max(0, Number(body.totalGroups) || groups.length);

  return {
    groups,
    totalGroups,
    totalInvoices: Math.max(0, Number(body.totalInvoices) || 0),
    scannedInvoices: Math.max(0, Number(body.scannedInvoices) || 0),
    scanCap: Math.max(0, Number(body.scanCap) || 0),
    truncated: body.truncated === true,
    driversIndexed: Math.max(0, Number(body.driversIndexed) || 0),
    page,
    limit,
    totalPages: Math.max(1, reportedPages || Math.ceil(totalGroups / Math.max(1, limit))),
  };
};

export const groupDateRange = (group: UnmatchedGroup): string => {
  const from = String(group.oldestDate ?? '').trim();
  const to = String(group.newestDate ?? '').trim();
  if (from && to && from !== to) return `${from} تا ${to}`;
  return to || from || 'بدون تاریخ';
};

export const groupBreakdown = (group: UnmatchedGroup): string =>
  `${group.count} حواله (خروجی ${group.exitCount} / ورودی ${group.entryCount})`;

/**
 * Warns when the server hit its scan cap: the totals then describe the scanned window, not the whole
 * history, and the screen must say so rather than present them as complete.
 */
export const scanCoverageNote = (page: UnmatchedPage): string | null => {
  if (!page.truncated) return null;
  const cap = page.scanCap || page.scannedInvoices;
  return `برای کنترل حجم پاسخ، فقط ${cap} حواله‌ی آخر بررسی شده است؛ اعداد این صفحه کامل نیست.`;
};

