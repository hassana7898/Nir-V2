/**
 * Proof-of-delivery request builder (Phase 1 contract fix).
 *
 * The screen used to POST `{ invoiceId, photoBillUrl, photoScaleUrl, signatureUrl }` to the
 * deprecated driver proof route - a route that does not exist - while the server reads
 * `invoice_id` + `photo_bill` / `photo_scale` / `signature` (multipart) or the matching
 * `*_base64` JSON fields. Result: 404 (hidden by the old mock engine) and a receipt saved without
 * a single image.
 *
 * Rules implemented here:
 *   * inline data: URLs (the signature, and photos that were already converted) -> JSON base64
 *   * local file:// URIs (camera/gallery) -> multipart/form-data
 *   * offline: a JSON-safe envelope (services/multipartPayload.ts) that the queue turns back into
 *     multipart when the connection returns
 */

import { Endpoints } from '../../api/endpoints';
import { buildQueuedMultipart, isQueuedMultipart, type QueuedMultipartPayload } from '../../services/multipartPayload';

export interface PodInput {
  invoiceId: string | number | null | undefined;
  photoBillUri?: string | null;
  photoScaleUri?: string | null;
  signatureDataUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PodRequest {
  endpoint: string;
  payload: any;
  headers?: Record<string, string>;
}

const isInlineDataUrl = (value?: string | null): value is string =>
  !!value && value.startsWith('data:');

const isLocalFile = (value?: string | null): value is string =>
  !!value && !isInlineDataUrl(value);

export const hasLocalFileAttachment = (input: PodInput): boolean =>
  isLocalFile(input.photoBillUri) || isLocalFile(input.photoScaleUri) || isLocalFile(input.signatureDataUrl);

const scalarFields = (input: PodInput): Record<string, string> => {
  const fields: Record<string, string> = {
    invoice_id: input.invoiceId != null ? String(input.invoiceId) : '',
  };
  if (input.photoBillUri && isInlineDataUrl(input.photoBillUri)) fields.photo_bill_base64 = input.photoBillUri;
  if (input.photoScaleUri && isInlineDataUrl(input.photoScaleUri)) fields.photo_scale_base64 = input.photoScaleUri;
  if (input.signatureDataUrl && isInlineDataUrl(input.signatureDataUrl)) fields.signature_base64 = input.signatureDataUrl;
  if (input.latitude != null) fields.latitude = String(input.latitude);
  if (input.longitude != null) fields.longitude = String(input.longitude);
  return fields;
};

const fileFields = (input: PodInput): Record<string, string> => {
  const files: Record<string, string> = {};
  if (isLocalFile(input.photoBillUri)) files.photo_bill = input.photoBillUri;
  if (isLocalFile(input.photoScaleUri)) files.photo_scale = input.photoScaleUri;
  if (isLocalFile(input.signatureDataUrl)) files.signature = input.signatureDataUrl;
  return files;
};

/** JSON body (all attachments inline as base64 `data:` URLs). */
export const buildPodJsonPayload = (input: PodInput): Record<string, string> => scalarFields(input);

/** Multipart body (at least one attachment is a local file). */
export const buildPodFormData = (input: PodInput, FormDataImpl: any = (globalThis as any).FormData): any => {
  const form = new FormDataImpl();
  for (const [key, value] of Object.entries(scalarFields(input))) form.append(key, value);
  for (const [key, uri] of Object.entries(fileFields(input))) {
    form.append(key, { uri, name: `${key}.jpg`, type: 'image/jpeg' } as any);
  }
  return form;
};

/** The request to send right now (online path). */
export const buildPodRequest = (input: PodInput): PodRequest => {
  if (!hasLocalFileAttachment(input)) {
    return { endpoint: Endpoints.driver.submitProof, payload: buildPodJsonPayload(input) };
  }
  return {
    endpoint: Endpoints.driver.submitProof,
    payload: buildPodFormData(input),
    headers: { 'Content-Type': 'multipart/form-data' },
  };
};

/**
 * The JSON-safe payload to persist in the offline queue. When photos are local files the queue
 * keeps their URIs and rebuilds multipart on flush — no silent loss of the delivery evidence.
 */
export const buildQueuedPodPayload = (input: PodInput): Record<string, string> | QueuedMultipartPayload => {
  const files = fileFields(input);
  if (Object.keys(files).length === 0) {
    return buildPodJsonPayload(input);
  }
  return buildQueuedMultipart(scalarFields(input), files);
};

export { isQueuedMultipart };
