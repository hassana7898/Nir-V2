import express from 'express';
import { requireAuth, requireRole } from './server/middleware/auth.js';

const runTests = async () => {
  let passed = 0;
  let failed = 0;

  const mockReq = (headers = {}): any => ({
    headers,
    secure: false,
    protocol: 'http',
    socket: { remoteAddress: '127.0.0.1' }
  });

  const mockRes = (): any => {
    const res: any = {};
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: any) => { res.body = data; return res; };
    return res;
  };

  console.log('--- Test 1: AI_STUDIO_PREVIEW allows bypass ---');
  process.env.AI_STUDIO_PREVIEW = 'true';
  process.env.NODE_ENV = 'development';
  let nextCalled = false;
  let req1 = mockReq();
  let res1 = mockRes();
  await requireAuth(req1, res1, () => { nextCalled = true; });
  if (nextCalled && req1.user?.id === 'ai_studio_dev_user') {
    console.log('✅ PASS: Test 1');
    passed++;
  } else {
    console.log('❌ FAIL: Test 1', req1.user);
    failed++;
  }

  console.log('--- Test 2: AI_STUDIO_PREVIEW in PRODUCTION still blocks ---');
  process.env.AI_STUDIO_PREVIEW = 'true';
  process.env.NODE_ENV = 'production';
  let nextCalled2 = false;
  let req2 = mockReq();
  let res2 = mockRes();
  await requireAuth(req2, res2, () => { nextCalled2 = true; });
  if (!nextCalled2 && res2.statusCode === 401) {
    console.log('✅ PASS: Test 2');
    passed++;
  } else {
    console.log('❌ FAIL: Test 2 (status:', res2.statusCode, ')');
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
};

runTests().catch(e => { console.error(e); process.exit(1); });
