/**
 * Atomic, multi-key table sorting.
 *
 * ROW-INTEGRITY RULE (the reason this module exists):
 * a table row is ONE object. A sort must therefore re-order the whole array of row
 * objects (`[...rows].sort(...)`) and never a "column view". Any implementation that
 * sorts column value-arrays independently detaches every value from its owner and
 * renders e.g. one farmer's name beside another farmer's weight - "scrambled rows",
 * which is silent data corruption on screen.
 *
 * Everything here is pure: the input array (usually React state) is copied BEFORE
 * sorting, so a view sort can never reorder the stored/cached list.
 *
 * Multi-sort contract (matches the Shift+click UI):
 *   - specs are applied in order; the first key that differs decides the comparison;
 *   - equal keys fall through to the NEXT spec (true multi-level sorting);
 *   - the original position is the final tiebreaker, which also guarantees a stable
 *     result in every engine (equal keys never make the browser reshuffle rows).
 */
import { toAsciiDigits } from '../shared/persianText';



export type SortDirection = 'asc' | 'desc';

export interface SortSpec<K extends string = string> {
  key: K;
  direction: SortDirection;
}

/** Per-key value readers for derived columns (e.g. product id -> product order). */
export type SortAccessors<K extends string, T> = Partial<Record<K, (row: T) => unknown>>;

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (typeof value === 'number' && Number.isNaN(value));

/** Dates and booleans are normalised to sortable primitives before any comparison. */
const toSortablePrimitive = (value: unknown): unknown => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : '';
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object') {
    // Plain objects/arrays have no natural order: compare their stable JSON text instead of
    // "[object Object]" so two different objects never look equal.
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return value;
};

/**
 * Numeric-aware, Persian-aware comparison.
 *
 * Numbers and numeric strings compare numerically (so "9" < "10") - Persian/Arabic-Indic digits
 * are converted first, so a weight typed as "۳۰۰" still sorts next to "300" instead of falling
 * into the text branch. Everything else compares as Persian text.
 */
const compareValues = (a: unknown, b: unknown): number => {
  const left = toSortablePrimitive(a);
  const right = toSortablePrimitive(b);

  const asNumber = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return NaN;
      const numeric = Number(toAsciiDigits(trimmed).replace(/,/g, ''));
      return numeric;
    }
    return NaN;
  };

  const leftNum = asNumber(left);
  const rightNum = asNumber(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    if (leftNum < rightNum) return -1;
    if (leftNum > rightNum) return 1;
    return 0;
  }

  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  try {
    return leftText.localeCompare(rightText, 'fa', { numeric: true, sensitivity: 'base' });
  } catch {
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  }
};

const readValue = <T, K extends string>(row: T, spec: SortSpec<K>, accessors: SortAccessors<K, T>): unknown => {
  try {
    const reader = accessors[spec.key];
    if (reader) return reader(row);
    return (row as any)?.[spec.key];
  } catch {
    // A throwing accessor (or a missing key on a partial row) must never break rendering.
    return undefined;
  }
};

/**
 * Sort whole row objects by one or more keys.
 *
 * @param rows      the full row objects - never a column/value array
 * @param specs     ordered sort keys (Shift+click appends to this list)
 * @param accessors optional derived-value readers per key
 * @param tiebreak  optional business tiebreaker (e.g. createdAt) applied after all keys
 */
export const sortRows = <T, K extends string = string>(
  rows: readonly T[],
  specs: readonly SortSpec<K>[],
  accessors: SortAccessors<K, T> = {},
  tiebreak?: (a: T, b: T) => number,
): T[] => {
  const result = [...rows];
  if (!specs || specs.length === 0) return result;

  // Decorate with the source position: it is both the stability guarantee and the
  // last-resort tiebreaker, so rows can never be reshuffled by an unstable engine sort.
  const decorated = result.map((row, index) => ({ row, index }));

  decorated.sort((left, right) => {
    for (const spec of specs) {
      const a = readValue(left.row, spec, accessors);
      const b = readValue(right.row, spec, accessors);
      const aBlank = isBlank(a);
      const bBlank = isBlank(b);
      if (aBlank && bBlank) continue;          // both empty: this key cannot decide
      if (aBlank) return spec.direction === 'asc' ? -1 : 1; // empty values first on asc, last on desc
      if (bBlank) return spec.direction === 'asc' ? 1 : -1;
      const cmp = compareValues(a, b);
      if (cmp !== 0) return spec.direction === 'asc' ? cmp : -cmp;
    }
    if (tiebreak) {
      const fallback = tiebreak(left.row, right.row);
      if (fallback !== 0) return fallback;
    }
    return left.index - right.index;
  });

  return decorated.map((entry) => entry.row);
};

/**
 * The complete Shift+click state machine used by the entry/exit tables.
 *
 *   additive (Shift)  : new key -> appended as an extra level
 *                       existing key, asc  -> flipped to desc
 *                       existing key, desc -> removed from the chain
 *   plain click       : the sole key cycles asc -> desc -> off; any other chain is replaced
 *
 * Returns a fresh array of fresh spec objects: callers may store it directly in React
 * state without ever mutating the previous config.
 */
export const nextSortSpecs = <K extends string>(
  specs: readonly SortSpec<K>[],
  key: K,
  additive: boolean,
): SortSpec<K>[] => {
  const existingIndex = specs.findIndex((spec) => spec.key === key);
  const next: SortSpec<K>[] = specs.map((spec) => ({ ...spec }));

  if (additive) {
    if (existingIndex > -1) {
      if (next[existingIndex].direction === 'asc') next[existingIndex] = { key, direction: 'desc' };
      else next.splice(existingIndex, 1);
    } else {
      next.push({ key, direction: 'asc' });
    }
    return next;
  }

  if (existingIndex > -1 && specs.length === 1) {
    if (specs[0].direction === 'asc') return [{ key, direction: 'desc' }];
    return [];
  }
  return [{ key, direction: 'asc' }];
};

// ---------------------------------------------------------------------------- debug aid (opt-in)

/** localStorage flag that turns the visual sort log on: `localStorage.setItem('nir_debug_sort','1')`. */
export const SORT_DEBUG_FLAG = 'nir_debug_sort';

export const isSortDebugEnabled = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SORT_DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
};

/**
 * Visual debug log for multi-sort questions ("why is this row here?").
 *
 * Enabled only when `localStorage.nir_debug_sort === '1'`, so it costs nothing in production.
 * It prints the applied key chain and the resulting row order, and returns the same rows, so it
 * can be wrapped around `sortRows` in a page without changing behaviour:
 *   `debugSort('entry', sortRows(rows, specs), rows, specs, ['id','sellerName','billWeight'])`
 */
export const debugSort = <T>(
  label: string,
  sorted: T[],
  source: readonly T[],
  specs: readonly SortSpec<string>[],
  columns: string[],
): T[] => {
  if (!isSortDebugEnabled()) return sorted;
  try {
    const chain = specs.length ? specs.map((s, i) => `${i + 1}) ${s.key} ${s.direction}`).join('  |  ') : '(no sort - natural order)';
    console.groupCollapsed(`[sort] ${label} — ${chain} (${sorted.length} rows)`);
    console.log('rows in:', source.length);
    console.table(sorted.map((row, index) => {
      const entry: Record<string, unknown> = { '#': index + 1 };
      for (const column of columns) entry[column] = (row as any)?.[column];
      return entry;
    }));
    console.groupEnd();
  } catch {
    /* a debug helper must never break the table */
  }
  return sorted;
};

