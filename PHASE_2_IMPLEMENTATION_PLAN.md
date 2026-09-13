# NIR V2 — Phase 2 Implementation Plan (Revised)

This document defines the exact boundaries, architecture, and strategies for the Nir-V2 bounded refactor. It explicitly avoids the "rewrite everything" anti-pattern and surgically targets the data-integrity flaws of the reference architecture.

## A. Target Architecture Diagram

```
[ Browser / Factory Client ]
       │
       ├─ UI Components (React, RTL, Persian)  <-- PRESERVED
       │
       ├─ [ IndexedDB Local Cache ] <-- Read-source for UI, augmented with expectedVersion
       │
       ├─ [ IndexedDB Sync Queue ]  <-- Outbox for offline mutations / Dead-letter queue
       │
       └─ [ Client Data Service ]   <-- REFACTORED: Typed Results, Idempotency keys, Explicit States
                   │
                   ▼ (HTTP / JSON / Idempotency Headers / ExpectedVersion)
                   │
[ Node.js Backend API ]             <-- MODULARIZED (Routes, Services, Repositories)
       │
       ├─ [ API Validators (Zod) ]  <-- NEW: Strict payload validation
       │
       ├─ [ Business Services ]     <-- ADAPTED: Atomic transactions, Reversing entries for inventory
       │
       └─ [ Drizzle ORM ]           <-- ADAPTED: version/revision columns, schema drift resolved
                   │
                   ▼
[ PostgreSQL Database ]             <-- AUTHORITATIVE SOURCE OF TRUTH (nir_v2_test / production)
```

## B. Modules / Files Map

| Path / Module | Action | Details |
|---|---|---|
| `server/db/schema.ts` | **ADAPT** | Keep reference schema but resolve schema drift (e.g., legacy invoice columns). Add `version` column for OCC. Add rich `sync_mutations` for idempotency tracking. |
| `server/routes/*` | **ADAPT** | Keep modular routes from reference. Add strict validation. Map errors to standard JSON. |
| `server/services/invoiceService.ts` | **ADAPT** | Keep business logic. Reject hard-deletes of inventory. |
| `server/services/inventoryService.ts` | **ADAPT** | Replace physical deletes with reversing transactions. |
| `server/middleware/auth.ts` | **KEEP** | Standard JWT/session checking. |
| `services/dataService.ts` | **ADAPT** | Rewrite `add/update/delete` to await API, parse explicit errors, and manage IndexedDB safely. |
| `services/dbStore.ts` | **ADAPT** | Rewrite `hydrateFromServer` (merge via `updatedAt`/`version`). Rewrite `triggerSync` (dead-letter queue). |
| `shared/apiContract.ts` | **NEW** | Interfaces for `Result<T>` identifying specific failure reasons. |
| `pages/*.tsx` (UI) | **KEEP** | Preserve current Nir-V2 workflows, RTL, and dashboard. |
| `legacy_scripts/*` (`fix_*.cjs`, etc.) | **CLASSIFY** | Do not blindly delete. Classify as `KEEP`, `ARCHIVE` (move to `/archive`), or `DELETE` based on relevance. |

## C. Database / Schema Migration Plan

1. **Schema Validation & Drift Analysis**: 
   - `invoices`: Model the legacy columns (`status`, `notes`, `created_by`, `updated_by`) that currently exist in PostgreSQL but are missing from Drizzle. 
   - Add `version: integer("version").default(1).notNull()` to `invoices`, `inventory_transactions`, `products`, `farmers`, etc.
   - Refactor `sync_mutations` to include `operationId`, `userId`, `resourceType`, `operationType`, `resourceId`, `requestFingerprint`, `status`, `originalResult`.
2. **Audit Trails**: Ensure `inventory_transactions` uses reversal entries. Physical deletes (`deletedAt` or hard-delete) are prohibited for financial/inventory history.
3. **Safety**: All testing and schema migrations during development MUST target an isolated database (`nir_v2_test`). Production data remains strictly untouched.

## D. API Contract

Mutation routes return a deterministic discriminated union:

```typescript
type ApiResponse<T> = 
  | { success: true; data: T; serverTimestamp: number; operationId: string; version: number }
  | { success: false; error: ApiError };

type ApiError = {
  code: 'VALIDATION_FAILED' | 'AUTH_FAILED' | 'CONFLICT' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'INSUFFICIENT_STOCK' | 'IDEMPOTENCY_KEY_REUSED';
  message: string;
  details?: Record<string, any>;
};
```

## E. Save State Machine

1. **Validate**: Client-side form validation.
2. **Assign Context**: Generate `operationId`, hash payload (fingerprint), and attach `expectedVersion` for updates.
3. **Transmit**: `POST /api/invoices`
4. **Evaluate Result**:
   - `SUCCESS`: Commit to local IndexedDB. Show "ذخیره شد". Update UI.
   - `ERROR (400/403/409/500)`: Show explicit error. Do NOT queue offline. Do NOT save locally as normal.
   - `NETWORK FAILURE`: Save to IndexedDB Queue. Save to IndexedDB Cache as `status: 'pending'`. Show distinct "ذخیره در حالت آفلاین" (Saved Offline). Update UI.

