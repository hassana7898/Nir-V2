import test from 'node:test';
import assert from 'node:assert/strict';

import { Endpoints } from '../src/api/endpoints';
import { buildPodJsonPayload, buildPodRequest, buildQueuedPodPayload } from '../src/features/driver/podPayload';
import {
  buildQueuedMultipart,
  isQueuedMultipart,
  materializeQueuedPayload,
} from '../src/services/multipartPayload';

/**
 * Phase 1 contract test for the proof-of-delivery upload.
 *
 * Before Phase 1 the app POSTed `{ invoiceId, photoBillUrl, signatureUrl }` to
 * `/api/mobile/driver/proof` - a route the server does not have, with field names the server does
 * not read. The server expects `invoice_id` plus either multipart fields
 * (photo_bill / photo_scale / signature) or base64 fields (*_base64). These tests pin the contract
 * on the client side so the two halves cannot drift apart silently again.
 */
test('Proof-of-delivery payload contract', async (t) => {
  const inlineSignature =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wBHq2v0AAAAAElFTkSuQmCC';

  await t.test('the canonical endpoint is the one the server implements', () => {
    assert.equal(Endpoints.driver.submitProof, '/api/mobile/driver/delivery-receipt');
    assert.equal(Endpoints.driver.legacySubmitProof, '/api/mobile/driver/proof');
    assert.equal(Endpoints.deviceToken, '/api/mobile/device-token');
    assert.equal(Endpoints.manager.orderStatus('12'), '/api/mobile/manager/orders/12');
  });

  await t.test('inline attachments go as JSON with the server field names', () => {
    const payload = buildPodJsonPayload({
      invoiceId: 'inv_1',
      signatureDataUrl: inlineSignature,
      latitude: 35.7,
      longitude: 51.4,
    });

    assert.deepEqual(payload, {
      invoice_id: 'inv_1',
      signature_base64: inlineSignature,
      latitude: '35.7',
      longitude: '51.4',
    });
  });

  await t.test('local photos are uploaded as multipart/form-data', () => {
    const request = buildPodRequest({
      invoiceId: 42,
      photoBillUri: 'file:///data/user/0/ir.artadan.nir/cache/bill.jpg',
      signatureDataUrl: inlineSignature,
    });

    assert.equal(request.endpoint, Endpoints.driver.submitProof);
    assert.equal(request.headers?.['Content-Type'], 'multipart/form-data');
    assert.equal(typeof (request.payload as any).append, 'function');
  });

  await t.test('the offline payload is JSON-safe and rebuilds into multipart', () => {
    const queued = buildQueuedPodPayload({
      invoiceId: 'inv_9',
      photoBillUri: 'file:///mock/bill.jpg',
      photoScaleUri: 'file:///mock/scale.jpg',
      signatureDataUrl: inlineSignature,
      latitude: 35.7,
      longitude: 51.4,
    });

    // What the queue persists in MMKV must survive a JSON round-trip unchanged.
    const roundTripped = JSON.parse(JSON.stringify(queued));
    assert.equal(isQueuedMultipart(roundTripped), true);
    assert.equal(roundTripped.files.photo_bill, 'file:///mock/bill.jpg');
    assert.equal(roundTripped.fields.signature_base64, inlineSignature);

    const materialized = materializeQueuedPayload(roundTripped);
    assert.equal(materialized.headers?.['Content-Type'], 'multipart/form-data');
    assert.equal(materialized.data.get('invoice_id'), 'inv_9');
  });

  await t.test('a fully inline receipt is queued as plain JSON', () => {
    const queued = buildQueuedPodPayload({ invoiceId: 'inv_10', signatureDataUrl: inlineSignature });
    assert.equal(isQueuedMultipart(queued), false);
    const materialized = materializeQueuedPayload(queued);
    assert.equal(materialized.data.invoice_id, 'inv_10');
    assert.equal(materialized.headers, undefined);
  });

  await t.test('plain (non-multipart) queued payloads pass through untouched', () => {
    const payload = { status: 'approved' };
    const materialized = materializeQueuedPayload(payload);
    assert.equal(materialized.data, payload);
  });

  await t.test('the multipart envelope is unmistakable', () => {
    const envelope = buildQueuedMultipart({ invoice_id: '1' }, {});
    assert.equal(envelope.__multipart, true);
    assert.equal(isQueuedMultipart({ invoice_id: '1' }), false);
    assert.equal(isQueuedMultipart(null), false);
  });
});
