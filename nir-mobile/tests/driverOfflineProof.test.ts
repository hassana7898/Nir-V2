import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  enqueueMutation,
  getOfflineQueue,
  clearOfflineQueue,
  flushOfflineQueue,
  getPendingMutationCount,
} from '../src/services/offlineQueue';
import { setApiBaseUrl } from '../src/api/client';

test('Driver Proof of Delivery Offline Protocol', async (t) => {
  clearOfflineQueue();

  const mockDeliveryProof = {
    invoiceId: 'inv_test_8877',
    photoBillUrl: 'file:///data/user/0/ir.artadan.nir/cache/bill_8877.jpg',
    photoScaleUrl: 'file:///data/user/0/ir.artadan.nir/cache/scale_8877.jpg',
    signatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABLCAYAAAD...',
    latitude: 35.6892,
    longitude: 51.3890,
    deliveredAt: new Date().toISOString(),
  };

  await t.test('Offline POD submission enqueues without throwing blocking error', async () => {
    // Simulate offline state: enqueue directly without auto-flush
    const mutation = await enqueueMutation(
      {
        endpoint: '/api/mobile/driver/proof',
        method: 'POST',
        payload: mockDeliveryProof,
      },
      false
    );

    assert.ok(mutation.id);
    assert.equal(getPendingMutationCount(), 1);

    const queue = getOfflineQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].endpoint, '/api/mobile/driver/proof');
    assert.equal(queue[0].payload.invoiceId, 'inv_test_8877');
    assert.equal(queue[0].payload.latitude, 35.6892);
  });

  await t.test('Reconnection successfully flushes delivery receipt to server', async () => {
    let serverReceivedPayload: any = null;

    // Spin up an ephemeral HTTP server to receive the offline proof
    const server = http.createServer(async (req, res) => {
      if (req.url === '/api/mobile/driver/proof' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        serverReceivedPayload = JSON.parse(body || '{}');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: 999, message: 'Proof registered' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    setApiBaseUrl(`http://127.0.0.1:${address.port}`);

    try {
      assert.equal(getPendingMutationCount(), 1);

      // Device regains network -> triggers flush
      const result = await flushOfflineQueue();

      assert.equal(result.processed, 1);
      assert.equal(result.failed, 0);
      assert.equal(getPendingMutationCount(), 0);

      // Verify server received exact payload
      assert.ok(serverReceivedPayload);
      assert.equal(serverReceivedPayload.invoiceId, 'inv_test_8877');
      assert.equal(serverReceivedPayload.photoBillUrl, mockDeliveryProof.photoBillUrl);
      assert.equal(serverReceivedPayload.signatureUrl, mockDeliveryProof.signatureUrl);
    } finally {
      server.close();
    }
  });
});
