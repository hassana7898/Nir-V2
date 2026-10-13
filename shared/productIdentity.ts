import { Product } from '../types';
import { textMatchKey } from './persianText';

/**
 * Product identity across renames (هویت محصول در برابر تغییر نام).
 *
 * WHY THIS EXISTS (the «سهمیه یک محصول دو بار تفکیک می‌شود» bug):
 * renaming a product in Settings soft-deletes the old row and pushes a NEW row with a fresh
 * `prod_<timestamp>` id, and the legacy import created slug ids (`پس_دان_یک`). The same real product
 * therefore exists under SEVERAL ids that all display the same name, and everything keyed by the raw
 * `productId` (period quota, inventory, reports, dashboards) splits that one product into several
 * rows. Verified on production — «پس دان یک» exists as:
 *     پس_دان_یک           377 exit invoices
 *     prod_1784728279232  242   (name «پس دان یک»)
 *     prod_1779522275849   53   (name «پس دان یک»)
 * Totals stayed correct (they are one sum) but the breakdown showed the product 2–3 times, which is
 * exactly what the operator saw in مدیریت دوره‌ها — and weighbridge-assigned remittances often landed
 * on a DIFFERENT twin id than the manually typed ones.
 *
 * The fix is to give every id of one product a single CANONICAL id (matched by the normalised name)
 * and to route grouping/lookups through that map, instead of rewriting historical invoice rows.
 */

/** The normalised identity of a product name (Arabic ي/ك, ZWNJ, spacing, digits … all folded). */
export const productNameKey = (name: unknown): string => textMatchKey(name);

/**
 * `productId -> canonical productId` (the id itself when the product has no twins).
 *
 * The canonical row is the ACTIVE one; among equals the LAST in the settings array, because the
 * rename flow appends the new product at the end (so the newest definition wins).
 */
export const buildProductAliasMap = (products: Product[] | undefined): Map<string, string> => {
    const groups = new Map<string, Product[]>();
    for (const product of products || []) {
        if (!product || !product.id || !product.name) continue;
        const key = productNameKey(product.name);
        if (!key) continue; // an unusable name can never be merged with anything
        const bucket = groups.get(key);
        if (bucket) bucket.push(product);
        else groups.set(key, [product]);
    }

    const alias = new Map<string, string>();
    for (const bucket of groups.values()) {
        const active = bucket.filter((p) => !p.isDeleted);
        const pool = active.length ? active : bucket;
        const canonical = pool[pool.length - 1];
        for (const product of bucket) alias.set(product.id, canonical.id);
    }
    return alias;
};

/** The canonical id of a product id (itself when unknown). */
export const canonicalProductId = (alias: Map<string, string> | undefined, id: string): string =>
    (alias && alias.get(id)) || id;

/** True when two ids mean the same real product. */
export const isSameProduct = (alias: Map<string, string> | undefined, a: string, b: string): boolean =>
    canonicalProductId(alias, a) === canonicalProductId(alias, b);

/**
 * One row per real product: the canonical rows only, in their original settings order, so a caller
 * can iterate products WITHOUT rendering the renamed/deleted twins.
 */
export const canonicalProductRows = (products: Product[] | undefined, alias?: Map<string, string>): Product[] =>
    (products || []).filter((p) => !!p && !!p.id && canonicalProductId(alias, p.id) === p.id);

/** How a value defined per product id should be merged across the twins of one product. */
export type MergeValues = 'sum' | 'first' | 'max';

const mergeInto = (map: Map<string, number>, key: string, value: number, how: MergeValues): void => {
    if (!Number.isFinite(value)) return;
    const current = map.get(key);
    if (current === undefined) { map.set(key, value); return; }
    if (how === 'sum') map.set(key, current + value);
    else if (how === 'max') map.set(key, Math.max(current, value));
    // 'first' keeps the value already stored
};

/** Per-product numbers defined in settings (a quota, a phase length …) merged onto canonical ids. */
export const numericByCanonical = (
    entries: { productId: string; value: number }[] | undefined,
    alias: Map<string, string> | undefined,
    how: MergeValues,
): Map<string, number> => {
    const out = new Map<string, number>();
    for (const entry of entries || []) {
        if (!entry || !entry.productId) continue;
        mergeInto(out, canonicalProductId(alias, entry.productId), Number(entry.value), how);
    }
    return out;
};

/**
 * Phase durations merged onto canonical ids. `products` gives the row order so a duration defined on
 * any twin of a product is found; a duration on the canonical row itself always wins.
 */
export const phaseDurationByCanonical = (
    durations: Record<string, number> | undefined,
    products: Product[] | undefined,
    alias: Map<string, string> | undefined,
): Map<string, number> => {
    const out = new Map<string, number>();
    for (const product of products || []) {
        if (!product || !product.id) continue;
        const value = Number((durations || {})[product.id]);
        if (!Number.isFinite(value) || value <= 0) continue;
        const key = canonicalProductId(alias, product.id);
        if (!out.has(key) || key === product.id) out.set(key, value);
    }
    return out;
};
