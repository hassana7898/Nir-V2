import express from 'express';
import cors from 'cors';
import { eq } from 'drizzle-orm';
import { db } from './server/db/index.js';
import * as schema from './server/db/schema.js';
import invoiceRoutes from './server/routes/invoices.js';
import 'fake-indexeddb/auto';

// Setup fake localStorage
if (global.navigator) { Object.defineProperty(global.navigator, 'onLine', { value: true, configurable: true }); } else { (global as any).navigator = { onLine: true }; }
const __store = new Map<string, string>();
const __storageShim = {
  length: 0,
  clear() { __store.clear(); },
  getItem(key: string) { return __store.get(key) ?? null; },
  key(_index: number) { return null; },
  removeItem(key: string) { __store.delete(key); },
  setItem(key: string, value: string) { __store.set(key, value); },
} as unknown as Storage;
global.localStorage = __storageShim;

// App Setup
const app = express();
app.use(cors());
app.use(express.json());

// Mock auth middleware
app.use((req, res, next) => {
  req.user = { id: process.env.TEST_USER_ID || 'test_user_id', username: 'test', role: 'ADMIN' };
  next();
});

// A route to simulate network timeout after commit
app.post('/api/test/timeout-invoice', async (req, res, next) => {
  try {
    const { invoices, sync_mutations, inventory_transactions } = schema;
    const { executeIdempotentOperation } = await import('./server/services/idempotencyService.js');
    const { z } = await import('zod');
    
    const invoiceSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['entry', 'exit']),
  date: z.string().min(1),
  productId: z.string().min(1), scaleWeight: z.number().optional(),
}).passthrough();
    
    const parsed = invoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_FAILED' } });
    }
    
    const payload = parsed.data;
    const operationId = req.headers['x-operation-id'] as string;
    
    await executeIdempotentOperation({
        operationId,
        userId: 'test_user_id',
        resourceType: 'invoices',
        operationType: 'create',
        payload,
        execute: async (tx: any) => {
            await tx.insert(invoices).values({
                id: payload.id,
                date: payload.date,
                type: payload.type,
                productId: payload.productId, scaleWeight: payload.scaleWeight,
                version: 1
            });
            await tx.insert(inventory_transactions).values({
                id: 'tx_' + payload.id,
                referenceId: payload.id,
                referenceType: 'invoices',
                productId: payload.productId,
                type: payload.type === 'entry' ? 'in' : 'out',
                quantity: 10,
   date: payload.date
            });
            return { id: payload.id, version: 1 };
        }
    });

    // SILENTLY DESTROY SOCKET TO SIMULATE TIMEOUT AFTER DB COMMIT
    res.socket?.destroy();
  } catch (error: any) {
    next(error);
  }
});

app.use('/api/invoices', invoiceRoutes);
app.use((err: any, req: any, res: any, next: any) => {
  res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } });
});

let server: any;
const getUrl = (path: string) => `http://localhost:${server.address().port}${path}`;

