import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  apiClient,
  setApiBaseUrl,
  onAuthExpired,
} from '../src/api/client';
import { SecureStorageService } from '../src/services/secureStore';
import {
  enqueueMutation,
  flushOfflineQueue,
  clearOfflineQueue,
  getOfflineQueue,
  getDeadLetters,
  clearDeadLetters,
} from '../src/services/offlineQueue';

test('Smart Network & Offline Queue Integration Tests', async (t) => {
  let refreshCount = 0;
  let protectedEndpointCount = 0;
  let validationErrorCount = 0;
  let currentValidAccessToken = 'valid_token_initial';

  // Spin up an ephemeral HTTP server to test real network responses
  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    const authHeader = req.headers['authorization'] || '';

    // Handle token refresh
    if (url === '/api/mobile/auth/refresh' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');

      if (parsed.refreshToken === 'valid_refresh_token') {
        refreshCount += 1;
        currentValidAccessToken = `rotated_token_${refreshCount}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            accessToken: currentValidAccessToken,
            refreshToken: 'new_valid_refresh_token',
          })
        );
        return;
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Refresh token expired' }));
        return;
      }
    }

    // Protected endpoint requiring Bearer token
    if (url === '/api/test/protected') {
      if (authHeader === `Bearer ${currentValidAccessToken}`) {
        protectedEndpointCount += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', data: 'protected_resource' }));
        return;
      } else {
        // Expired or invalid token -> 401
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token expired' }));
        return;
      }
    }

    // Endpoint for testing 422 permanent validation failure in offline queue
    if (url === '/api/test/validate-fail') {
      validationErrorCount += 1;
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid weight value' }));
      return;
    }

    // Endpoint for normal success
    if (url === '/api/test/success') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
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
    await t.test('401 triggers automatic token refresh and queued request replay', async () => {
      // Setup initial tokens
      await SecureStorageService.setAccessToken('expired_access_token');
      await SecureStorageService.setRefreshToken('valid_refresh_token');

      // Make request with expired access token
      const res = await apiClient.get('/api/test/protected');

      assert.equal(res.status, 200);
      assert.equal(res.data.data, 'protected_resource');
      assert.equal(refreshCount, 1);

      // Verify token in SecureStore was rotated
      const newAccessToken = await SecureStorageService.getAccessToken();
      assert.equal(newAccessToken, currentValidAccessToken);
    });

    await t.test('Invalid refresh token clears session and emits AUTH_EXPIRED', async () => {
      let expiredNotified = false;
      const unsub = onAuthExpired(() => {
        expiredNotified = true;
      });

      // Break refresh token
      await SecureStorageService.setAccessToken('expired_access_token');
      await SecureStorageService.setRefreshToken('corrupt_refresh_token');

      await assert.rejects(async () => {
        await apiClient.get('/api/test/protected');
      });

      assert.equal(expiredNotified, true);
      assert.equal(await SecureStorageService.getAccessToken(), null);
      unsub();
    });

    await t.test('Offline queue processes items and moves 422 to dead letters without blocking', async () => {
      clearOfflineQueue();
      clearDeadLetters();

      // Mutation 1: Will fail with 422
      await enqueueMutation(
        {
          endpoint: '/api/test/validate-fail',
          method: 'POST',
          payload: { invalid: true },
        },
        false
      );

      // Mutation 2: Will succeed with 200
      await enqueueMutation(
        {
          endpoint: '/api/test/success',
          method: 'POST',
          payload: { valid: true },
        },
        false
      );

      assert.equal(getOfflineQueue().length, 2);

      const result = await flushOfflineQueue();
      assert.equal(result.processed, 1);
      assert.equal(result.failed, 1);

      // Verify queue is empty (none blocked)
      assert.equal(getOfflineQueue().length, 0);

      // Verify dead letters contains the 422 failure
      const deadLetters = getDeadLetters();
      assert.equal(deadLetters.length, 1);
      assert.equal(deadLetters[0].statusCode, 422);
      assert.equal(deadLetters[0].mutation.endpoint, '/api/test/validate-fail');
    });
  } finally {
    server.close();
  }
});
