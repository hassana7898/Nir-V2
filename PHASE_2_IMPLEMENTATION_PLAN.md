# NIR V2 — Phase 2 Implementation Plan

This document defines the exact boundaries, architecture, and strategies for the Nir-V2 bounded refactor. It explicitly avoids the "rewrite everything" anti-pattern and surgically targets the data-integrity flaws of the reference architecture.

## A. Target Architecture Diagram

```
[ Browser / Factory Client ]
       │
       ├─ UI Components (React, RTL, Persian)  <-- PRESERVED
       │
       ├─ [ IndexedDB Local Cache ] <-- Read-source for UI
       │
       ├─ [ IndexedDB Sync Queue ]  <-- Outbox for offline mutations / Dead-letter queue
       │
       └─ [ Client Data Service ]   <-- REFACTORED: Typed Results, Idempotency keys, explicit states
                   │
                   ▼ (HTTP / JSON / Idempotency-Key Headers)
                   │
[ Node.js Backend API ]             <-- MODULARIZED (Routes, Services, Repositories)
       │
       ├─ [ API Validators (Zod) ]  <-- NEW: Strict payload validation
       │
       ├─ [ Business Services ]     <-- ADAPTED: Atomic transactions, Reversing entries for inventory
       │
       └─ [ Drizzle ORM ]           <-- PRESERVED: Schema definition
                   │
                   ▼
[ PostgreSQL Database ]             <-- AUTHORITATIVE SOURCE OF TRUTH (nir_v2_test / production)
```

## B. Modules / Files Map

| Path / Module | Action | Details |
|---|---|---|
| `server/db/schema.ts` | **ADAPT** | Keep reference schema. Ensure `updatedAt` is strictly managed. Add `operationId` to sync tables. |
| `server/routes/*` | **ADAPT** | Keep modular routes from reference. Add strict Zod validation. Map errors to standardized JSON responses. |
| `server/services/invoiceService.ts` | **ADAPT** | Keep business logic (stock check, etc.). Reject hard-deletes of inventory. |
| `server/services/inventoryService.ts` | **ADAPT** | Replace `deleteTransactionsByReference` with `insertReversingTransaction`. |
| `server/middleware/auth.ts` | **KEEP** | Standard JWT/session checking. |
| `services/dataService.ts` (Client) | **ADAPT** | Rewrite `addInvoice`, `updateInvoice`, `deleteInvoice` to await the API, parse explicit typed errors, and correctly manage IndexedDB. Reject generic `try/catch`. |
| `services/dbStore.ts` (Client) | **ADAPT** | Rewrite `hydrateFromServer` (merge by `updatedAt`, validate array shapes). Rewrite `triggerSync` (dead-letter queue, 409 conflict handling). |
| `shared/apiContract.ts` | **NEW** | Create strict TypeScript interfaces for `Result<T>` ensuring the UI knows exactly why a call failed. |
| `pages/*.tsx` (UI) | **KEEP** | Preserve current Nir-V2 workflows, RTL, and dashboard. |
| `fix_*.cjs`, `patch_*.cjs` | **DELETE** | Remove legacy script clutter. |
| `window.localStorage` (Business Data) | **REJECT** | Completely removed as a storage medium for invoices, products, etc. |

## C. Database / Schema Migration Plan

1. **Schema Validation**: Deploy the `server/db/schema.ts` to `nir_v2_test`.
2. **Audit Trails**: Ensure `inventory_transactions` uses reversal entries instead of physical deletes.
3. **Idempotency Tracking**: Enhance `sync_mutations` to act as a strict idempotency lock table (`operation_id` UNIQUE).
4. No destructive migration is required for production as the forensic report confirms production is currently devoid of business data (only users/sessions).

## D. API Contract

Every mutation route (POST, PUT, DELETE) will return a discriminated union matching this interface:

```typescript
type ApiResponse<T> = 
  | { success: true; data: T; serverTimestamp: number; operationId: string }
  | { success: false; error: ApiError };

type ApiError = {
  code: 'VALIDATION_FAILED' | 'AUTH_FAILED' | 'CONFLICT' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'INSUFFICIENT_STOCK';
  message: string;
  details?: Record<string, any>;
};
```
*Goal: The client must never collapse a `400 INSUFFICIENT_STOCK` and a `0 NETWORK_TIMEOUT` into the same boolean false.*

## E. Save State Machine

When a user clicks "Save Havaleh":
1. **Validate**: Client-side form validation.
2. **Assign ID**: Generate globally unique `operationId` and `invoiceId`.
3. **Transmit**: `POST /api/invoices`
4. **Evaluate Result**:
   - `SUCCESS (2xx)`: Commit to IndexedDB Cache -> Show "ذخیره شد" -> Update UI.
   - `ERROR (400/403/409/500)`: Show explicit error (e.g., "موجودی کافی نیست"). **Do not queue.** **Do not save locally.**
   - `NETWORK FAILURE (Timeout/Offline)`: Save to IndexedDB Queue. Save to IndexedDB Cache as `status: 'pending'`. Show distinct "ذخیره در حالت آفلاین" (Saved Offline). Update UI.

