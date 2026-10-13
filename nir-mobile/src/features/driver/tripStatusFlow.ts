/**
 * Trip-status flow (Phase 2, G-8) — the client-side mirror of the server rules.
 *
 * The server (`server/routes/mobile.ts`, PATCH /driver/loads/:invoiceId/trip-status) is the only
 * authority: it refuses backwards moves with 409, refuses `delivered` without a delivery receipt,
 * treats `cancelled` as terminal, and answers an unchanged re-send with 200 `unchanged: true`. The
 * screen must not offer a button that the server is guaranteed to reject, so the same rules are
 * encoded here and pinned by `tests/tripStatusFlow.test.ts` — if one side changes, the test fails.
 */

export const TRIP_STATUS_FLOW = [
  'assigned',
  'at_origin',
  'loading',
  'at_destination',
  'unloading',
  'delivered',
] as const;

export type TripStatusStep = (typeof TRIP_STATUS_FLOW)[number];
export type TripStatus = TripStatusStep | 'cancelled';

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  assigned: 'تخصیص داده شده',
  at_origin: 'رسیده به مبدأ',
  loading: 'در حال بارگیری',
  at_destination: 'رسیده به مقصد',
  unloading: 'در حال تخلیه',
  delivered: 'تحویل شد',
  cancelled: 'لغو شده',
};

/** Short text under the badge, so the driver knows what the office is waiting for. */
export const TRIP_STATUS_HINTS: Record<TripStatus, string> = {
  assigned: 'سفر تخصیص یافته و هنوز گزارشی ثبت نشده است.',
  at_origin: 'کامیون در محل بارگیری است.',
  loading: 'بارگیری شروع شده است.',
  at_destination: 'کامیون به مقصد رسیده است.',
  unloading: 'تخلیه بار در جریان است.',
  delivered: 'سفر با ثبت رسید تحویل بسته شده است.',
  cancelled: 'این سفر لغو شده و قابل بازگشت نیست.',
};

export const isTripStatus = (value: unknown): value is TripStatus => {
  const v = String(value ?? '');
  return v === 'cancelled' || (TRIP_STATUS_FLOW as readonly string[]).includes(v);
};

/** Same ranking the server uses: `cancelled` sits below every real step. */
export const tripStatusRank = (value: TripStatus): number =>
  value === 'cancelled' ? -1 : TRIP_STATUS_FLOW.indexOf(value);

/** `StatusBadge` knows these variants; anything unknown stays grey (see StatusBadge.tsx). */
export const tripStatusVariant = (value: TripStatus): string => {
  if (value === 'delivered') return 'delivered';
  if (value === 'cancelled') return 'error';
  if (value === 'assigned') return 'pending';
  return 'in_transit';
};

/** Index of a step inside the flow, for the timeline rendering (cancelled has no position). */
export const stepIndex = (value: TripStatus): number => TRIP_STATUS_FLOW.indexOf(value as TripStatusStep);

export const tripStatusLabel = (value: unknown): string =>
  isTripStatus(value) ? TRIP_STATUS_LABELS[value] : TRIP_STATUS_LABELS.assigned;

export interface ReportDecision {
  allowed: boolean;
  reason?: string;
  /** True when the report is a no-op the server answers with `unchanged: true`. */
  unchanged?: boolean;
}

/**
 * Mirrors the server's 409s exactly. `hasProof` is the delivery receipt (POD) flag the loads endpoint
 * already returns as `hasProofOfDelivery`.
 */
export const canReportTripStatus = (
  current: TripStatus,
  requested: TripStatus,
  hasProof = false
): ReportDecision => {
  if (requested === current) {
    return { allowed: true, unchanged: true };
  }
  if (current === 'delivered') {
    return { allowed: false, reason: 'این سفر بسته شده است (رسید تحویل ثبت شده) و تغییر وضعیت آن مجاز نیست.' };
  }
  if (current === 'cancelled' && requested !== 'cancelled') {
    return { allowed: false, reason: 'این سفر لغو شده است و بازگشت به وضعیت قبلی مجاز نیست.' };
  }
  if (requested === 'delivered' && !hasProof) {
    return { allowed: false, reason: 'برای بستن سفر ابتدا رسید تحویل بار را ثبت کنید.' };
  }
  if (requested !== 'cancelled' && tripStatusRank(requested) < tripStatusRank(current)) {
    return {
      allowed: false,
      reason: `بازگشت به وضعیت «${TRIP_STATUS_LABELS[requested]}» از «${TRIP_STATUS_LABELS[current]}» مجاز نیست (فقط حرکت رو به جلو).`,
    };
  }
  return { allowed: true };
};

/**
 * The buttons the screen should offer, in order: the next two forward steps (so a driver who forgot
 * to report can catch up without a phone call) plus «لغو سفر» where it is still legal.
 */
export const reportableTripStatuses = (current: TripStatus, hasProof = false): TripStatus[] => {
  if (current === 'delivered' || current === 'cancelled') return [];

  const currentRank = tripStatusRank(current);
  const options = TRIP_STATUS_FLOW.filter(
    (step) => tripStatusRank(step) > currentRank && (step !== 'delivered' || hasProof)
  ).slice(0, 2) as TripStatus[];

  return [...options, 'cancelled'];
};

/** Which forward buttons exist but are refused until the POD exists (rendered disabled + explained). */
export const lockedTripStatuses = (current: TripStatus, hasProof = false): TripStatus[] => {
  if (hasProof || current === 'delivered' || current === 'cancelled') return [];
  return ['delivered'];
};
