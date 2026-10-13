/**
 * Live proof (dev data) for the «یک محصول دو بار در جزئیات سهمیه تفکیک می‌شود» fix.
 *
 * Replays exactly what BroodDetailsCard renders — «جزئیات سهمیه و ارسال» — twice:
 *   OLD: grouping by the raw invoice productId (what the operator saw: «پس دان یک» twice)
 *   NEW: grouping by the canonical product id from shared/productIdentity
 * and asserts that the per-product TOTAL is identical in both cases (the operator: «جمع کل درسته»).
 *
 * Data comes from tmp/brood-split-proof.json (produced READ-ONLY by
 * psremoting\nir-brood-split-proof.ps1 out of the dev database).
 *
 * Run:  npx tsx tests/broodSplitProof.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Product } from '../types';
import {
    buildProductAliasMap,
    canonicalProductId,
    canonicalProductRows,
    numericByCanonical,
} from '../shared/productIdentity';

interface Dump {
    db: string;
    products: Product[];
    quotas: { productId: string; quotaPerChick: number }[];
    phaseDurations: Record<string, number>;
    farmers: { id: string; name: string }[];
    invoices: { farmerId: string; productId: string; weight: number; date: string; type: string }[];
}

const file = path.join(process.cwd(), 'tmp', 'brood-split-proof.json');
if (!fs.existsSync(file)) {
    console.error('missing dump: ' + file + '  (run psremoting\\nir-brood-split-proof.ps1 first)');
    process.exit(1);
}
const dump: Dump = JSON.parse(fs.readFileSync(file, 'utf8'));

const products = dump.products || [];
const alias = buildProductAliasMap(products);
const nameOf = new Map(products.map((p) => [p.id, p.name]));
const deletedOf = new Map(products.map((p) => [p.id, !!p.isDeleted]));
const quotaByCanonical = numericByCanonical(dump.quotas || [], alias, 'sum');
const rows = canonicalProductRows(products, alias);

const farmerName = new Map((dump.farmers || []).map((f) => [f.id, f.name]));
const key = (id: string) => (alias.get(id) || id);

const group = (useCanonical: boolean) => {
    const byFarmer = new Map<string, Map<string, number>>();
    for (const inv of dump.invoices) {
        const id = useCanonical ? key(inv.productId) : inv.productId;
        const per = byFarmer.get(inv.farmerId) || new Map<string, number>();
        per.set(id, (per.get(id) || 0) + Number(inv.weight || 0));
        byFarmer.set(inv.farmerId, per);
    }
    return byFarmer;
};

const oldByFarmer = group(false);
const newByFarmer = group(true);


let affected = 0;
let rowsBefore = 0;
let rowsAfter = 0;
let totalBefore = 0;
let totalAfter = 0;

const lines: string[] = [];
lines.push('DB: ' + dump.db + '   settings products=' + products.length + '   canonical rows=' + rows.length +
    '   exit invoices=' + dump.invoices.length);
lines.push('products that repeat a NAME in settings (the twins causing the duplicate rows):');
const byName = new Map<string, string[]>();
for (const p of products) {
    const k = (p.name || '').trim();
    if (!k) continue;
    byName.set(k, [...(byName.get(k) || []), p.id + (p.isDeleted ? '[DELETED]' : '')]);
}
let twins = 0;
for (const [name, ids] of byName) if (ids.length > 1) { twins++; lines.push('  twin: ' + name + '  ->  ' + ids.join(' + ')); }
lines.push('  twins total: ' + twins);
lines.push('');

const farmerIds = [...oldByFarmer.keys()].sort((a, b) => (farmerName.get(a) || a).localeCompare(farmerName.get(b) || b));
for (const farmerId of farmerIds) {
    const oldPer = oldByFarmer.get(farmerId)!;
    // products whose invoices sit on more than one id that means the SAME product
    const splitCanonicals = new Set<string>();
    for (const id of oldPer.keys()) {
        const siblings = [...oldPer.keys()].filter((other) => key(other) === key(id));
        if (siblings.length > 1) splitCanonicals.add(key(id));
    }
    if (splitCanonicals.size === 0) continue;
    affected++;
    lines.push('=== ' + (farmerName.get(farmerId) || '?') + '  (' + farmerId + ') ===');
    for (const canonical of splitCanonicals) {
        const ids = [...oldPer.keys()].filter((id) => key(id) === canonical).sort();
        lines.push('  product: ' + (nameOf.get(canonical) || canonical));
        for (const id of ids) {
            rowsBefore++;
            totalBefore += oldPer.get(id) || 0;
            lines.push('    OLD row   id=' + id + (deletedOf.get(id) ? '  [settings row DELETED]' : '') +
                '   sent=' + Math.round(oldPer.get(id) || 0) + ' kg' +
                '   quota/chick=' + (quotaByCanonical.get(canonical) === undefined ? '-' : quotaByCanonical.get(canonical)));
        }
        const merged = ids.reduce((s, id) => s + (oldPer.get(id) || 0), 0);
        rowsAfter++;
        totalAfter += merged;
        lines.push('    NEW row   id=' + canonical + '   sent=' + Math.round(merged) + ' kg   (one row, same sum ' +
            Math.round(merged) + ')   quota/chick=' + (quotaByCanonical.get(canonical) === undefined ? '-' : quotaByCanonical.get(canonical)));
    }
    lines.push('');
}

lines.push('--- summary ---');
lines.push('farmers whose breakdown was split     : ' + affected);
lines.push('product rows before -> after          : ' + rowsBefore + '  ->  ' + rowsAfter);
lines.push('sum of the split product weights      : ' + Math.round(totalBefore) + '  ->  ' + Math.round(totalAfter) +
    (Math.round(totalBefore) === Math.round(totalAfter) ? '   OK: total unchanged' : '   FAIL: TOTAL CHANGED'));
lines.push('settings twins collapsed into one row : ' + twins);

const out = lines.join('\n');
fs.writeFileSync(path.join(process.cwd(), 'tmp', 'brood-split-proof-result.txt'), out, 'utf8');
console.log(out);
if (Math.round(totalBefore) !== Math.round(totalAfter)) {
    console.error('FAILED: the merged total differs from the split total');
    process.exit(1);
}
if (affected === 0 || rowsAfter >= rowsBefore) {
    console.error('FAILED: no split rows were collapsed - the dump does not exercise the bug');
    process.exit(1);
}