## F. Sync State Machine

Background `triggerSync()` loops over `syncQueue`:
1. **Filter**: Skip any item with `status === 'failed'` (Dead-letter).
2. **Transmit**: Send payload with `operationId` header.
3. **Evaluate Result**:
   - `SUCCESS (200)`: Remove from queue. Update local cache with authoritative server record (clears `pending` flag).
   - `CONFLICT (409)`: Server is newer. Remove from queue. Overwrite local cache with server record. Notify UI.
   - `VALIDATION (400)`: Move to Dead-Letter Queue (`status = 'failed'`). Do not block next items.
   - `NETWORK ERROR`: Leave in queue. Backoff and retry later.

## G. Hydration / Merge Algorithm

1. `hydrateFromServer()` fetches `/api/sync/state`.
2. **Validation Guard**: If the response is malformed (e.g., missing arrays), abort entirely. (Fixes Bug D6).
3. **Merge, Don't Replace**: 
   - Iterate server records.
   - If server `updatedAt` >= local `updatedAt`, overwrite local.
   - If local record exists with `status: 'pending'` (in outbox), DO NOT overwrite/delete it.
4. **Queue Independence**: Hydration runs even if `syncQueue > 0`.

## H. Conflict-Resolution Strategy

**Last-Write-Wins (LWW) with Server Authority**.
All local cache records hold an `updatedAt` timestamp provided by the server. 
When a client sends an `update`, it includes this `updatedAt`.
If the server's database `updatedAt` is strictly greater than the client's provided `updatedAt`, the server rejects the write with `409 CONFLICT` and returns the newer authoritative record.

## I. Idempotency Strategy

Every UI creation action generates a V4 UUID `operationId`. 
This is sent in the header `X-Operation-Id`.
The server wraps the business transaction and an insert into `sync_mutations(operation_id)`.
If a network timeout occurs and the client retries the exact same `operationId`, the server catches the Unique Constraint violation on `sync_mutations` and safely returns `200 OK` (Duplicate acknowledged), preventing double-billing or double-inventory reduction.

## J. Dead-Letter Queue Design

If a queued offline mutation is ultimately rejected by the server due to business rules (e.g., stock ran out while offline), the sync engine marks it `failed` and records the `lastError`.
- It remains in `syncQueue` but is ignored by the active sync loop.
- The UI surfaces a red indicator in the header: "X عملیات ناموفق".
- The user can click this to view, discard, or manually correct the failed operations.
- Hydration is never blocked by dead letters.

## K. Backup / Restore Strategy

- **DB Authority**: The daily Postgres `pg_dump` is the absolute disaster-recovery source.
- **App Export/Import**: `GET /api/backup/export` generates a JSON snapshot.
- **Restore Safety**: `POST /api/backup/restore` operates entirely within a single PostgreSQL `tx`. 
  - It inserts in strict Foreign-Key order (Categories -> Products -> Farmers -> Invoices).
  - If a single record fails validation or FK checks, `tx.rollback()` is invoked automatically. The DB remains completely untouched.

## L. Migration Strategy from Nir-V2 localStorage

On first boot of the new version:
1. Check for `localStorage.getItem('poultryAppInvoices')`.
2. If found, translate all business data into IndexedDB.
3. Queue any un-synced data into `syncQueue` with `operationId`s.
4. Call `localStorage.removeItem(...)` to ensure this only runs once.

## M. Test Strategy

Isolated testing on `nir_v2_test`:
1. **Auth**: Session creation, rejection, and invalid credentials.
2. **Idempotency**: Fire two identical POST requests concurrently -> assert exactly 1 invoice and 1 inventory movement created.
3. **Rollback**: Delete an invoice -> assert inventory reversing transaction is generated correctly (no hard deletes).
4. **Sync Conflict**: Attempt to update an invoice using an old `updatedAt` timestamp -> assert 409 Conflict.
5. **Full Lifecycle (End-to-End)**: 
   - Create Havaleh (Online) -> Verify Postgres.
   - Create Havaleh (Offline) -> Verify Local Pending state.
   - Go Online -> Sync -> Verify Postgres -> Verify UI Pending state removed.
   - Backup -> Restore on blank DB -> Verify exact counts and relationships.

## N. Rollback Strategy

Since the production PostgreSQL DB contains no business data currently, rollback consists purely of redeploying the previous Nir-V2 frontend static build, which natively falls back to `localStorage`.

## O. Production Deployment Strategy

1. Execute Drizzle migrations `npm run db:migrate` on Production Postgres.
2. Deploy the Express Backend.
3. Deploy the Vite Frontend.
4. Ensure `sw.js` cache version is bumped to force immediate client invalidation of old frontend assets.
