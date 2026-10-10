import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, nextSortSpecs, SortSpec } from '../utils/tableSort';

// Regression suite for the SEVERE multi-sort data-mapping bug.
//
// Rule under test: sorting re-orders WHOLE row objects. Column values must never be sorted
// independently of their owner, because that renders one farmer's name beside another farmer's
// weights ("scrambled rows"). Every assertion below verifies that identity.

interface Row {
    id: string;
    sellerName: string;
    productId: string;
    billWeight: number | string;
    scaleWeight: number;
    driverName: string;
    createdAt: number;
}

const row = (
    id: string,
    sellerName: string,
    productId: string,
    billWeight: number | string,
    createdAt: number,
    driverName = 'راننده ' + id,
): Row => ({ id, sellerName, productId, billWeight, scaleWeight: 0, driverName, createdAt });

// Each farmer owns a UNIQUE pair of (name, weight/id), so any value detaching becomes visible.
const rows: Row[] = [
    row('r1', 'مرغدار ب', 'corn', 300, 1000),
    row('r2', 'مرغدار الف', 'soybean', 100, 2000),
    row('r3', 'مرغدار ب', 'corn', 200, 3000),
    row('r4', 'مرغدار الف', 'soybean', 400, 4000),
    row('r5', 'مرغدار پ', 'corn', 100, 5000),
];

const byId = new Map(rows.map((r) => [r.id, r]));

/** The UI's proof of integrity: every rendered cell still belongs to the row that owns it. */
const assertRowIntegrity = (sorted: Row[], source: Row[] = rows) => {
    const sourceById = new Map(source.map((r) => [r.id, r]));
    assert.equal(sorted.length, source.length, 'no row may be dropped or duplicated');
    for (const sortedRow of sorted) {
        const original = sourceById.get(sortedRow.id);
        assert.ok(original, `unknown row id ${sortedRow.id}`);
        assert.equal(sortedRow, original, 'the SAME object reference must be re-ordered, not a copy of its cells');
    }
    assert.deepEqual(
        [...sorted].map((r) => r.id).sort(),
        [...source].map((r) => r.id).sort(),
        'same row set',
    );
};

test('single-column sort re-orders whole row objects (no cell can detach)', () => {
    const sorted = sortRows<Row, keyof Row>(rows, [{ key: 'sellerName', direction: 'asc' }]);
    assertRowIntegrity(sorted);

    // Farmer name and weight must travel together: sorted by name, the (name, weight) pairs are
    // exactly the original pairs. Rows with the SAME name keep their incoming order (stability).
    assert.deepEqual(
        sorted.map((r) => `${r.sellerName}|${r.billWeight}|${r.id}`),
        [
            'مرغدار الف|100|r2',
            'مرغدار الف|400|r4',
            'مرغدار ب|300|r1',
            'مرغدار ب|200|r3',
            'مرغدار پ|100|r5',
        ],
        'each weight stays attached to the farmer that owns it',
    );
});

test('SHIFT (multi-level) sort keeps every row intact', () => {
    const config: SortSpec<keyof Row>[] = [
        { key: 'sellerName', direction: 'asc' },
        { key: 'billWeight', direction: 'desc' },
    ];
    const sorted = sortRows<Row, keyof Row>(rows, config, {}, (a, b) => a.createdAt - b.createdAt);
    assertRowIntegrity(sorted);

    assert.deepEqual(
        sorted.map((r) => `${r.sellerName}|${r.billWeight}`),
        ['مرغدار الف|400', 'مرغدار الف|100', 'مرغدار ب|300', 'مرغدار ب|200', 'مرغدار پ|100'],
        'level 1 groups by farmer, level 2 orders that farmer own weights descending',
    );
    // The regression: the first column must NOT stay frozen while later columns "shift".
    assert.deepEqual(sorted.map((r) => r.id), ['r4', 'r2', 'r1', 'r3', 'r5']);
});

test('three-level sort stays consistent and deterministic', () => {
    const config: SortSpec<keyof Row>[] = [
        { key: 'productId', direction: 'asc' },
        { key: 'sellerName', direction: 'asc' },
        { key: 'billWeight', direction: 'asc' },
    ];
    const a = sortRows<Row, keyof Row>(rows, config);
    const b = sortRows<Row, keyof Row>(rows, config);
    assertRowIntegrity(a);
    assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id), 'the same config always yields the same row order');
    assert.deepEqual(a.map((r) => r.productId), ['corn', 'corn', 'corn', 'soybean', 'soybean']);
});

test('rows are never mutated and the input order is preserved', () => {
    const before = rows.map((r) => r.id);
    const snapshot = rows.map((r) => ({ ...r }));

    const sorted = sortRows<Row, keyof Row>(rows, [{ key: 'billWeight', direction: 'desc' }]);

    assert.deepEqual(rows.map((r) => r.id), before, 'the caller array (React state) is untouched');
    assert.deepEqual(rows.map((r) => ({ ...r })), snapshot, 'row contents are untouched');
    assert.notEqual(sorted, rows, 'a NEW array is returned for the view');
    assertRowIntegrity(sorted);
});

