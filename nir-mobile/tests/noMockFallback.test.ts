import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import { apiClient, setApiBaseUrl } from '../src/api/client';

/**
 * Phase 1 security guard.
 *
 * The client used to hide every backend problem behind a mock engine: offline mode injected fake
 * payloads, ANY network error was answered with fake data and even HTTP 404 was converted into a
 * 200 with fabricated rows. These tests fail if that behaviour (or the fallback login that came
 * with it) ever returns.
 */

// Works both when run from nir-mobile/ (npm --prefix) and from the repository root.
const mobileRoot = fs.existsSync(path.join(process.cwd(), 'src', 'api', 'client.ts'))
  ? process.cwd()
  : path.join(process.cwd(), 'nir-mobile');

const readSource = (relative: string): string =>
  fs.readFileSync(path.join(mobileRoot, relative), 'utf8');

test('Phase 1: the mobile client fabricates nothing on failure', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/mobile/driver/loads') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  setApiBaseUrl(`http://127.0.0.1:${port}`);

  try {
    await t.test('an unknown route rejects with 404 instead of returning mock data', async () => {
      await assert.rejects(
        () => apiClient.get('/api/mobile/driver/loads'),
        (err: any) => err?.response?.status === 404
      );
    });

    await t.test('an unreachable server rejects with a network error instead of mock data', async () => {
      // Port 1 has no listener: the request must surface as a real failure.
      setApiBaseUrl('http://127.0.0.1:1');
      await assert.rejects(
        () => apiClient.get('/api/mobile/farmer/dashboard'),
        (err: any) => !err?.response
      );
    });
  } finally {
    server.close();
  }

  await t.test('the mock engine module no longer exists', async () => {
    assert.equal(fs.existsSync(path.join(mobileRoot, 'src', 'services', 'mockDataService.ts')), false);
  });

  await t.test('offline demo mode API is gone from the network client', () => {
    const clientSource = readSource(path.join('src', 'api', 'client.ts'));
    assert.equal(clientSource.includes('handleMockRoute'), false);
    assert.equal(clientSource.includes('setOfflineDemoMode'), false);
    assert.equal(clientSource.includes('isOfflineDemo'), false);
  });

  await t.test('the auth context has no offline login, mock users or hardcoded credentials', () => {
    const authSource = readSource(path.join('src', 'contexts', 'AuthContext.tsx'));
    assert.equal(authSource.includes('loginOffline'), false);
    assert.equal(authSource.includes('MOCK_USERS'), false);
    assert.equal(authSource.includes('admin123'), false);
    assert.equal(authSource.includes('offline_token'), false);
  });

  await t.test('the login screen ships no demo credentials and no fake debug code', () => {
    const loginSource = readSource(path.join('src', 'screens', 'auth', 'LoginScreen.tsx'));
    assert.equal(loginSource.includes('admin123'), false);
    // The fabricated "test code" hint and the `debugCode || '123456'` fallback are what must be gone
    // (a bare 123456 still legitimately serves as the TOTP input placeholder).
    assert.equal(loginSource.includes('|| \'123456\''), false);
    assert.equal(loginSource.includes('loginOffline'), false);
    assert.equal(loginSource.includes('handleOfflineQuickLogin'), false);
  });

  await t.test('no screen or service keeps a hardcoded /api/ path (endpoints.ts is authoritative)', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (full.endsWith(path.join('api', 'endpoints.ts'))) continue;
        const source = fs.readFileSync(full, 'utf8');
        if (/['"`]\/api\//.test(source)) offenders.push(path.relative(mobileRoot, full));
      }
    };

    walk(path.join(mobileRoot, 'src'));
    assert.deepEqual(offenders, [], `hardcoded API paths found in: ${offenders.join(', ')}`);
  });
});
