import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiClient,
  setOfflineDemoMode,
  getOfflineDemoMode,
} from '../src/api/client';
import { handleMockRoute, MOCK_USERS } from '../src/services/mockDataService';

test('Offline Demo Mode and Mock Engine Protocol', async (t) => {
  t.beforeEach(() => {
    setOfflineDemoMode(true);
  });

  t.afterEach(() => {
    setOfflineDemoMode(false);
  });

  await t.test('Offline demo mode flag toggles properly', () => {
    setOfflineDemoMode(true);
    assert.equal(getOfflineDemoMode(), true);
    setOfflineDemoMode(false);
    assert.equal(getOfflineDemoMode(), false);
    setOfflineDemoMode(true);
  });

  await t.test('GET /api/mobile/driver/loads returns complete mock payload in offline mode', async () => {
    const res = await apiClient.get('/api/mobile/driver/loads');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.active), 'active loads should be an array');
    assert.ok(Array.isArray(res.data.delivered), 'delivered loads should be an array');
    assert.equal(res.data.active.length >= 1, true);
    assert.equal(res.data.active[0].farmerName, 'مرغداری حاج احمد رضایی');
  });

  await t.test('GET /api/mobile/farmer/dashboard returns mock flock and brood data', async () => {
    const res = await apiClient.get('/api/mobile/farmer/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.data.farmer, 'farmer profile should be present');
    assert.ok(res.data.activeBrood, 'activeBrood should be present');
    assert.equal(res.data.activeBrood.flockCount, 28000);
    assert.equal(res.data.activeBrood.currentAgeDays, 34);
  });

  await t.test('GET /api/mobile/manager/kpi returns live factory tonnage metrics', async () => {
    const res = await apiClient.get('/api/mobile/manager/kpi');
    assert.equal(res.status, 200);
    assert.ok(res.data.todayStats, 'todayStats should be present');
    assert.equal(res.data.todayStats.ticketCount, 24);
    assert.ok(Array.isArray(res.data.warehouses), 'warehouses should be an array');
  });

  await t.test('OTP request in offline mode returns instant 123456 debug code', async () => {
    const res = await apiClient.post('/api/mobile/auth/otp/request', {
      phone: '09121112233',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.debugCode, '123456');
  });

  await t.test('handleMockRoute gracefully returns null for unsupported arbitrary routes', () => {
    const result = handleMockRoute('GET', '/api/unsupported/random/path');
    assert.equal(result, null);
  });
});