test('equal keys fall back to the next key and finally to the original position (stable)', () => {
    const ties: Row[] = [
        row('a', 'یکسان', 'corn', 10, 900),
        row('b', 'یکسان', 'corn', 10, 800),
        row('c', 'یکسان', 'corn', 10, 700),
    ];
    const sorted = sortRows<Row, keyof Row>(ties, [{ key: 'sellerName', direction: 'asc' }]);
    assert.deepEqual(sorted.map((r) => r.id), ['a', 'b', 'c'], 'equal keys keep the incoming order');
});

test('numeric strings compare numerically, not lexicographically', () => {
    const weights: Row[] = [
        row('w10', 'x', 'corn', '10', 1),
        row('w9', 'x', 'corn', '9', 2),
        row('w100', 'x', 'corn', '100', 3),
    ];
    assert.deepEqual(
        sortRows<Row, keyof Row>(weights, [{ key: 'billWeight', direction: 'asc' }]).map((r) => r.id),
        ['w9', 'w10', 'w100'],
    );
});

test('empty values sort first on asc and last on desc without disturbing other rows', () => {
    const mixed: Row[] = [
        row('with', 'دارد', 'corn', 50, 1),
        { ...row('without', 'بدون', 'corn', '', 2), billWeight: '' },
    ];
    const asc = sortRows<Row, keyof Row>(mixed, [{ key: 'billWeight', direction: 'asc' }]);
    const desc = sortRows<Row, keyof Row>(mixed, [{ key: 'billWeight', direction: 'desc' }]);
    assert.deepEqual(asc.map((r) => r.id), ['without', 'with']);
    assert.deepEqual(desc.map((r) => r.id), ['with', 'without']);
    assertRowIntegrity(asc, mixed);
});

test('derived accessors (productOrderMap / farmerMap) only READ from the owning row', () => {
    const order = new Map<string, number>([['corn', 0], ['soybean', 1]]);
    const names = new Map<string, string>([['r1', 'مرغدار ب'], ['r2', 'مرغدار الف']]);
    const sorted = sortRows<Row, 'productId' | 'sellerName'>(
        rows,
        [{ key: 'productId', direction: 'asc' }, { key: 'sellerName', direction: 'asc' }],
        { productId: (r) => order.get(r.productId) ?? 999, sellerName: (r) => names.get(r.id) ?? '' },
    );
    assertRowIntegrity(sorted);
    assert.equal(sorted[0].productId, 'corn');
    assert.equal(sorted[sorted.length - 1].productId, 'soybean');
    for (const r of sorted) {
        assert.equal(r.sellerName, byId.get(r.id)!.sellerName, 'the accessor never re-assigns values');
    }
});

test('an empty sort config still returns a copy so a view can never mutate the store', () => {
    const sorted = sortRows<Row, keyof Row>(rows, []);
    assert.deepEqual(sorted.map((r) => r.id), rows.map((r) => r.id));
    assert.notEqual(sorted, rows);
});

// ------------------------------------------------------------------ Shift+click state machine

test('Shift adds a secondary key, toggles its direction, then removes it', () => {
    let config: SortSpec<string>[] = [];

    config = nextSortSpecs(config, 'sellerName', false);
    assert.deepEqual(config, [{ key: 'sellerName', direction: 'asc' }]);

    config = nextSortSpecs(config, 'billWeight', true); // SHIFT + click
    assert.deepEqual(config, [
        { key: 'sellerName', direction: 'asc' },
        { key: 'billWeight', direction: 'asc' },
    ]);

    config = nextSortSpecs(config, 'billWeight', true); // SHIFT + click again -> desc
    assert.deepEqual(config, [
        { key: 'sellerName', direction: 'asc' },
        { key: 'billWeight', direction: 'desc' },
    ]);

    config = nextSortSpecs(config, 'billWeight', true); // SHIFT + click a third time -> removed
    assert.deepEqual(config, [{ key: 'sellerName', direction: 'asc' }]);
});

test('plain click cycles asc -> desc -> off and replaces a multi-sort chain', () => {
    let config: SortSpec<string>[] = [];
    config = nextSortSpecs(config, 'sellerName', false);
    config = nextSortSpecs(config, 'sellerName', false);
    assert.deepEqual(config, [{ key: 'sellerName', direction: 'desc' }]);
    config = nextSortSpecs(config, 'sellerName', false);
    assert.deepEqual(config, []);

    config = nextSortSpecs([{ key: 'a', direction: 'asc' }, { key: 'b', direction: 'asc' }], 'c', false);
    assert.deepEqual(config, [{ key: 'c', direction: 'asc' }]);
});

test('the sort config is never mutated in place', () => {
    const prev: SortSpec<string>[] = [{ key: 'sellerName', direction: 'asc' }];
    const next = nextSortSpecs(prev, 'billWeight', true);
    assert.deepEqual(prev, [{ key: 'sellerName', direction: 'asc' }]);
    assert.notEqual(next, prev);
    assert.notEqual(next[0], prev[0], 'spec objects are copies too');
});

