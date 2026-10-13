import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIP_STATUS_FLOW,
  TRIP_STATUS_HINTS,
  TRIP_STATUS_LABELS,
  canReportTripStatus,
  isTripStatus,
  lockedTripStatuses,
  reportableTripStatuses,
  stepIndex,
  tripStatusLabel,
  tripStatusRank,
  tripStatusVariant,
} from '../src/features/driver/tripStatusFlow';

/**
 * Trip-status flow contract (Phase 2, G-8).
 *
 * The flow array and the refusal rules below are a deliberate mirror of `server/routes/mobile.ts`
 * (PATCH /driver/loads/:invoiceId/trip-status). If the server ever changes the flow or one of its 409
 * rules, this test is the tripwire: the screen must not offer a button the server will always reject.
 */
test('Trip status flow mirrors the server rules', async (t) => {
  await t.test('the flow and its labels are complete', () => {
    assert.deepEqual(TRIP_STATUS_FLOW, [
      'assigned',
      'at_origin',
      'loading',
      'at_destination',
      'unloading',
      'delivered',
    ]);

    for (const status of [...TRIP_STATUS_FLOW, 'cancelled'] as const) {
      assert.equal(typeof TRIP_STATUS_LABELS[status], 'string');
      assert.ok(TRIP_STATUS_LABELS[status].length > 0);
      assert.ok((TRIP_STATUS_HINTS[status] || '').length > 0);
    }
  });

  await t.test('unknown values are not accepted as statuses', () => {
    assert.equal(isTripStatus('at_origin'), true);
    assert.equal(isTripStatus('cancelled'), true);
    assert.equal(isTripStatus('tehran'), false);
    assert.equal(isTripStatus(null), false);
    assert.equal(tripStatusLabel('tehran'), TRIP_STATUS_LABELS.assigned);
    assert.equal(tripStatusRank('cancelled'), -1);
    assert.equal(stepIndex('loading'), 2);
    assert.equal(stepIndex('cancelled'), -1);
    assert.equal(tripStatusVariant('delivered'), 'delivered');
    assert.equal(tripStatusVariant('cancelled'), 'error');
  });

  await t.test('forward moves are allowed, backwards moves are refused with a reason', () => {
    assert.deepEqual(canReportTripStatus('assigned', 'at_origin'), { allowed: true });
    assert.deepEqual(canReportTripStatus('at_origin', 'loading'), { allowed: true });

    const back = canReportTripStatus('loading', 'at_origin');
    assert.equal(back.allowed, false);
    assert.match(String(back.reason), /مجاز نیست/);
  });

  await t.test('re-sending the current status is a safe no-op', () => {
    assert.deepEqual(canReportTripStatus('assigned', 'assigned'), { allowed: true, unchanged: true });
  });

  await t.test('a closed or cancelled trip can never move again', () => {
    assert.equal(canReportTripStatus('delivered', 'unloading').allowed, false);
    assert.equal(canReportTripStatus('cancelled', 'assigned').allowed, false);
    assert.equal(canReportTripStatus('cancelled', 'cancelled').allowed, true);
  });

  await t.test('delivered needs the delivery receipt, exactly like the server', () => {
    const withoutProof = canReportTripStatus('unloading', 'delivered');
    assert.equal(withoutProof.allowed, false);
    assert.match(String(withoutProof.reason), /رسید تحویل/);

    assert.deepEqual(canReportTripStatus('unloading', 'delivered', true), { allowed: true });
  });

  await t.test('the buttons offered never contradict the rules', () => {
    assert.deepEqual(reportableTripStatuses('assigned', false), ['at_origin', 'loading', 'cancelled']);
    assert.deepEqual(reportableTripStatuses('unloading', true), ['delivered', 'cancelled']);
    assert.deepEqual(reportableTripStatuses('unloading', false), ['cancelled']);
    assert.deepEqual(reportableTripStatuses('delivered', true), []);
    assert.deepEqual(reportableTripStatuses('cancelled', false), []);

    for (const offered of reportableTripStatuses('at_origin', false)) {
      const decision = canReportTripStatus('at_origin', offered, false);
      assert.equal(decision.allowed, true, `offered ${offered} must be allowed`);
    }
  });

  await t.test('the locked "close trip" button is explained, not silently missing', () => {
    assert.deepEqual(lockedTripStatuses('unloading', false), ['delivered']);
    assert.deepEqual(lockedTripStatuses('unloading', true), []);
    assert.deepEqual(lockedTripStatuses('delivered', false), []);
    assert.deepEqual(lockedTripStatuses('cancelled', false), []);
  });
});
