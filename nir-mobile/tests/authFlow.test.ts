import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { apiClient, setApiBaseUrl } from '../src/api/client';
import { SecureStorageService } from '../src/services/secureStore';

test('Mobile Auth API Flow Unit Tests', async (t) => {
  // Spin up an ephemeral HTTP server mimicking the backend mobile endpoints
  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');

    if (url === '/api/mobile/auth/otp/request') {
      if (parsed.phone === '09121112233') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, expiresIn: 120, debugCode: '123456' }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid phone' }));
      }
      return;
    }

    if (url === '/api/mobile/auth/otp/verify') {
      if (parsed.phone === '09121112233' && parsed.code === '123456') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            user: {
              id: 'drv_test_1',
              username: '09121112233',
              role: 'DRIVER',
              driverId: 'drv_id_1',
              fullName: 'رضا راننده',
            },
            accessToken: 'drv_acc_token',
            refreshToken: 'drv_ref_token',
          })
        );
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid OTP code' }));
      }
      return;
    }

    if (url === '/api/mobile/auth/login') {
      if (parsed.username === 'admin' && parsed.password === 'pass123') {
        if (!parsed.totpCode) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, requires2FA: true }));
        } else if (parsed.totpCode === '654321') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              user: {
                id: 'adm_1',
                username: 'admin',
                role: 'ADMIN',
                fullName: 'مدیر ارشد سامانه',
              },
              accessToken: 'adm_acc_token',
              refreshToken: 'adm_ref_token',
            })
          );
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid TOTP code' }));
        }
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  setApiBaseUrl(baseUrl);

  try {
    await t.test('OTP request and verification flow', async () => {
      // 1. Request OTP
      const reqRes = await apiClient.post('/api/mobile/auth/otp/request', {
        phone: '09121112233',
      });
      assert.equal(reqRes.data.success, true);
      assert.equal(reqRes.data.debugCode, '123456');

      // 2. Verify OTP
      const verRes = await apiClient.post('/api/mobile/auth/otp/verify', {
        phone: '09121112233',
        code: '123456',
      });
      assert.equal(verRes.data.success, true);
      assert.equal(verRes.data.user.role, 'DRIVER');
      assert.equal(verRes.data.accessToken, 'drv_acc_token');

      // 3. Store tokens
      await SecureStorageService.setAccessToken(verRes.data.accessToken);
      await SecureStorageService.setRefreshToken(verRes.data.refreshToken);
      await SecureStorageService.setUserData(verRes.data.user);

      assert.equal(await SecureStorageService.getAccessToken(), 'drv_acc_token');
      const u = await SecureStorageService.getUserData();
      assert.equal(u?.role, 'DRIVER');
    });

    await t.test('Manager login flow with 2FA requirement', async () => {
      // 1. First step: login without TOTP -> triggers 2FA requirement
      const firstStep = await apiClient.post('/api/mobile/auth/login', {
        username: 'admin',
        password: 'pass123',
      });
      assert.equal(firstStep.data.requires2FA, true);

      // 2. Second step: provide TOTP code -> succeeds
      const secondStep = await apiClient.post('/api/mobile/auth/login', {
        username: 'admin',
        password: 'pass123',
        totpCode: '654321',
      });
      assert.equal(secondStep.data.success, true);
      assert.equal(secondStep.data.user.role, 'ADMIN');
      assert.equal(secondStep.data.accessToken, 'adm_acc_token');
    });
  } finally {
    server.close();
  }
});
