import test from 'node:test';
import assert from 'node:assert/strict';
import { Product, Farmer } from '../types';
import {
    findContainedName,
    findExactName,
    matchByName,
    matchFarmer,
    matchProduct,
    selectableFarmers,
    selectableProducts,
} from '../shared/weighbridgeMapping';

// Regression suite for «ایجاد حواله از قبض باسکول».
//
// The strings below are REAL values taken from the production database:
//   - the weighing software writes «Goods» as free text and appends « تولید» for in-house feed,
//     e.g. «پس دان یک تولید» while Settings holds «پس دان یک»;
//   - only 544 of 1409 tickets matched a product by exact name, so the product select opened empty;
//   - the modal did not filter soft-deleted products, so a renamed product appeared twice;
//   - it filtered to ONE product type, so raw materials could not be chosen for a «خروج» ticket.

const products: Product[] = [
    { id: 'raw-corn', name: 'ذرت', type: 'rawMaterial' },
    { id: 'raw-soy', name: 'سویا', type: 'rawMaterial' },
    { id: 'raw-oil', name: 'روغن', type: 'rawMaterial' },
    { id: 'raw-conc', name: 'کنسانتره', type: 'rawMaterial' },
    { id: 'raw-conc2', name: 'کنسانتره مرحله دو', type: 'rawMaterial' },
    { id: 'raw-bran', name: 'سبوس', type: 'rawMaterial' },
    { id: 'raw-mineral', name: 'مکمل معدنی', type: 'rawMaterial' },
    { id: 'fin-post1', name: 'پس دان یک', type: 'finishedGood' },
    { id: 'fin-pre', name: 'پیش دان', type: 'finishedGood' },
    { id: 'fin-mid', name: 'میان دان', type: 'finishedGood' },
    { id: 'fin-starter', name: 'پری استارتر', type: 'finishedGood' },
    { id: 'fin-fish-oil', name: 'روغن ماهی', type: 'finishedGood' },
    // The soft-deleted twin a rename leaves behind (real: «میان دان» x2, one isDeleted).
    { id: 'fin-mid-old', name: 'میان دان', type: 'finishedGood', isDeleted: true },
];

const farmers: Farmer[] = [
    { id: 'f1', name: 'کارخانه لطفی', broods: [] },
    { id: 'f2', name: 'کلاوری', broods: [] },
    { id: 'f3', name: 'مهدی سلیمی', broods: [] },
    { id: 'f4', name: 'اسداله انصاری', broods: [] },
    { id: 'f5', name: 'اسماعیل حسن پور-مشفق', broods: [] },
    { id: 'f6', name: 'توحید محمدی-سربند', broods: [] },
    { id: 'f7', name: 'بهروز ازاد', broods: [] },
    { id: 'f8', name: 'مرغدار حذف‌شده', broods: [], isDeleted: true },
];

const nameOf = (row: { name?: string }) => String(row.name ?? '');

test('the vendor suffix « تولید» no longer blocks the product match', () => {
    // These four spellings cover ~89% of the real ticket volume and used to match NOTHING.
    assert.equal(matchProduct('پس دان یک تولید', products, 'finishedGood')?.id, 'fin-post1');
    assert.equal(matchProduct('پیش دان تولید', products, 'finishedGood')?.id, 'fin-pre');
    assert.equal(matchProduct('میان دان تولید', products, 'finishedGood')?.id, 'fin-mid');
    assert.equal(matchProduct('پری استارتر تولید', products, 'finishedGood')?.id, 'fin-starter');
});

test('an exact product name still wins (and never drifts to a similar item)', () => {
    assert.equal(matchProduct('ذرت', products, 'rawMaterial')?.id, 'raw-corn');
    assert.equal(matchProduct('سویا', products, 'rawMaterial')?.id, 'raw-soy');
    // Exact match beats the type preference: the ticket «روغن» must select the «روغن» product even
    // for an exit, not the lexically similar finished good «روغن ماهی».
    assert.equal(matchProduct('روغن', products, 'finishedGood')?.id, 'raw-oil');
    assert.equal(matchProduct('روغن ماهی', products, 'finishedGood')?.id, 'fin-fish-oil');
});

test('the longest candidate wins when several products are contained in the ticket text', () => {
    assert.equal(matchProduct('کنسانتره مرحله دو', products, 'rawMaterial')?.id, 'raw-conc2');
    assert.equal(matchProduct('کنسانتره مرحله یک', products, 'rawMaterial')?.id, 'raw-conc');
});

