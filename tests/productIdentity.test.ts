import test from 'node:test';
import assert from 'node:assert/strict';
import { Product } from '../types';
import {
    buildProductAliasMap,
    canonicalProductId,
    canonicalProductRows,
    isSameProduct,
    numericByCanonical,
    phaseDurationByCanonical,
    productNameKey,
} from '../shared/productIdentity';

// Regression suite for the «سهمیه یک محصول دو بار تفکیک می‌شود» bug in مدیریت دوره‌ها.
//
// The product ids and the rename history below are the REAL ones found in production: «پس دان یک»
// exists under a legacy slug id and two `prod_` ids (one of them soft-deleted by a rename), so the
// period breakdown rendered the same product two or three times.

const products: Product[] = [
    { id: 'پس_دان_یک', name: 'پس دان یک', type: 'finishedGood' },
    { id: 'prod_1779522275849', name: 'پس دان یک', type: 'finishedGood', isDeleted: true },
    { id: 'prod_1784728279232', name: 'پس دان یک', type: 'finishedGood' }, // newest → canonical
    { id: 'میان_دان', name: 'میان دان', type: 'finishedGood' },
    { id: 'prod_1784728275367', name: 'میان دان', type: 'finishedGood' },
    { id: 'ذرت', name: 'ذرت', type: 'rawMaterial' },
    { id: 'fin-oil', name: 'روغن', type: 'finishedGood' },
    { id: 'fin-fish-oil', name: 'روغن ماهی', type: 'finishedGood' },
];

const alias = buildProductAliasMap(products);

test('every id of one product resolves to ONE canonical id', () => {
    assert.equal(canonicalProductId(alias, 'پس_دان_یک'), 'prod_1784728279232');
    assert.equal(canonicalProductId(alias, 'prod_1779522275849'), 'prod_1784728279232');
    assert.equal(canonicalProductId(alias, 'prod_1784728279232'), 'prod_1784728279232');
    assert.ok(isSameProduct(alias, 'پس_دان_یک', 'prod_1779522275849'), 'slug and old prod_ id are one product');
    assert.ok(isSameProduct(alias, 'میان_دان', 'prod_1784728275367'));
});

test('the canonical row is the ACTIVE one, never the soft-deleted twin', () => {
    const canonical = canonicalProductRows(products, alias);
    const ids = canonical.map((p) => p.id);
    assert.deepEqual(ids, ['prod_1784728279232', 'prod_1784728275367', 'ذرت', 'fin-oil', 'fin-fish-oil']);
    assert.equal(canonical.filter((p) => p.name === 'پس دان یک').length, 1, 'one row per real product');
    assert.equal(canonical.filter((p) => p.name === 'میان دان').length, 1);
    assert.ok(!ids.includes('prod_1779522275849'), 'the deleted twin must not be listed');
});

test('name spellings with ZWNJ / Arabic letters / spacing are still one product', () => {
    assert.equal(productNameKey('پس دان یک'), productNameKey('پس\u200Cدان یک'));
    assert.equal(productNameKey('پس دان یک'), productNameKey('پس دان  يك')); // Arabic ي + double space
    const merged = buildProductAliasMap([
        { id: 'a', name: 'پیش دان', type: 'finishedGood' },
        { id: 'b', name: 'پیش\u200Cدان', type: 'finishedGood' },
    ]);
    assert.equal(merged.get('a'), 'b', 'the later row wins');
});

test('similar-but-different names never collapse (پس دان vs پس دان یک)', () => {
    assert.notEqual(productNameKey('پس دان'), productNameKey('پس دان یک'));
    const split = buildProductAliasMap([
        { id: 'x', name: 'پس دان', type: 'finishedGood' },
        { id: 'y', name: 'پس دان یک', type: 'finishedGood' },
    ]);
    assert.equal(split.get('x'), 'x');
    assert.equal(split.get('y'), 'y');
    assert.ok(!isSameProduct(split, 'x', 'y'));
    const rows = canonicalProductRows([{ id: 'x', name: 'پس دان', type: 'finishedGood' }, { id: 'y', name: 'پس دان یک', type: 'finishedGood' }], split);
    assert.equal(rows.length, 2, 'two genuinely different products stay separate');
});

