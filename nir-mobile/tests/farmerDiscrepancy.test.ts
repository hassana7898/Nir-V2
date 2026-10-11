import test from 'node:test';
import assert from 'node:assert/strict';
import { toPersianDigits } from '../src/utils/formatters';

export interface DiscrepancyResult {
  delta: number | null;
  isMismatch: boolean;
  statusVariant: 'success' | 'mismatch' | 'pending';
  displayText: string;
}

/**
 * Pure evaluation function replicating FarmerInvoicesScreen discrepancy logic.
 */
export function evaluateWeightDiscrepancy(
  invoiceWeight: number,
  scaleWeight?: number | null,
  thresholdKg = 50
): DiscrepancyResult {
  if (scaleWeight === null || scaleWeight === undefined || isNaN(scaleWeight)) {
    return {
      delta: null,
      isMismatch: false,
      statusVariant: 'pending',
      displayText: 'در انتظار توزین باسکول',
    };
  }

  const delta = Math.abs(invoiceWeight - scaleWeight);
  const isMismatch = delta > thresholdKg;

  return {
    delta,
    isMismatch,
    statusVariant: isMismatch ? 'mismatch' : 'success',
    displayText: isMismatch
      ? `⚠ مغایرت وزن: ${toPersianDigits(delta)} کیلوگرم اختلاف با باسکول`
      : `✓ وزن منطبق (اختلاف ناچیز: ${toPersianDigits(delta)} کیلوگرم)`,
  };
}

test('Farmer Weighbridge Discrepancy Evaluation Protocol', async (t) => {
  await t.test('Unweighed ticket resolves cleanly to pending state', () => {
    const res = evaluateWeightDiscrepancy(10000, null);
    assert.equal(res.delta, null);
    assert.equal(res.isMismatch, false);
    assert.equal(res.statusVariant, 'pending');
    assert.equal(res.displayText, 'در انتظار توزین باسکول');
  });

  await t.test('Exact match (0 kg difference) resolves to matching green badge', () => {
    const res = evaluateWeightDiscrepancy(12500, 12500);
    assert.equal(res.delta, 0);
    assert.equal(res.isMismatch, false);
    assert.equal(res.statusVariant, 'success');
    assert.ok(res.displayText.includes('وزن منطبق'));
    assert.ok(res.displayText.includes('۰ کیلوگرم'));
  });

  await t.test('Minor difference <= 50 kg resolves to matching green badge', () => {
    // 30 kg difference (12530 vs 12500)
    const res1 = evaluateWeightDiscrepancy(12530, 12500);
    assert.equal(res1.delta, 30);
    assert.equal(res1.isMismatch, false);
    assert.equal(res1.statusVariant, 'success');
    assert.ok(res1.displayText.includes('۳۰ کیلوگرم'));

    // Boundary check: exact 50 kg difference (must stay matching)
    const res2 = evaluateWeightDiscrepancy(10000, 10050);
    assert.equal(res2.delta, 50);
    assert.equal(res2.isMismatch, false);
    assert.equal(res2.statusVariant, 'success');
  });

  await t.test('Significant difference > 50 kg resolves to red discrepancy warning', () => {
    // Boundary check: 51 kg difference (must flag as mismatch)
    const res1 = evaluateWeightDiscrepancy(10000, 10051);
    assert.equal(res1.delta, 51);
    assert.equal(res1.isMismatch, true);
    assert.equal(res1.statusVariant, 'mismatch');
    assert.ok(res1.displayText.includes('⚠ مغایرت وزن'));
    assert.ok(res1.displayText.includes('۵۱ کیلوگرم'));

    // Large deficit (15000 invoice vs 14750 scale -> 250 kg shortage)
    const res2 = evaluateWeightDiscrepancy(15000, 14750);
    assert.equal(res2.delta, 250);
    assert.equal(res2.isMismatch, true);
    assert.equal(res2.statusVariant, 'mismatch');
    assert.ok(res2.displayText.includes('۲۵۰ کیلوگرم اختلاف با باسکول'));
  });
});
