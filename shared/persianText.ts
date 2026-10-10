/**
 * Persian/Arabic text normalisation shared by the CLIENT and the SERVER.
 *
 * WHY THIS EXISTS (duplicate-farmer outage):
 * the same human was stored as several different rows because the name differed only by
 * invisible/typographic variants:
 *   - Arabic letters instead of Persian ones:  ي (U+064A) vs ی (U+06CC), ك (U+0643) vs ک (U+06A9)
 *   - trailing/duplicated spaces or NBSP:      "مرغدار الف " vs "مرغدار  الف"
 *   - zero-width joiners/marks:                "مرغدار\u200Cالف" vs "مرغدار الف"
 *   - Arabic-Indic digits:                     ٠١٢ vs 012
 * Duplicate farmer rows break Period Management (مدیریت دوره‌ها), because the invoices of the
 * "same" farmer end up split across two identities.
 *
 * Two levels of normalisation, deliberately separated:
 *   - `normalizePersianText` -> DISPLAY/storage safe: trims, collapses spaces, converts Arabic
 *     letters to Persian. It keeps the ZWNJ (\u200C) because it is legitimate Persian orthography.
 *   - `farmerNameKey`        -> MATCHING only: additionally strips zero-width characters and
 *     lowercases, so two spellings of one farmer always produce the same key.
 */

/** Arabic letter -> Persian letter (the classic ی/ي and ک/ك duplicates). */
const LETTER_MAP: Record<string, string> = {
  '\u064A': '\u06CC', // ي -> ی
  '\u0649': '\u06CC', // ى -> ی
  '\u0626': '\u06CC', // ئ -> ی
  '\u0643': '\u06A9', // ك -> ک
  '\u0629': '\u0647', // ة -> ه
  '\u0622': '\u0627', // آ -> ا
  '\u0623': '\u0627', // أ -> ا
  '\u0625': '\u0627', // إ -> ا
  '\u0671': '\u0627', // ٱ -> ا
  '\u0624': '\u0648', // ؤ -> و
};

const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_INDIC = /[\u06F0-\u06F9]/g;
/** Zero-width + bidi control characters (ZWSP, ZWNJ, ZWJ, LRM/RLM, word joiner, BOM). */
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const ANY_SPACE = /[\s\u00A0\u2000-\u200A]+/g;

/** Persian/Arabic-Indic digits -> ASCII digits (so "۳۰۰" and "300" are the same number). */
export const toAsciiDigits = (input: unknown): string =>
  String(input ?? '')
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660));

/** Display/storage-safe normalisation: trim + collapse spaces + Arabic letters to Persian. */
export const normalizePersianText = (input: unknown): string => {
  let text = String(input ?? '');
  text = text.replace(ZERO_WIDTH, (ch) => (ch === '\u200C' ? ch : '')); // keep ZWNJ, drop the rest
  text = text.replace(/[\s\S]/gu, (ch) => LETTER_MAP[ch] ?? ch);
  text = text.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
  return text.replace(ANY_SPACE, ' ');
};

/**
 * Aggressive matching key: case-insensitive, whitespace-insensitive, zero-width-insensitive and
 * digit-insensitive (Persian/Arabic-Indic digits are compared as ASCII).
 *
 * Spacing is removed entirely on purpose: the same farmer is routinely typed as «علی رضایی»,
 * «علیرضایی» and «علی‌رضایی» (ZWNJ), and all three must produce one identity key. The DISPLAY
 * name is unaffected - only this key is used for duplicate detection and merging.
 */
export const textMatchKey = (input: unknown): string =>
  toAsciiDigits(normalizePersianText(input))
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, '')
    .toLowerCase();

/** The canonical identity key of a farmer name. */
export const farmerNameKey = (name: unknown): string => textMatchKey(name);

/** True when two names refer to the same human being (same key). */
export const isSameFarmerName = (a: unknown, b: unknown): boolean => {
  const ka = farmerNameKey(a);
  const kb = farmerNameKey(b);
  return ka !== '' && ka === kb;
};

/** Phones are stored/searchable as plain digits (Persian digits included). */
export const normalizePhone = (input: unknown): string =>
  toAsciiDigits(input).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');


/** Levenshtein distance with an early exit - names are short, so this stays cheap. */
export const levenshtein = (a: string, b: string, maxDistance = 4): number => {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1; // cannot get under the threshold any more
    prev = current;
  }
  return prev[b.length];
};

export interface NameSuggestion<T> {
  candidate: T;
  name: string;
  distance: number;
  /** 'exact' = same normalised key (definitely the same farmer), 'close' = typo-level match. */
  kind: 'exact' | 'close';
}

/**
 * "Did you mean X?" - the closest existing name to `name`, when one is suspiciously close.
 * An exact key match always wins; otherwise the smallest edit distance wins.
 */
export const findClosestName = <T>(
  name: unknown,
  candidates: T[],
  getName: (candidate: T) => string,
  maxDistance = 2,
): NameSuggestion<T> | null => {
  const key = farmerNameKey(name);
  if (!key) return null;

  let best: NameSuggestion<T> | null = null;
  for (const candidate of candidates) {
    const candidateName = getName(candidate);
    const candidateKey = farmerNameKey(candidateName);
    if (!candidateKey) continue;

    if (candidateKey === key) {
      return { candidate, name: candidateName, distance: 0, kind: 'exact' };
    }

    const distance = levenshtein(key, candidateKey, maxDistance);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { candidate, name: candidateName, distance, kind: 'close' };
    }
  }
  return best;
};

/** Group farmer-like records by their normalised key so duplicates become visible. */
export const groupByFarmerKey = <T>(items: T[], getName: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = farmerNameKey(getName(item));
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return groups;
};