test('a quota defined on any twin is summed onto the canonical id', () => {
    const quotas = numericByCanonical(
        [
            { productId: 'پس_دان_یک', value: 11750 },
            { productId: 'prod_1784728279232', value: 250 },
            { productId: 'prod_1779522275849', value: 100 },
        ],
        alias,
        'sum',
    );
    assert.equal(quotas.get('prod_1784728279232'), 12100);
    assert.equal(quotas.size, 1, 'all three rows feed one canonical product');
});

test('a phase duration defined on an old twin is still found', () => {
    const durations = phaseDurationByCanonical(
        { 'prod_1779522275849': 12, 'prod_1784728275367': 8 },
        products,
        alias,
    );
    assert.equal(durations.get('prod_1784728279232'), 12);
    assert.equal(durations.get('prod_1784728275367'), 8);
});

test('rows without a usable name are skipped instead of crashing or merging', () => {
    const messy = buildProductAliasMap([
        { id: 'ok', name: 'ذرت', type: 'rawMaterial' },
        { id: 'noname', name: '', type: 'rawMaterial' },
        { id: 'blank', name: '   ', type: 'rawMaterial' },
        { id: 'nullish', name: null as any, type: 'rawMaterial' },
    ] as Product[]);
    assert.equal(messy.get('ok'), 'ok');
    assert.equal(messy.has('noname'), false);
    assert.equal(messy.has('blank'), false);
    assert.equal(messy.get('noname'), undefined, 'an unnamed product is left exactly as it is');
    assert.equal(canonicalProductId(messy, 'noname'), 'noname', 'unknown ids pass through unchanged');
});
test('production case: a farmer whose twin ids split ONE product now shows one row', () => {
    // Real production data (nir-brood-dup-audit.ps1 section C):
    //   کلاوری (farmer_1782578382197), میان دان → 2 invoices on the DELETED twin
    //   (prod_1779522270884, 25330 kg) + 11 invoices on the ACTIVE id (prod_1784728275367, 136520 kg)
    // The period breakdown listed «میان دان» twice (one row with no quota at all), while the total
    // was right — exactly the screenshot the operator sent.
    const realProducts: Product[] = [
        { id: 'prod_1779522270884', name: 'میان دان', type: 'finishedGood', isDeleted: true },
        { id: 'prod_1784728275367', name: 'میان دان', type: 'finishedGood' },
    ];
    const realAlias = buildProductAliasMap(realProducts);
    const invoices = [
        { productId: 'prod_1779522270884', weight: 13100 },
        { productId: 'prod_1779522270884', weight: 12230 },
        { productId: 'prod_1784728275367', weight: 136520 },
    ];

    // What the page does now: weights are summed per CANONICAL product …
    const sent = new Map<string, number>();
    invoices.forEach(inv => sent.set(canonicalProductId(realAlias, inv.productId), (sent.get(canonicalProductId(realAlias, inv.productId)) || 0) + inv.weight));

    // … and the rows come from the canonical product list, so the product is listed ONCE.
    const rows = canonicalProductRows(realProducts, realAlias);
    assert.equal(rows.length, 1, '«میان دان» must be a single row');
    assert.equal(rows[0].id, 'prod_1784728275367');
    assert.equal(sent.size, 1, 'all three invoices land on the same group');
    assert.equal(sent.get('prod_1784728275367'), 161850);
    assert.equal(rows[0].name, 'میان دان');
});


test('an empty product list is safe', () => {
    assert.equal(buildProductAliasMap(undefined).size, 0);
    assert.deepEqual(canonicalProductRows(undefined, buildProductAliasMap([])), []);
    assert.equal(canonicalProductId(undefined, 'anything'), 'anything');
});