test('Arabic ي/ك, ZWNJ, NBSP, extra spaces and ه/ة variants never break a match', () => {
    assert.equal(matchProduct('سويا', products, 'rawMaterial')?.id, 'raw-soy');            // Arabic ي
    assert.equal(matchProduct('پس‌دان یک', products, 'finishedGood')?.id, 'fin-post1');      // ZWNJ
    assert.equal(matchProduct('پس دان  یک تولید', products, 'finishedGood')?.id, 'fin-post1'); // double space
    assert.equal(matchProduct('میان\u00A0دان تولید', products, 'finishedGood')?.id, 'fin-mid'); // NBSP
});

test('a typo-level product name is still recovered (fuzzy step)', () => {
    assert.equal(matchProduct('کنستانتره', products, 'rawMaterial')?.id, 'raw-conc'); // real «کنسانتره» typo
});

test('an unknown کالا stays UNSELECTED instead of guessing a random product', () => {
    assert.equal(matchProduct('ضایعات آهن', products, 'rawMaterial'), null);
    assert.equal(matchProduct('', products, 'rawMaterial'), null);
    assert.equal(matchProduct('   ', products, 'rawMaterial'), null);
});

test('selectableProducts hides soft-deleted twins and de-duplicates by name', () => {
    const list = selectableProducts(products);
    assert.equal(list.filter((p) => p.name === 'میان دان').length, 1, 'the renamed twin must not be offered');
    assert.ok(list.every((p) => !p.isDeleted));
    assert.equal(list.length, products.length - 1, 'exactly the deleted twin is dropped');

    // Two ACTIVE rows with the same spelling would still be one option.
    const twiceRaw: Product[] = [
        { id: 'a', name: 'ذرت', type: 'rawMaterial' },
        { id: 'b', name: 'ذرت ', type: 'rawMaterial' },
    ];
    assert.equal(selectableProducts(twiceRaw).length, 1);
});

test('selectableProducts puts the invoice type first and keeps every product reachable', () => {
    const forExit = selectableProducts(products, 'finishedGood');
    assert.equal(forExit.length, selectableProducts(products).length, 'no product may be hidden');
    const firstRaw = forExit.findIndex((p) => p.type === 'rawMaterial');
    const lastFinished = forExit.map((p) => p.type).lastIndexOf('finishedGood');
    assert.ok(lastFinished < firstRaw, 'finished goods come first for an exit');

    // Raw materials ARE selectable for an exit (the reported bug).
    assert.ok(forExit.some((p) => p.id === 'raw-corn'));
});

test('farmers: soft-deleted rows are never offered', () => {
    const list = selectableFarmers(farmers);
    assert.ok(list.every((f) => !f.isDeleted));
    assert.equal(list.length, farmers.length - 1);
    assert.ok(!list.some((f) => f.name === 'مرغدار حذف‌شده'));
});

test('the ticket «نام مشتری» is resolved to the matching farmer', () => {
    // Real production pairs.
    assert.equal(matchFarmer('کارخانه لطفی', farmers)?.id, 'f1');    // exact
    assert.equal(matchFarmer('کلاوری', farmers)?.id, 'f2');          // exact
    assert.equal(matchFarmer('انصاری', farmers)?.id, 'f4');          // abbreviation -> containment
    assert.equal(matchFarmer('اسماعیل حسن پور', farmers)?.id, 'f5'); // suffix «-مشفق» dropped
    assert.equal(matchFarmer('توحید محمدی سربند', farmers)?.id, 'f6'); // «-» vs space
    assert.equal(matchFarmer('بهروز آزاد', farmers)?.id, 'f7');      // آ/ا folded
});

test('a customer that is nobody in the farmer list matches nothing', () => {
    assert.equal(matchFarmer('کلهردانه', farmers), null);
    assert.equal(matchFarmer('', farmers), null);
    assert.equal(matchFarmer('رضا اکبری', farmers), null);
});

test('findExactName / findContainedName behave as the ladder documents', () => {
    assert.equal(findExactName('ذرت', products, nameOf)?.id, 'raw-corn');
    assert.equal(findExactName('ذرت تولید', products, nameOf), null, 'exact step must not do containment');
    assert.equal(findContainedName('ذرت تولید', products, nameOf)?.id, 'raw-corn');
    assert.equal(findContainedName('ضایعات آهن', products, nameOf), null);
    assert.equal(matchByName('انصاری', farmers, nameOf)?.id, 'f4');
});

