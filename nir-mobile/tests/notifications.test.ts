import test from 'node:test';
import assert from 'node:assert/strict';
import { registerForPushNotificationsAsync } from '../src/services/notificationService';
import { apiClient } from '../src/api/client';

test('Push Notification Registration Protocol', async (t) => {
  let interceptedPost: { url: string; data: any } | null = null;
  const originalPost = apiClient.post;

  t.beforeEach(() => {
    interceptedPost = null;
  });

  t.afterEach(() => {
    apiClient.post = originalPost;
  });

  await t.test('Successfully captures device push token and dispatches to /mobile/device-token', async () => {
    // Mock apiClient.post
    apiClient.post = (async (url: string, data?: any) => {
      interceptedPost = { url, data };
      return {
        data: { success: true, message: 'توکن نوتیفیکیشن با موفقیت ثبت شد.' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };
    }) as any;

    const res = await registerForPushNotificationsAsync();

    assert.equal(res.success, true);
    assert.ok(res.token, 'Token should be defined');
    assert.ok(interceptedPost, 'Should call apiClient.post');
    assert.equal(interceptedPost!.url, '/api/mobile/device-token');
    assert.equal(interceptedPost!.data.token, res.token);
    assert.ok(['android', 'ios', 'windows', 'web'].includes(interceptedPost!.data.platform));
  });

  await t.test('Handles server rejection gracefully without throwing uncaught exceptions', async () => {
    apiClient.post = (async () => {
      const err: any = new Error('Request failed with status code 500');
      err.response = {
        data: { error: 'دیتابیس در دسترس نیست' },
        status: 500,
      };
      throw err;
    }) as any;

    const res = await registerForPushNotificationsAsync();

    assert.equal(res.success, false);
    assert.equal(res.error, 'دیتابیس در دسترس نیست');
  });
});
