import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PAGE_SIZE,
  buildInvoiceQuery,
  clampPageSize,
  displayWeightKg,
  isValidJalaliDate,
  normalizeInvoicesPage,
  pageSummary,
  partyName,
  productLabel,
  quickRange,
  rangeLabel,
  remittanceLabel,
  weighStateOf,
  type InvoiceRow,
} from '../src/features/manager/remittanceList';
import {
  buildUnmatchedQuery,
  groupBreakdown,
  isStrongSuggestion,
  normalizeUnmatchedPage,
  scanCoverageNote,
  suggestionLabel,
  suggestionTone,
} from '../src/features/manager/unmatchedDrivers';
import {
  filterInventory,
  inventoryTypeLabel,
  normalizeInventoryItems,
  stockBarPercent,
  stockTone,
  summarizeInventory,
} from '../src/features/manager/inventoryView';
import { addDays, jalaliText } from '../src/utils/jalali';

/**
 * Phase 2 manager screens — contract tests.
 *
 * These pin the client half of three real server contracts (`/api/invoices`,
 * `/api/mobile/manager/unmatched-drivers`, `/api/mobile/manager/kpi`) and the row decorations that
 * replaced the Phase 1 fabrications (a status chip reading a column that cannot hold those values, a
 * sample inventory list, a paging footer that did not exist).
 */
