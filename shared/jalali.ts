/**
 * Gregorian <-> Jalali (Shamsi) helpers, shared by client and server.
 *
 * The app stores invoice dates as Jalali text (`YYYY/MM/DD`, e.g. `1404/06/25`) while the
 * weighbridge tables carry real timestamps, so matching a ticket to a day's invoices needs a
 * dependable server-side conversion.
 *
 * Algorithm: the classic Khayyam/Jalaali day-count method (accurate for 1178–1633 Jalali).
 */

const div = (a: number, b: number) => Math.floor(a / b);

export interface JalaliDate { jy: number; jm: number; jd: number; }

export const toJalali = (gy: number, gm: number, gd: number): JalaliDate => {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const y = gy <= 1600 ? gy - 621 : gy - 1600;
  const gy2 = gm > 2 ? y + 1 : y;
  let days =
    365 * y +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) -
    80 +
    gd +
    gDaysInMonth[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * Jalali (`1405/06/15`) -> Gregorian.
 *
 * Rather than a second day-count formula (which drifted a year against `toJalali`), this anchors on
 * Farvardin 1 (always 20–22 March of `jy + 621`, located with the already-validated `toJalali`) and
 * then offsets by the Jalali day-of-year — so the two directions can never disagree.
 */
export const toGregorian = (jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } => {
  const gy = jy + 621;
  let far1 = 21;
  for (const day of [21, 20, 22]) {
    const j = toJalali(gy, 3, day);
    if (j.jy === jy && j.jm === 1 && j.jd === 1) {
      far1 = day;
      break;
    }
  }
  // Jalali months: 1–6 are 31 days long, 7–11 are 30 (Farvardin 1 + month offset + day-of-month).
  const monthsBefore = jm <= 7 ? (jm - 1) * 31 : 186 + (jm - 7) * 30;
  const offset = monthsBefore + (jd - 1);
  const d = new Date(Date.UTC(gy, 2, far1) + offset * 86400000);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
};

/**
 * Absolute day number for a date that may be Jalali (`1405/06/15`) or ISO (`2026-10-07`), so the
 * distance between two dates can be measured exactly (used by the weighbridge ±N-day review).
 */
export const dateDayNumber = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= 1700) return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  const g = toGregorian(y, mo, d);
  return Math.floor(Date.UTC(g.gy, g.gm - 1, g.gd) / 86400000);
};

/** Whole days between two dates (Jalali or ISO); null when either cannot be parsed. */
export const dayDistance = (a: unknown, b: unknown): number | null => {
  const x = dateDayNumber(a);
  const y = dateDayNumber(b);
  return x === null || y === null ? null : Math.abs(x - y);
};

/** `1404/06/25` — the exact format the invoice rows use. */
export const jalaliText = (date: Date | string | number | null | undefined): string => {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const { jy, jm, jd } = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
};

export const addDays = (date: Date, days: number): Date => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
};

/** Inclusive Jalali window `±days` around a moment, for `date BETWEEN from AND to` matching. */
export const jalaliWindow = (around: Date | string | null | undefined, days: number): { from: string; to: string } => {
  const base = around ? new Date(around as any) : new Date();
  const d = isNaN(base.getTime()) ? new Date() : base;
  const span = Math.max(0, Math.min(60, Math.floor(days)));
  return { from: jalaliText(addDays(d, -span)), to: jalaliText(addDays(d, span)) };
};

/** Digits-only key, so «۲۲ ب ۳۴۵ ایران ۱۱» and «22ب345ایران11» compare equal. */
export const plateKey = (value: unknown): string => {
  const s = String(value ?? '')
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
  return s.replace(/[\s\-_.،,]/g, '').toUpperCase();
};
