import test from 'node:test';
import assert from 'node:assert/strict';
import {
    farmerNameKey,
    findClosestName,
    groupByFarmerKey,
    isSameFarmerName,
    levenshtein,
    normalizePersianText,
    normalizePhone,
    toAsciiDigits,
} from '../shared/persianText';

// Regression suite for the DUPLICATE FARMER outage.
//
// Rule under test: the same human must produce the same name key regardless of Arabic/Persian
// letter variants, ZWNJ, NBSP, repeated spaces, or Persian-Arabic (vs Latin) digits. Otherwise the
// farmer is stored twice and Period Management (مدیریت دوره‌ها) splits his history.

test('Arabic letter variants are folded into Persian letters', () => {
    // "مرغدار" typed with Arabic ي/ك/ة must equal the Persian spelling.
    const persian = 'مرغدار علی کاظمه';
    const arabic = 'مرغدار علي كاظمة';
    assert.equal(normalizePersianText(arabic), persian);
    assert.equal(farmerNameKey(arabic), farmerNameKey(persian));
    assert.ok(isSameFarmerName(arabic, persian));
});

test('stray spaces, NBSP, zero-width joiners and tabs never split an identity', () => {
    const canonical = 'حسین محمدی';
    const variants = [
        '  حسین محمدی  ',
        'حسین  محمدی',
        'حسین\u00A0محمدی',
        'حسین\u200Cمحمدی',
        'حسین\tمحمدی',
        'حسین\u200Fمحمدی',
    ];
    for (const variant of variants) {
        assert.equal(farmerNameKey(variant), farmerNameKey(canonical), `variant failed: ${JSON.stringify(variant)}`);
    }
    // The ZWNJ is preserved for DISPLAY (legitimate Persian orthography) but ignored for MATCHING.
    assert.equal(normalizePersianText('می\u200Cرود'), 'می\u200Cرود');
    assert.equal(farmerNameKey('می\u200Cرود'), farmerNameKey('میرود'));
});

test('Persian and Arabic-Indic digits compare equal to Latin digits', () => {
    assert.equal(toAsciiDigits('۱۲۳'), '123');
    assert.equal(toAsciiDigits('١٢٣'), '123');
    assert.equal(farmerNameKey('مرغدار ۱۲'), farmerNameKey('مرغدار 12'));
});

test('empty / whitespace-only names never become a matchable key', () => {
    assert.equal(farmerNameKey('   '), '');
    assert.equal(isSameFarmerName('   ', ''), false, 'two empty names must NOT be treated as the same farmer');
    assert.equal(isSameFarmerName('علی', 'حسن'), false);
});

test('phones are normalised to digits (Persian digits included)', () => {
    assert.equal(normalizePhone('0912 345 6789'), '09123456789');
    assert.equal(normalizePhone('۰۹۱۲-۳۴۵-۶۷۸۹'), '09123456789');
    assert.equal(normalizePhone('+98 912 345 6789'), '+989123456789');
    assert.equal(normalizePhone(''), '');
});

test('levenshtein is bounded and exact on small edits', () => {
    assert.equal(levenshtein('کاظمی', 'کاظمی'), 0);
    assert.equal(levenshtein('کاظمی', 'کاظمى'), 1, 'ي/ى variant is a single edit');
    assert.equal(levenshtein('abc', 'abcde', 2), 2, 'two insertions are still within the threshold');
    assert.equal(levenshtein('abc', 'abcdefgh', 2), 3, 'returns maxDistance+1 when the difference is hopeless');
});

test('findClosestName reports an exact key match, and a typo as "close"', () => {
    const farmers = [
        { id: 'f1', name: 'مرغدار الف' },
        { id: 'f2', name: 'مرغدار الفب' },
    ];
    const exact = findClosestName('مرغدار الف', farmers, (f) => f.name);
    assert.equal(exact?.candidate.id, 'f1');
    assert.equal(exact?.kind, 'exact');
    assert.equal(exact?.distance, 0);

    // One-letter typo against 'مرغدار الفب' -> fuzzy suggestion.
    const fuzzy = findClosestName('مرغدار القب', farmers, (f) => f.name);
    assert.equal(fuzzy?.candidate.id, 'f2');
    assert.equal(fuzzy?.kind, 'close');
    assert.ok((fuzzy?.distance ?? 99) <= 2);
});

test('findClosestName returns null for a genuinely different name and for empty input', () => {
    const farmers = [{ id: 'f1', name: 'حسین محمدی' }];
    assert.equal(findClosestName('رضا اکبری', farmers, (f) => f.name), null);
    assert.equal(findClosestName('', farmers, (f) => f.name), null);
});

test('groupByFarmerKey collects the duplicate rows that broke period management', () => {
    const farmers = [
        { id: 'a', name: 'مرغدار علی کاظمی' },
        { id: 'b', name: 'مرغدار علي كاظمی ' },   // Arabic ي + trailing space -> same key
        { id: 'c', name: 'مرغدار حسین' },
    ];
    const groups = groupByFarmerKey(farmers, (f) => f.name);
    const duplicateGroup = Array.from(groups.values()).find((list) => list.length > 1);
    assert.ok(duplicateGroup, 'the two spellings must land in ONE group');
    assert.deepEqual(duplicateGroup.map((f) => f.id), ['a', 'b']);
    assert.equal(groups.size, 2);
});
