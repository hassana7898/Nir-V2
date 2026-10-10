/**
 * Brood (دوره جوجه‌ریزی) list algebra shared by the CLIENT and the SERVER.
 *
 * WHY THIS EXISTS:
 *  - MERGE: farmers are merged all the time (duplicate spellings, a typo fixed later...). Blindly
 *    concatenating `broods` produced visible duplicate periods in the UI and double-counted the
 *    quota/feed numbers of the two rows.
 *  - SOFT DELETE: a period is never physically removed any more; it carries `deletedAt` (ISO) and
 *    is hidden everywhere until it is restored.
 *
 * IDENTITY: broods have no `name` field, so a period is identified by
 *   1. its `id` (stable), and
 *   2. its business identity: the starting exit invoice (`startInvoiceId`) when present, otherwise
 *      the `startDate|chickCount` pair - i.e. "the same period" as the user sees it.
 * Two entries that share either are merged into ONE logical period instead of being listed twice.
 */

export interface BroodLike {
  id: string;
  startDate?: string;
  chickCount?: number;
  endDate?: string;
  startInvoiceId?: string;
  exceptionalFeed?: any[];
  finalChickenWeight?: number;
  includedInvoiceIds?: string[];
  excludedInvoiceIds?: string[];
  activeProductsAtCreation?: string[];
  deletedAt?: string | null;
  [key: string]: any;
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** True when the period is soft-deleted. */
export const isBroodDeleted = (brood: any): boolean => Boolean(brood && brood.deletedAt);

/** The business identity of a period - the closest thing it has to a "name". */
export const broodIdentityKey = (brood: any): string => {
  const invoice = String(brood?.startInvoiceId || '').trim();
  if (invoice) return `inv:${invoice}`;
  const start = String(brood?.startDate || '').trim();
  const chicks = Number(brood?.chickCount || 0);
  return `start:${start}|${chicks}`;
};

const maxDate = (a?: string, b?: string): string | undefined => {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
};

const minDate = (a?: string, b?: string): string | undefined => {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
};

/** Union of id lists (invoices included/excluded) without duplicates. */
const unionIds = (a?: string[], b?: string[]): string[] | undefined => {
  const merged = Array.from(new Set([...asArray<string>(a), ...asArray<string>(b)].filter(Boolean)));
  return merged.length ? merged : undefined;
};

/** Dedupe feed entries by their business identity (product + date + weight + reason). */
const unionFeeds = (a?: any[], b?: any[]): any[] => {
  const merged: any[] = [];
  const seen = new Set<string>();
  for (const feed of [...asArray<any>(a), ...asArray<any>(b)]) {
    if (!feed) continue;
    const key = feed.id
      ? `id:${feed.id}`
      : `k:${feed.productId}|${feed.date}|${feed.weight}|${feed.reason || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(feed);
  }
  return merged;
};


/**
 * Logically combine ONE period with another (same identity).
 *
 * The result is the "superset" period: earliest start, latest end, largest flock, union of feeds
 * and invoice links, and it stays ACTIVE unless BOTH sides were deleted (a live period must never
 * be silently swallowed by a deleted twin).
 */
export const combineBroodPair = (a: BroodLike, b: BroodLike): BroodLike => {
  const aDeleted = isBroodDeleted(a);
  const bDeleted = isBroodDeleted(b);
  // Keep the id of the ACTIVE twin when there is one, so the surviving period is the one the UI
  // was already showing.
  const id = aDeleted && !bDeleted ? b.id : a.id;

  const merged: BroodLike = {
    ...a,
    ...b,
    id,
    startDate: minDate(a.startDate, b.startDate),
    chickCount: Math.max(Number(a.chickCount || 0), Number(b.chickCount || 0)) || undefined,
    endDate: maxDate(a.endDate, b.endDate),
    startInvoiceId: a.startInvoiceId || b.startInvoiceId,
    exceptionalFeed: unionFeeds(a.exceptionalFeed, b.exceptionalFeed),
    includedInvoiceIds: unionIds(a.includedInvoiceIds, b.includedInvoiceIds),
    excludedInvoiceIds: unionIds(a.excludedInvoiceIds, b.excludedInvoiceIds),
    activeProductsAtCreation: unionIds(a.activeProductsAtCreation, b.activeProductsAtCreation),
    finalChickenWeight: a.finalChickenWeight ?? b.finalChickenWeight,
  };

  if (aDeleted && bDeleted) {
    merged.deletedAt = minDate(String(a.deletedAt || ''), String(b.deletedAt || '')) || b.deletedAt || a.deletedAt;
  } else {
    delete merged.deletedAt;
  }
  return merged;
};

/**
 * Merge two brood lists into ONE de-duplicated list.
 *
 * Order: the base list keeps its order (the UI is used to it); new periods are appended. Deleted
 * twins are folded in as well, so a restore can never resurrect a duplicate.
 */
export const mergeBroods = (base: unknown, extra: unknown): BroodLike[] => {
  const result: BroodLike[] = [];
  const byId = new Map<string, number>();
  const byIdentity = new Map<string, number>();

  const absorb = (brood: any) => {
    if (!brood || typeof brood !== 'object') return;
    const id = String(brood.id || '').trim();
    const identity = broodIdentityKey(brood);

    const existingIndex = id && byId.has(id) ? byId.get(id) : byIdentity.get(identity);
    if (existingIndex !== undefined) {
      const combined = combineBroodPair(result[existingIndex], brood as BroodLike);
      result[existingIndex] = combined;
      if (combined.id) byId.set(String(combined.id), existingIndex);
      byIdentity.set(broodIdentityKey(combined), existingIndex);
      return;
    }

    const index = result.push({ ...(brood as BroodLike) }) - 1;
    if (id) byId.set(id, index);
    byIdentity.set(identity, index);
  };

  for (const brood of asArray<any>(base)) absorb(brood);
  for (const brood of asArray<any>(extra)) absorb(brood);
  return result;
};

/** Only the ACTIVE (non-deleted) periods - what every dropdown/form/list must show. */
export const activeBroods = <T extends BroodLike>(broods: unknown): T[] =>
  asArray<T>(broods).filter((brood) => brood && !isBroodDeleted(brood));

/** Only the soft-deleted periods - the recycle bin. */
export const deletedBroods = <T extends BroodLike>(broods: unknown): T[] =>
  asArray<T>(broods).filter((brood) => brood && isBroodDeleted(brood));

/** Apply a soft delete to one period, returning a NEW list (pure - never mutates the input). */
export const softDeleteBrood = <T extends BroodLike>(broods: unknown, broodId: string, deletedAt: string): T[] =>
  asArray<T>(broods).map((brood) => (brood && brood.id === broodId ? { ...brood, deletedAt } : brood));

/** Clear the soft-delete flag of one period, returning a NEW list. */
export const restoreBroodInList = <T extends BroodLike>(broods: unknown, broodId: string): T[] =>
  asArray<T>(broods).map((brood) => {
    if (!brood || brood.id !== broodId) return brood;
    const { deletedAt, ...rest } = brood as any;
    void deletedAt;
    return rest as T;
  });
