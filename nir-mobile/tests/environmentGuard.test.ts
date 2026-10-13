import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTADAN_HOSTS,
  detectTargetEnvironment,
  evaluateBaseUrl,
  hostOf,
  resolveAppVariant,
  variantLabel,
} from '../src/utils/envGuard';

/**
 * Phase 1 environment guard.
 *
 * A dev APK (ir.artadan.nir.dev) must never be able to point itself at the production server and
 * vice versa - that mistake is one typo away in the "server settings" screen, and the consequence
 * is test data landing in the operational database.
 */
test('Environment guard: a build cannot talk to the other artadan environment', async (t) => {
  await t.test('host extraction tolerates missing schemes, ports and credentials', () => {
    assert.equal(hostOf('https://dev.artadan.ir'), 'dev.artadan.ir');
    assert.equal(hostOf('dev.artadan.ir:3001'), 'dev.artadan.ir');
    assert.equal(hostOf('http://185.10.10.10:3000/api'), '185.10.10.10');
    assert.equal(hostOf(''), '');
  });

  await t.test('target environment detection', () => {
    assert.equal(detectTargetEnvironment('https://dev.artadan.ir'), 'dev');
    assert.equal(detectTargetEnvironment('https://api.dev.artadan.ir'), 'dev');
    assert.equal(detectTargetEnvironment('https://app.artadan.ir'), 'production');
    assert.equal(detectTargetEnvironment('http://192.168.1.50:3001'), 'other');
    assert.equal(detectTargetEnvironment('http://localhost:3001'), 'other');
  });

  await t.test('the build variant is derived from the API URL baked into the bundle', () => {
    assert.equal(resolveAppVariant('https://dev.artadan.ir'), 'dev');
    assert.equal(resolveAppVariant('https://app.artadan.ir'), 'production');
    assert.equal(variantLabel('dev'), 'نسخه آزمایشی (Dev)');
  });

  await t.test('a dev build may use its own environment, LAN and custom VPS addresses', () => {
    assert.equal(evaluateBaseUrl('dev', ARTADAN_HOSTS.dev, 'https://dev.artadan.ir').allowed, true);
    assert.equal(evaluateBaseUrl('dev', 'http://192.168.1.50:3001', 'https://dev.artadan.ir').allowed, true);
    assert.equal(evaluateBaseUrl('dev', 'http://185.10.10.10:3000', 'https://dev.artadan.ir').allowed, true);
  });

  await t.test('a dev build is refused when aimed at production (and falls back to dev)', () => {
    const decision = evaluateBaseUrl('dev', 'https://app.artadan.ir', 'https://dev.artadan.ir');
    assert.equal(decision.allowed, false);
    assert.equal(decision.url, 'https://dev.artadan.ir');
    assert.ok(decision.reason && decision.reason.length > 0);
  });

  await t.test('a production build is refused when aimed at the dev server', () => {
    const decision = evaluateBaseUrl('production', 'https://dev.artadan.ir', 'https://app.artadan.ir');
    assert.equal(decision.allowed, false);
    assert.equal(decision.url, 'https://app.artadan.ir');
  });

  await t.test('a production build keeps working against its own environment', () => {
    assert.equal(evaluateBaseUrl('production', 'https://app.artadan.ir', 'https://app.artadan.ir').allowed, true);
  });
});
