/**
 * JSON-safe multipart envelope for the offline queue.
 *
 * Why this exists: the queue persists payloads as JSON in MMKV, but a proof-of-delivery carries
 * photos that live as local `file://` URIs and can only be uploaded as `multipart/form-data`.
 * JSON.stringify(FormData) is unusable, and dropping the images silently would lose the evidence.
 *
 * A queued payload therefore stores two plain maps — scalar `fields` and `files` (field -> local
 * URI) — and is turned into a real FormData at transmission time (offline queue flush).
 */

export const MULTIPART_MARKER = '__multipart';

export interface QueuedMultipartPayload {
  __multipart: true;
  /** Scalar form fields (invoice id, coordinates, inline base64 values…). */
  fields: Record<string, string>;
  /** File fields: form field name -> local file URI. */
  files: Record<string, string>;
}

export interface MaterializedPayload {
  data: any;
  headers?: Record<string, string>;
}

export const buildQueuedMultipart = (
  fields: Record<string, string>,
  files: Record<string, string>
): QueuedMultipartPayload => ({ [MULTIPART_MARKER]: true, fields, files } as QueuedMultipartPayload);

export const isQueuedMultipart = (payload: unknown): payload is QueuedMultipartPayload => {
  const p = payload as QueuedMultipartPayload | null;
  return !!p && typeof p === 'object' && p[MULTIPART_MARKER] === true && typeof p.fields === 'object';
};

const imageMimeFromUri = (uri: string): string => {
  const ext = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
};

const fileNameFor = (field: string, uri: string): string => {
  const raw = uri.split('?')[0].split('/').pop() || `${field}.jpg`;
  return raw.includes('.') ? raw : `${field}.jpg`;
};

/**
 * Convert a queued payload into the request body to send: a plain object goes through untouched,
 * a queued multipart envelope is rebuilt with the provided FormData implementation (React Native's
 * global FormData in the app, injectable for tests).
 */
export const materializeQueuedPayload = (
  payload: unknown,
  FormDataImpl: any = (globalThis as any).FormData
): MaterializedPayload => {
  if (!isQueuedMultipart(payload)) {
    return { data: payload };
  }

  if (typeof FormDataImpl !== 'function') {
    // No FormData available (exotic runtime): send the scalar fields so the receipt is still
    // recorded server-side instead of failing the whole flush.
    return { data: { ...payload.fields }, headers: { 'Content-Type': 'application/json' } };
  }

  const form = new FormDataImpl();
  for (const [key, value] of Object.entries(payload.fields)) {
    form.append(key, value);
  }
  for (const [key, uri] of Object.entries(payload.files)) {
    form.append(key, { uri, name: fileNameFor(key, uri), type: imageMimeFromUri(uri) } as any);
  }

  return { data: form, headers: { 'Content-Type': 'multipart/form-data' } };
};