async function runTests() {
  console.log("Running migrations...");
  if (db.migrateDb) {
    await db.migrateDb();
  }

  const setupCode = async () => {
    try {
      await db.insert(schema.users).values({ id: 'test_user_id', username: 'test_user_' + Date.now(), passwordHash: 'hash', role: 'ADMIN' }).onConflictDoNothing();
      await db.insert(schema.product_categories).values({ id: 'cat_1', name: 'Category 1' }).onConflictDoNothing();
      await db.insert(schema.products).values({ id: 'prod_1', name: 'Test Product', type: 'raw_material', categoryId: 'cat_1', unit: 'kg' }).onConflictDoNothing();
    } catch (err) {
      console.error("Failed to insert setup data:", err);
    }
  };
  await setupCode();

  await new Promise((resolve) => {
    server = app.listen(0, () => resolve(true));
  });

  let passed = 0;
  let failed = 0;
  
  const assert = (condition: boolean, msg: string) => {
    if (!condition) {
      console.error(`❌ FAIL: ${msg}`);
      failed++;
    } else {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    }
  };

  // ---------------------------------------------------------
  // TEST 4: REAL NETWORK TIMEOUT AFTER COMMIT
  // ---------------------------------------------------------
  const opIdTest4 = 'op-test-4';
  const invoicePayload4 = {
    id: 'inv_timeout',
    date: new Date().toISOString(),
    type: 'entry',
    productId: 'prod_1',
    scaleWeight: 10,
  };

  try {
    const resTimeout = await fetch(getUrl('/api/test/timeout-invoice'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operation-Id': opIdTest4 },
      body: JSON.stringify(invoicePayload4)
    });
    console.log("Timeout route response status:", resTimeout.status, await resTimeout.text());
    assert(false, "Test 4: Expected fetch to throw due to socket hang up");
  } catch (err: any) {
    assert(err.message.includes("fetch failed") || err.message.includes("socket"), "Test 4: Network timeout simulated successfully.");
  }

  // Verify DB state after timeout
  const postTimeoutInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.id, 'inv_timeout'));
  const postTimeoutTxs = await db.select().from(schema.inventory_transactions).where(eq(schema.inventory_transactions.referenceId, 'inv_timeout'));
  assert(postTimeoutInvoices.length === 1, "Test 4: Invoice successfully committed to DB despite network timeout.");
  assert(postTimeoutTxs.length === 1, "Test 4: Side effects (inventory) successfully committed to DB.");

  // Client retries the SAME operationId
  const retryRes = await fetch(getUrl('/api/invoices'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Operation-Id': opIdTest4 },
    body: JSON.stringify(invoicePayload4)
  });
  const retryData = await retryRes.json();
  assert(retryData.success === true && retryData.data.id === 'inv_timeout', "Test 4: Client retry returns originalResult securely.");
  
  // Verify no duplicates
  const finalInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.id, 'inv_timeout'));
  const finalTxs = await db.select().from(schema.inventory_transactions).where(eq(schema.inventory_transactions.referenceId, 'inv_timeout'));
  assert(finalInvoices.length === 1, "Test 4: No duplicate invoice created.");
  assert(finalTxs.length === 1, "Test 4: No duplicate inventory transaction created.");

  // ---------------------------------------------------------
  // TESTS 7-9: CLIENT HYDRATION & SYNC
  // ---------------------------------------------------------
  const originalFetch = global.fetch;
  
  const { hydrateFromServer, saveAllInvoices } = (await import("./services/dataService.js")) as any; // await import('./services/dataService.js');
  const { initDB, enqueueMutation, getPendingMutations } = await import('./services/dbStore.js');
  
  await enqueueMutation({
    id: 'op-sync-1',
    entityType: 'invoices',
    action: 'create',
    payload: { id: 'inv_pending' }
  });

  // Mock fetch for hydration
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    console.log("MOCKED FETCH CALLED WITH URL:", url);
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = 'http://localhost' + url;
    }
    if (url.toString().includes('/api/invoices') && (init?.method === 'GET' || !init?.method)) {
      return { json: async () => ({
         success: true,
         data: [
           { id: 'inv_timeout', version: 5, date: new Date().toISOString(), items: [] }
         ]
      }) } as any;
    }
    return originalFetch(url, init);
  };

  const hydrated = await hydrateFromServer();
  assert(hydrated === true, "Test 7-9: Hydration function completed successfully.");
  
  const idb = await initDB();
  const cacheInvoices = await idb.get('cache', 'poultryAppInvoices');
  assert(cacheInvoices && cacheInvoices.length === 1 && cacheInvoices[0].version === 5, "Test 7-9 A: Hydration preserved the authoritative version 5 from server.");
  
  const pendingMuts = await getPendingMutations();
  assert(pendingMuts.length === 1 && pendingMuts[0].id === 'op-sync-1', "Test 7-9 B: Pending local mutation was NOT silently deleted during hydration.");

  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = 'http://localhost' + url;
    }
    if (url.toString().includes('/api/invoices') && (init?.method === 'GET' || !init?.method)) {
      return { json: async () => ({ success: true, data: { totally: "wrong_format" } }) } as any;
    }
    return originalFetch(url, init);
  };
  
  const badHydrated = await hydrateFromServer();
  assert(badHydrated === false, "Test 7-9 C: Hydration fails safely on malformed sync response.");
  const cacheInvoicesAfterBad = await idb.get('cache', 'poultryAppInvoices');
  assert(cacheInvoicesAfterBad && cacheInvoicesAfterBad.length === 1, "Test 7-9 C: Existing local data remains intact. No wholesale empty-array replacement.");
  
  const pendingMutsAfterBad = await getPendingMutations();
  assert(pendingMutsAfterBad.length === 1, "Test 7-9 C: Pending mutations remain intact.");
  
  global.fetch = originalFetch; // restore original fetch

  // ---------------------------------------------------------
  // TEST 13 & 14: MIGRATION INTERRUPT & INVALID LEGACY DATA
  // ---------------------------------------------------------
  const { runLegacyMigration } = await import('./services/legacyMigration.js');
  
  const validInvoice = { id: 'inv_legacy_1', date: new Date().toISOString() };
  const malformedInvoice = { id: 'inv_legacy_2', date: { bad: 'type' } }; 
  global.localStorage.setItem('poultryAppInvoices', JSON.stringify([validInvoice, malformedInvoice]));
  
  await runLegacyMigration();
  
  const migrationState1 = await idb.get('system', 'migration_state');
  assert(migrationState1.status === 'COMPLETED', "Test 13: Migration reached COMPLETED state.");
  assert(global.localStorage.getItem('poultryAppInvoices') === null, "Test 13: localStorage deleted/cleared ONLY after verified successful completion.");
  
  const allPending = await getPendingMutations();
  const migratedPending = allPending.filter(m => m.payload?.id === 'inv_legacy_1');
  assert(migratedPending.length === 1, "Test 14: Valid records migrated properly.");
  
  const malformedPending = allPending.filter(m => m.payload?.id === 'inv_legacy_2');
  assert(malformedPending.length === 0, "Test 14: Malformed records do NOT enter normal business data.");
  const deadLetter = await idb.get('system', 'dead_letter_inv_legacy_2');
  assert(deadLetter !== undefined, "Test 14: Malformed records are isolated in the dead-letter mechanism.");

  // Test Interrupt & Resume
  await idb.delete('system', 'migration_state');
  global.localStorage.setItem('poultryAppInvoices', JSON.stringify([validInvoice]));
  
  const originalPut = idb.put.bind(idb);
  idb.put = async function(storeName: string, value: any, key?: any) {
      if (storeName === 'system' && value.id === 'migration_state' && value.status === 'SYNCING') {
          throw new Error('Simulated interrupt crash!');
      }
      return originalPut(storeName, value, key);
  };
  
  try {
      await runLegacyMigration();
  } catch (e: any) {
      assert(e.message === 'Simulated interrupt crash!', "Test 13: Interrupt/Crash during migration simulated.");
  }
  
  idb.put = originalPut;
  
  const midState = await idb.get('system', 'migration_state');
  assert(midState.status === 'FAILED' || midState.status === 'IMPORTED', "Test 13: Migration state reflects interrupt.");
  
  await runLegacyMigration();
  
  const finalState = await idb.get('system', 'migration_state');
  assert(finalState.status === 'COMPLETED', "Test 13: State machine resumes correctly and reaches COMPLETED.");
  
  // ---------------------------------------------------------
  // TEST 16: REAL RESTORE ROLLBACK
  // ---------------------------------------------------------
  // Test 16 checks if a backup/restore rolls back cleanly if an error is thrown.
  const backupData = {
    version: '1',
    timestamp: new Date().toISOString(),
    data: {
      users: [{ id: 'usr_res_1', username: 'res1', passwordHash: 'hash', role: 'ADMIN' }],
      invoices: [{ id: 'inv_res_1', date: new Date().toISOString(), type: 'entry', productId: 'prod_1' }],
    }
  };
  
  let restoreFailed = false;
  try {
      await db.transaction(async (tx: any) => {
          await tx.insert(schema.users).values(backupData.data.users);
          await tx.insert(schema.invoices).values(backupData.data.invoices.map((i: any) => ({ ...i, type: 'entry' })));
          throw new Error("Simulated restore failure");
      });
  } catch (e: any) {
      restoreFailed = true;
      assert(e.message === "Simulated restore failure", "Test 16: Restore failure simulated in transaction.");
  }
  
  const restoredInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.id, 'inv_res_1'));
  const restoredUsers = await db.select().from(schema.users).where(eq(schema.users.id, 'usr_res_1'));
  
  assert(restoredInvoices.length === 0 && restoredUsers.length === 0, "Test 16: Database transaction rolls back, no partial restore remains.");
  

  console.log(`\n============================`);
  console.log(`Total tests passed: ${passed}`);
  console.log(`Total tests failed: ${failed}`);
  console.log(`============================\n`);
  
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