test('Phase 2 manager screens', async (t) => {
  await t.test('the invoice query matches the server parameters exactly', () => {
    assert.deepEqual(buildInvoiceQuery({ tab: 'exit' }), {
      type: 'exit',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    });

    const query = buildInvoiceQuery({
      tab: 'entry',
      search: '  علی  ',
      startDate: '1405/07/01',
      endDate: '2026-09-22',
      page: 3,
      pageSize: 500,
    });

    assert.equal(query.type, 'entry');
    assert.equal(query.search, 'علی');
    assert.equal(query.startDate, '1405/07/01');
    // `invoices.date` is a Jalali TEXT column, so an ISO date can never match: it must not be sent.
    assert.equal('endDate' in query, false);
    assert.equal(query.page, 3);
    assert.equal(query.limit, 200);
  });

  await t.test('page size and page numbers are clamped to what the server accepts', () => {
    assert.equal(clampPageSize(0), 1);
    assert.equal(clampPageSize(25), 25);
    assert.equal(clampPageSize('999'), 200);
    assert.equal(clampPageSize('abc'), DEFAULT_PAGE_SIZE);
    assert.equal(isValidJalaliDate('1405/07/01'), true);
    assert.equal(isValidJalaliDate('2026-09-22'), false);
    assert.equal(isValidJalaliDate(''), false);
  });

  await t.test('a real page payload is normalised, a shapeless one degrades to an empty page', () => {
    const page = normalizeInvoicesPage({
      data: [{ id: 'a' }, { id: 'b' }],
      total: 2393,
      page: 2,
      limit: 50,
      totalPages: 48,
    });

    assert.equal(page.rows.length, 2);
    assert.equal(page.total, 2393);
    assert.equal(page.totalPages, 48);
    assert.equal(page.hasPrev, true);
    assert.equal(page.hasNext, true);

    const empty = normalizeInvoicesPage(undefined);
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.total, 0);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.hasPrev, false);
    assert.equal(empty.hasNext, false);

    const tolerant = normalizeInvoicesPage({ data: 'not-an-array', total: '7' });
    assert.deepEqual(tolerant.rows, []);
    assert.equal(tolerant.total, 7);
  });

  await t.test('weights, parties and labels come from real columns only', () => {
    const row = (partial: Record<string, unknown>): InvoiceRow =>
      ({ id: 'inv_test', ...partial } as InvoiceRow);

    assert.equal(weighStateOf(row({})), 'pending');
    assert.equal(weighStateOf(row({ scaleWeight: '0' })), 'pending');
    assert.equal(weighStateOf(row({ scaleWeight: 12450 })), 'weighed');

    assert.equal(displayWeightKg(row({ scaleWeight: 900, billWeight: 1000 })), 900);
    assert.equal(displayWeightKg(row({ billWeight: 1000 })), 1000);
    assert.equal(displayWeightKg(row({ weight: 5 })), 5);
    assert.equal(displayWeightKg(row({})), 0);

    assert.equal(partyName(row({ sellerName: ' کشاورز الف ' })), 'کشاورز الف');
    assert.equal(partyName(row({ origin: 'بندر' })), 'بندر');
    assert.equal(partyName(row({})), 'نامشخص');

    assert.equal(remittanceLabel(row({ billNumber: 'B-1' })), 'B-1');
    assert.equal(remittanceLabel(row({ invoiceNumber: 'I-9' })), 'I-9');
    assert.equal(remittanceLabel(row({})), 'inv_test');

    // `product_name` is empty on nearly every real row; the list API resolves the product master name.
    assert.equal(productLabel(row({ productName: 'دان پلت' })), 'دان پلت');
    assert.equal(productLabel(row({ masterProductName: 'ذرت برزیل' })), 'ذرت برزیل');
    assert.equal(productLabel(row({ productName: 'دان', masterProductName: 'ذرت' })), 'دان');
    assert.equal(productLabel(row({})), 'نامشخص');

    assert.equal(pageSummary({ rows: [1, 2, 3] as any, total: 2393 } as any), '3 از 2393 حواله');
  });

  await t.test('quick ranges are Jalali and inclusive', () => {
    const now = new Date('2026-10-13T09:00:00Z');
    const today = quickRange('today', now);
    assert.equal(today.startDate, today.endDate);
    assert.equal(today.endDate, jalaliText(now));

    const week = quickRange('last7', now);
    assert.equal(week.startDate, jalaliText(addDays(now, -6)));
    assert.equal(week.endDate, jalaliText(now));

    const month = quickRange('last30', now);
    assert.equal(month.startDate, jalaliText(addDays(now, -29)));
  });

  await t.test('the range label never invents a bound', () => {
    assert.equal(rangeLabel(null, null), 'همه تاریخ‌ها');
    assert.equal(rangeLabel('1405/07/01', '1405/07/10'), 'از 1405/07/01 تا 1405/07/10');
    assert.equal(rangeLabel('1405/07/01', null), 'از 1405/07/01');
    assert.equal(rangeLabel(null, '1405/07/10'), 'تا 1405/07/10');
    assert.equal(rangeLabel('bogus', null), 'همه تاریخ‌ها');
  });

  await t.test('the unmatched-driver query matches the report endpoint', () => {
    assert.deepEqual(buildUnmatchedQuery({}), { limit: 20, page: 1 });
    assert.deepEqual(buildUnmatchedQuery({ type: 'all', page: 2 }), { limit: 20, page: 2 });

    const query = buildUnmatchedQuery({ type: 'exit', search: '  رضا ', page: 0, limit: 999 });
    assert.equal(query.type, 'exit');
    assert.equal(query.search, 'رضا');
    assert.equal(query.page, 1);
    assert.equal(query.limit, 200);
  });

  await t.test('the report payload is normalised without inventing suggestions', () => {
    const page = normalizeUnmatchedPage({
      groups: [
        {
          driverName: ' رضا ',
          count: '3',
          exitCount: 2,
          entryCount: 1,
          suggestionReason: 'phone',
          suggestedDriverName: 'رضا الف',
          phones: ['09120000001'],
          sampleInvoices: ['I-1'],
        },
        { driverName: '', count: 1, suggestionReason: 'weird' },
      ],
      totalGroups: 61,
      totalInvoices: 225,
      scannedInvoices: 2000,
      scanCap: 2000,
      truncated: true,
      driversIndexed: 12,
      page: 2,
      limit: 20,
      totalPages: 4,
    });

    assert.equal(page.groups[0].driverName, 'رضا');
    assert.equal(page.groups[0].count, 3);
    assert.equal(page.groups[0].suggestionReason, 'phone');
    assert.equal(page.groups[0].phones.length, 1);
    assert.equal(page.groups[1].driverName, 'بدون نام');
    assert.equal(page.groups[1].suggestionReason, 'none');
    assert.equal(page.totalGroups, 61);
    assert.equal(page.totalInvoices, 225);
    assert.equal(page.driversIndexed, 12);
    assert.equal(page.totalPages, 4);
    assert.equal(page.truncated, true);
  });

  await t.test('only phone and exact-name matches count as evidence', () => {
    assert.equal(isStrongSuggestion('phone'), true);
    assert.equal(isStrongSuggestion('name-exact'), true);
    assert.equal(isStrongSuggestion('name-close'), false);
    assert.equal(isStrongSuggestion('ambiguous'), false);

    assert.equal(suggestionTone('phone'), 'success');
    assert.equal(suggestionTone('ambiguous'), 'error');
    assert.equal(suggestionTone('name-close'), 'warning');
    assert.equal(suggestionTone('nonsense'), 'info');

    assert.match(suggestionLabel('phone'), /شماره تماس/);
    assert.equal(suggestionLabel('nonsense'), suggestionLabel('none'));
    assert.equal(groupBreakdown({ count: 3, exitCount: 2, entryCount: 1 } as any), '3 حواله (خروجی 2 / ورودی 1)');
  });

  await t.test('the scan-cap warning appears only when the server truncated its scan', () => {
    assert.equal(scanCoverageNote({ truncated: false } as any), null);

    const note = scanCoverageNote({ truncated: true, scanCap: 2000, scannedInvoices: 2000 } as any);
    assert.match(String(note), /2000/);
    assert.match(String(note), /کامل نیست/);
  });

  await t.test('inventory items are classified against the real min stock', () => {
    const items = normalizeInventoryItems([
      { id: 'p1', name: 'ذرت', type: 'raw', currentStock: '0', minStock: 20000, unit: 'kg' },
      { id: 'p2', name: 'کنجاله سویا', type: 'raw', currentStock: 45000, minStock: 15000 },
      { id: 'p3', name: 'دان استارتر', type: 'finished', currentStock: 18000, minStock: 40000 },
    ]);

    const byId = new Map(items.map((item) => [item.id, item]));
    assert.equal(items.length, 3);
    assert.equal(byId.get('p1')!.isOut, true);
    assert.equal(byId.get('p1')!.isLow, false);
    assert.equal(stockTone(byId.get('p1')!), 'out');
    assert.equal(byId.get('p2')!.isLow, false);
    assert.equal(byId.get('p3')!.isLow, true);
    assert.equal(stockTone(byId.get('p3')!), 'low');

    const summary = summarizeInventory(items);
    assert.equal(summary.totalItems, 3);
    assert.equal(summary.totalStockKg, 63000);
    assert.equal(summary.outCount, 1);
    assert.equal(summary.lowCount, 1);
    assert.equal(summary.healthyCount, 1);
    assert.equal(summary.maxStockKg, 45000);

    assert.equal(filterInventory(items, 'raw').length, 2);
    assert.equal(filterInventory(items, 'attention').length, 2);
    assert.equal(filterInventory(items, 'all').length, 3);
    assert.equal(inventoryTypeLabel('raw'), 'مواد اولیه');
    assert.equal(inventoryTypeLabel(''), 'نامشخص');
    assert.equal(stockBarPercent(byId.get('p2')!, 45000), 100);
    assert.equal(stockBarPercent(byId.get('p1')!, 45000), 0);
    assert.equal(stockBarPercent(byId.get('p2')!, 0), 0);
    assert.equal(normalizeInventoryItems(undefined).length, 0);
  });

});
