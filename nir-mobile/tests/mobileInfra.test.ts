import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

// 1. Test Jalali helpers
import {
  toJalali,
  toGregorian,
  dayDistance,
  jalaliText,
  plateKey,
} from '../src/utils/jalali';

// 2. Test Persian Text helpers
import {
  toAsciiDigits,
  normalizePersianText,
  farmerNameKey,
  isSameFarmerName,
  isValidIranianMobile,
  parsePlate,
  isValidPlate,
} from '../src/utils/persianText';

// 3. Test Formatters
import {
  toPersianDigits,
  formatWeight,
  formatCurrency,
  formatJalaliDate,
} from '../src/utils/formatters';

// 4. Test SecureStore
import { SecureStorageService } from '../src/services/secureStore';

// 5. Test Offline Queue
import {
  enqueueMutation,
  getOfflineQueue,
  clearOfflineQueue,
  getPendingMutationCount,
  flushOfflineQueue,
  getDeadLetters,
  clearDeadLetters,
} from '../src/services/offlineQueue';

// 6. Test Client & Auth Expired
import {
  apiClient,
  onAuthExpired,
  notifyAuthExpired,
} from '../src/api/client';
import { Endpoints } from '../src/api/endpoints';

test('Mobile Core Infrastructure Test Suite', async (t) => {
  await t.test('Jalali conversion and date distance', () => {
    // 2026-03-21 -> Farvardin 1, 1405
    const j = toJalali(2026, 3, 21);
    assert.equal(j.jy, 1405);
    assert.equal(j.jm, 1);
    assert.equal(j.jd, 1);

    const g = toGregorian(1405, 1, 1);
    assert.equal(g.gy, 2026);
    assert.equal(g.gm, 3);
    assert.equal(g.gd, 21);

    const formatted = jalaliText(new Date('2026-03-21T12:00:00Z'));
    assert.equal(formatted, '1405/01/01');

    const dist = dayDistance('1405/01/01', '1405/01/10');
    assert.equal(dist, 9);

    const pKey = plateKey('۲۲ ب ۳۴۵ ایران ۱۱');
    assert.equal(pKey, '22ب345ایران11');
  });

  await t.test('Persian text normalization and plate parsing', () => {
    // Arabic yeh and kaf converted
    const normalized = normalizePersianText('كشتارگاه مرغداري يزد');
    assert.equal(normalized, 'کشتارگاه مرغداری یزد');

    // Numbers converted to ASCII
    assert.equal(toAsciiDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');

    // Same farmer identity matching
    assert.ok(isSameFarmerName('علی رضایی', 'علي  رضايي'));
    assert.ok(isSameFarmerName('مرغداری البرز', 'مرغداري  البرز'));

    // Mobile number validation
    assert.ok(isValidIranianMobile('09123456789'));
    assert.ok(isValidIranianMobile('۰۹۱۲۳۴۵۶۷۸۹'));
    assert.equal(isValidIranianMobile('0912345'), false);
    assert.equal(isValidIranianMobile('12345678901'), false);

    // Plate parser
    assert.ok(isValidPlate('22ب345ایران11'));
    assert.ok(isValidPlate('۲۲ ب ۳۴۵ ۱۱'));
    const parsed = parsePlate('22ب345ایران11');
    assert.ok(parsed);
    assert.equal(parsed?.part1, '22');
    assert.equal(parsed?.letter, 'ب');
    assert.equal(parsed?.part2, '345');
    assert.equal(parsed?.series, '11');
  });

  await t.test('Formatters for weight, currency, and digits', () => {
    assert.equal(toPersianDigits('12345'), '۱۲۳۴۵');
    assert.equal(formatWeight(12450, true, true), '۱۲,۴۵۰ کیلوگرم');
    assert.equal(formatWeight(12450, true, false), '12,450 کیلوگرم');
    assert.equal(formatCurrency(1500000, 'ریال', true), '۱,۵۰۰,۰۰۰ ریال');
    assert.equal(formatCurrency(1500000, 'تومان', false), '1,500,000 تومان');
  });

  await t.test('SecureStorage service reads and writes credentials', async () => {
    await SecureStorageService.clearAuthSession();

    await SecureStorageService.setAccessToken('mock_access_token_123');
    await SecureStorageService.setRefreshToken('mock_refresh_token_456');
    await SecureStorageService.setUserData({
      id: 'usr_test_1',
      username: 'driver_test',
      role: 'DRIVER',
      phone: '09129998877',
    });

    const accessToken = await SecureStorageService.getAccessToken();
    const refreshToken = await SecureStorageService.getRefreshToken();
    const user = await SecureStorageService.getUserData();

    assert.equal(accessToken, 'mock_access_token_123');
    assert.equal(refreshToken, 'mock_refresh_token_456');
    assert.equal(user?.id, 'usr_test_1');
    assert.equal(user?.role, 'DRIVER');

    await SecureStorageService.clearAuthSession();
    assert.equal(await SecureStorageService.getAccessToken(), null);
    assert.equal(await SecureStorageService.getRefreshToken(), null);
    assert.equal(await SecureStorageService.getUserData(), null);
  });

  await t.test('Offline queue enqueuing and management', async () => {
    clearOfflineQueue();
    clearDeadLetters();
    assert.equal(getPendingMutationCount(), 0);

    const m1 = await enqueueMutation({
      endpoint: Endpoints.driver.submitProof,
      method: 'POST',
      payload: { invoice_id: 'inv_1', signature_base64: 'data:image/png;base64,abc' },
    });

    const m2 = await enqueueMutation({
      endpoint: Endpoints.farmer.orders,
      method: 'POST',
      payload: { productId: 'prd_1', requestedWeight: 5000 },
    });

    assert.equal(getPendingMutationCount(), 2);
    const queue = getOfflineQueue();
    assert.equal(queue[0].id, m1.id);
    assert.equal(queue[1].id, m2.id);

    clearOfflineQueue();
    assert.equal(getPendingMutationCount(), 0);
  });

  await t.test('Auth expired event listener', () => {
    let fired = false;
    const unsub = onAuthExpired(() => {
      fired = true;
    });

    notifyAuthExpired();
    assert.equal(fired, true);

    fired = false;
    unsub();
    notifyAuthExpired();
    assert.equal(fired, false);
  });
});
