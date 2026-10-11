/**
 * Persian/Arabic text normalization and plate helpers for NIR Mobile Client.
 * Direct port and extension of shared/persianText.ts.
 */

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
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const ANY_SPACE = /[\s\u00A0\u2000-\u200A]+/g;

/** Persian/Arabic-Indic digits -> ASCII digits */
export const toAsciiDigits = (input: unknown): string =>
  String(input ?? '')
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660));

/** Display/storage-safe normalization: trim + collapse spaces + Arabic letters to Persian */
export const normalizePersianText = (input: unknown): string => {
  let text = String(input ?? '');
  text = text.replace(ZERO_WIDTH, (ch) => (ch === '\u200C' ? ch : '')); // keep ZWNJ
  text = text.replace(/[\s\S]/gu, (ch) => LETTER_MAP[ch] ?? ch);
  text = text.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
  return text.replace(ANY_SPACE, ' ');
};

/** Aggressive matching key */
export const textMatchKey = (input: unknown): string =>
  toAsciiDigits(normalizePersianText(input))
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, '')
    .toLowerCase();

export const farmerNameKey = (name: unknown): string => textMatchKey(name);

export const isSameFarmerName = (a: unknown, b: unknown): boolean => {
  const ka = farmerNameKey(a);
  const kb = farmerNameKey(b);
  return ka !== '' && ka === kb;
};

/** Phones stored as plain digits */
export const normalizePhone = (input: unknown): string =>
  toAsciiDigits(input).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');

/** Validates Iranian 11-digit mobile (09...) */
export const isValidIranianMobile = (input: unknown): boolean => {
  const normalized = normalizePhone(input);
  return /^09\d{9}$/.test(normalized);
};

/** Levenshtein distance */
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
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = current;
  }
  return prev[b.length];
};

export interface NameSuggestion<T> {
  candidate: T;
  name: string;
  distance: number;
  kind: 'exact' | 'close';
}

export const findClosestName = <T>(
  name: unknown,
  candidates: T[],
  getName: (candidate: T) => string,
  maxDistance = 2
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

/**
 * Iranian vehicle plate validation & parsing:
 * Formats: "12 ب 345 ایران 67" or "12ب345-67"
 */
export interface ParsedPlate {
  part1: string; // 2 digits
  letter: string; // 1 Persian letter
  part2: string; // 3 digits
  series: string; // 2 digits (Iran XX)
  raw: string;
}

export const parsePlate = (plate: unknown): ParsedPlate | null => {
  const cleaned = toAsciiDigits(normalizePersianText(plate)).replace(/[\s\-_]/g, '');
  // Matches 2 digits + 1 Persian char + 3 digits + (optional ایران) + 2 digits
  const m = /^(\d{2})([\u0600-\u06FF])(\d{3})(?:ایران)?(\d{2})$/.exec(cleaned);
  if (!m) return null;
  return {
    part1: m[1],
    letter: m[2],
    part2: m[3],
    series: m[4],
    raw: String(plate ?? '').trim(),
  };
};

export const isValidPlate = (plate: unknown): boolean => {
  return parsePlate(plate) !== null;
};
