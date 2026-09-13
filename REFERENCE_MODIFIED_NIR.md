# NIR V2 — Modified/Existing NIR Reference

## PRIMARY PROJECT
`hassana7898/Nir-V2`

This repository is the ONLY working project. All new development, refactoring and fixes must happen here.

## REFERENCE PROJECT
`hassana7898/nir` — branch `main`

Reference repository:
https://github.com/hassana7898/nir

The reference repository is the later modified/buggy implementation. It must NOT be blindly merged or treated as authoritative.

## HOW TO USE THE REFERENCE

Use the reference repository to compare the original/desired application behavior against later modifications.

For each difference:

- KEEP = correct feature/behavior that should be preserved.
- ADAPT = useful feature/idea whose implementation must be redesigned or fixed before adoption.
- REJECT = bug, regression, unsafe persistence behavior, unnecessary complexity, or anything that can cause data loss.

The objective is NOT to make Nir-V2 identical to `nir`.
The objective is to create a stable NIR V2 that preserves the correct business behavior and useful functionality while recovering only validated improvements from the modified version.

## CRITICAL AREAS TO COMPARE

1. Authentication and session handling
2. حواله creation/update/delete
3. Invoice persistence
4. Inventory mutations
5. Database transactions
6. Backup/export/import
7. Restoration of حواله records
8. IndexedDB/localStorage
9. Service Worker/cache
10. Offline queue
11. Synchronization
12. Duplicate mutation prevention/idempotency
13. API errors and timeout handling
14. UI state after save
15. State after refresh/browser restart
16. Data consistency between client and server

## SOURCE FILE MAP — MODIFIED REFERENCE

The reference repository is public and its complete source tree is available at:
https://github.com/hassana7898/nir/tree/main

Important source files include:

- App.tsx
- server.ts
- types.ts
- package.json
- index.tsx
- index.css
- contexts/AuthContext.tsx
- contexts/SettingsContext.tsx
- services/authService.ts
- services/dataService.ts
- services/dbStore.ts
- services/offlineAuth.ts
- services/pwa.ts
- components/MainLayout.tsx
- components/Sidebar.tsx
- components/DataImportModal.tsx
- components/ImageImportModal.tsx
- pages/LoginPage.tsx
- pages/EntryPage.tsx
- pages/ExitPage.tsx
- pages/InventoryPage.tsx
- pages/InventoryAnalysisPage.tsx
- pages/SettingsPage.tsx
- pages/ReportsPage.tsx
- pages/FarmersPage.tsx
- pages/ProductionPage.tsx
- server/db/index.ts
- server/db/schema.ts
- server/db/migrate.ts
- server/db/seed.ts
- server/middleware/auth.ts
- server/middleware/rateLimit.ts
- server/routes/auth.ts
- server/routes/invoices.ts
- server/routes/inventory.ts
- server/routes/sync.ts
- server/routes/backup.ts
- server/services/invoiceService.ts
- server/services/inventoryService.ts
- server/services/backup.ts
- server/repositories/invoiceRepository.ts
- server/repositories/inventoryRepository.ts
- tests/api.test.ts
- tests/auth.test.ts
- tests/authclient.test.ts
- tests/sync.test.ts

## IMPORTANT

AI Studio should inspect the public reference repository when needed. Do not invent missing code.

Do not copy `node_modules`, generated `dist` output, secrets, runtime binaries, production data, or deployment artifacts into the working source unless explicitly required.

Do not modify the reference repository as part of this work.

Do not modify production NIR/VPS data while developing NIR V2.

## KNOWN REFERENCE IMPLEMENTATION DETAIL

The modified reference currently contains both a server-authoritative PostgreSQL path and a client IndexedDB/offline synchronization path. Its bootstrap and synchronization behavior must therefore be audited carefully before any of it is adopted.

In particular, inspect the ordering and interaction of:

`initDataStore()`
→ `triggerSync()`
→ `hydrateFromServer()`

and inspect every caller of `setStoreItem()`, `enqueueSync()`, `triggerSync()` and `hydrateFromServer()`.

Do not assume this sequence is correct merely because it exists.

## FINAL RULE

NIR V2 is the destination.
`hassana7898/nir` is evidence/reference only.

Analyze → compare → decide → implement → test.
Never blindly merge.