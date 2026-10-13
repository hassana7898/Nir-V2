import { Farmer, Product, ProductType } from '../types';
import { findClosestName, textMatchKey } from './persianText';

/**
 * Matching the weighing software's free text («نوع کالا» / «نام مشتری») to the master data.
 *
 * WHY THIS EXISTS (the «ایجاد حواله از قبض باسکول» bug):
 * the ticket's goods column is the VENDOR'S own text and almost never equals a product name.
 * In production only 544 of 1409 tickets matched a product by exact name, because the ticket says
 * «پس دان یک تولید» while Settings holds «پس دان یک» — so the product select opened empty, and for
 * «خروج» it only ever offered the (few) finished goods. The dropdown also listed soft-deleted twins
 * of renamed products, so the same product appeared twice.
 *
 * The matching ladder (strongest signal first), all on `textMatchKey` so Arabic ي/ك, ZWNJ, NBSP,
 * repeated spaces and Persian/Arabic digits never break a match:
 *   1. exact normalised name
 *   2. containment, either direction, longest candidate wins
 *      - the ticket adds a suffix:   «پس دان یک تولید»   -> «پس دان یک»
 *      - the ticket is abbreviated:  «انصاری»            -> «اسداله انصاری»
 *   3. typo-level fuzzy match       «کنستانتره»         -> «کنسانتره»
 * Anything that still does not match stays UNSELECTED (never guess an unrelated product).
 */

const nameOf = (row: { name?: unknown } | null | undefined): string => String(row?.name ?? '');

/** Exact normalised-name match. */
export const findExactName = <T>(value: unknown, rows: T[], getName: (row: T) => string): T | null => {
    const key = textMatchKey(value);
    if (!key) return null;
    for (const row of rows) {
        if (textMatchKey(getName(row)) === key) return row;
    }
    return null;
};

/**
 * Containment match in BOTH directions; when several candidates fit, the LONGEST one wins so
 * «کنسانتره مرحله دو» prefers a «کنسانتره مرحله دو» product over a plain «کنسانتره» one.
 */
export const findContainedName = <T>(value: unknown, rows: T[], getName: (row: T) => string): T | null => {
    const key = textMatchKey(value);
    if (!key) return null;
    let best: T | null = null;
    let bestLength = 0;
    for (const row of rows) {
        const rowKey = textMatchKey(getName(row));
        if (!rowKey || rowKey.length <= bestLength) continue;
        if (rowKey.indexOf(key) === -1 && key.indexOf(rowKey) === -1) continue;
        best = row;
        bestLength = rowKey.length;
    }
    return best;
};

/** Typo-level match ("did you mean…?"), reusing the shared Persian comparison helpers. */
export const findFuzzyName = <T>(value: unknown, rows: T[], getName: (row: T) => string): T | null =>
    findClosestName(value, rows, getName, 2)?.candidate ?? null;

/** The full ladder for a plain named row. */
export const matchByName = <T>(value: unknown, rows: T[], getName: (row: T) => string): T | null =>
    findExactName(value, rows, getName) ?? findContainedName(value, rows, getName) ?? findFuzzyName(value, rows, getName);

/**
 * The products a form may offer: not soft-deleted, one entry per normalised name (a renamed product
 * leaves a deleted twin behind, and even two ACTIVE rows with the same spelling must not show up
 * twice), optionally with the invoice type's own products first.
 */
export const selectableProducts = (products: Product[] | undefined, preferredType?: ProductType): Product[] => {
    const byName = (a: Product, b: Product) => String(a.name).localeCompare(String(b.name), 'fa');
    const seen = new Set<string>();
    const unique: Product[] = [];
    for (const product of products || []) {
        if (!product || !product.id || !product.name || product.isDeleted) continue;
        const key = textMatchKey(product.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(product);
    }
    if (!preferredType) return unique.sort(byName);
    const preferred = unique.filter((p) => p.type === preferredType).sort(byName);
    const rest = unique.filter((p) => p.type !== preferredType).sort(byName);
    return [...preferred, ...rest];
};

/**
 * The product a ticket's «نوع کالا» points at.
 *
 * The exact name wins EVERYWHERE before any containment is considered, so a ticket that says
 * «روغن» selects the «روغن» product for an EXIT too, instead of a similarly-worded finished good
 * («روغن ماهی»). Containment/fuzzy then run inside the invoice type's own products first, so an
 * entry ticket prefers raw materials and an exit ticket prefers finished goods.
 */
export const matchProduct = (
    goods: unknown,
    products: Product[] | undefined,
    preferredType?: ProductType,
): Product | null => {
    const list = selectableProducts(products);
    if (!list.length || !textMatchKey(goods)) return null;

    const exact = findExactName(goods, list, (p) => p.name);
    if (exact) return exact;

    const preferred = preferredType ? list.filter((p) => p.type === preferredType) : [];
    return (
        findContainedName(goods, preferred, (p) => p.name) ??
        findContainedName(goods, list, (p) => p.name) ??
        findFuzzyName(goods, preferred, (p) => p.name) ??
        findFuzzyName(goods, list, (p) => p.name) ??
        null
    );
};

/** Farmer rows a form may offer: not soft-deleted, sorted by name (Persian collation). */
export const selectableFarmers = (farmers: Farmer[] | undefined): Farmer[] =>
    (farmers || [])
        .filter((farmer) => farmer && farmer.id && farmer.name && !farmer.isDeleted)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));

/** The farmer a ticket's «نام مشتری» points at (exact -> containment -> typo-level). */
export const matchFarmer = (customerName: unknown, farmers: Farmer[] | undefined): Farmer | null =>
    matchByName(customerName, selectableFarmers(farmers), (f) => f.name);