## F. Sync State Machine

Background `triggerSync()` loops over `syncQueue`:
1. **Filter**: Skip any item with `status === 'failed'` (Dead-letter).
2. **Transmit**: Send payload with `operationId`, hash, and `expectedVersion`.
3. **Evaluate Result**:
   - `SUCCESS (200)`: Update cache with server record. Remove from queue.
   - `CONFLICT (409)`: Server version is higher. Remove from queue. Overwrite local cache with authoritative server record.
   - `VALIDATION/IDEMPOTENCY_ERROR (400/409)`: Move to Dead-Letter Queue (`failed`). Do not block remaining queue.
   - `NETWORK ERROR`: Leave in queue. Backoff and retry.

## G. Hydration / Merge Algorithm

1. `hydrateFromServer()` fetches `/api/sync/state`.
2. **Validation Guard**: If response is malformed, abort.
3. **Merge**: 
   - Iterate server records. 
   - Overwrite local if server `version` > local `version`.
   - If local record exists with `status: 'pending'` (in outbox), do NOT overwrite it unless the server explicitly resolves it.
4. **Queue Independence**: Hydration runs even if `syncQueue` > 0. It must never erase valid pending local records.

## H. Conflict-Resolution Strategy (Optimistic Concurrency Control)

Replaces naive Last-Write-Wins (LWW).
1. Every record has a monotonically increasing `version` (integer).
2. Client sends an update mutation containing the `expectedVersion` (what the client currently sees).
3. **Server Logic**:
   - If `client.expectedVersion !== server.version`: Reject with `409 CONFLICT` and return the authoritative server record.
   - If matched: Execute transaction, increment `version` by 1.

## I. Idempotency Strategy

Duplicate `operationId` is NOT automatically successful. We prevent duplicated side-effects if retries occur due to lost responses (Network Timeouts).

1. **Storage**: Atomically with the business transaction, insert into `idempotency_keys`: `operationId`, `userId`, `resourceType`, `operationType`, `resourceId`, `requestFingerprint`, `status`, `originalResult`, `createdAt`.
2. **Server Check**:
   - Same `operationId` + same fingerprint -> Return `originalResult` without re-executing.
   - Same `operationId` + different fingerprint -> Reject with `409 IDEMPOTENCY_KEY_REUSED`.

## J. Dead-Letter Queue Design

Failed sync items due to strict business rejections (e.g., `400 INSUFFICIENT_STOCK` or `409 IDEMPOTENCY_KEY_REUSED`) move to `failed` state.
- They remain in `syncQueue` for audit but are ignored by the active sync loop.
- They never block hydration or unrelated pending mutations.
- The UI exposes a "Failed Syncs" indicator for manual user resolution/dismissal.

## K. Backup / Restore Strategy

- **DB Authority**: `pg_dump` remains the disaster-recovery source.
- **Restore Safety**: `POST /api/backup/restore` operates entirely within one PostgreSQL transaction in exact foreign-key order. If any record fails validation, the entire transaction rolls back cleanly.

## L. Migration Strategy from Nir-V2 LocalStorage

Resumable state machine to transition from LocalStorage to IndexedDB safely.
States: `NOT_STARTED` -> `IMPORTING` -> `IMPORTED` -> `SYNCING` -> `COMPLETED` | `FAILED`.

1. Check for legacy `poultryApp*` keys in LocalStorage. If missing, skip.
2. Mark state as `IMPORTING`. Transcribe data into IndexedDB.
3. Mark state as `IMPORTED`. Identify unsynced operations and push to `syncQueue` (`SYNCING`).
4. **Restart-Safe**: If interrupted, the next boot resumes without duplicating records.
5. Only upon reaching `COMPLETED` is LocalStorage explicitly wiped of legacy business data.

## M. Test Strategy (Test Matrix)

All tests will run on an isolated `nir_v2_test` database.

1. **A. Idempotency**: Same `operationId` + same payload -> exactly ONE business transaction executed, 200 OK returned twice.
2. **B. Idempotency collision**: Same `operationId` + different payload -> `409 IDEMPOTENCY_KEY_REUSED`.
3. **C. Optimistic Concurrency**: First mutation succeeds, second mutation with same `expectedVersion` -> `409 CONFLICT`.
4. **D. Migration Crash Recovery**: Simulate interruption during LocalStorage -> IndexedDB migration. Restart. Verify no loss and no duplicates.
5. **E. Network Timeout Recovery**: Server commits -> response lost -> client retries `operationId` -> verify exactly one invoice and one inventory movement in DB.
6. **F. Hydration Preservation**: Hydration with pending mutations must not erase valid pending local records.
7. **G. Dead-Letter Isolation**: A business rejection (e.g. 400 stock error) moves to dead-letter and does NOT block hydration or other queue items.

## N. Rollback Strategy

Production DB contains no business data. Frontend rollback consists of deploying the previous static build utilizing LocalStorage.

## O. Production Deployment Strategy

1. Run `npm run db:migrate` on Production Postgres.
2. Deploy backend, deploy frontend. 
3. Bump `sw.js` cache version.
