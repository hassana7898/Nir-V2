import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'NirV2DB';
// v3 adds the `failedMutations` store (dead-letter queue). Nothing is dropped or rewritten:
// the upgrade is purely additive, so existing browsers migrate without data loss.
const DB_VERSION = 3;

/** Maximum automatic attempts before a mutation is declared permanently failed. */
export const MAX_SYNC_RETRIES = 5;

export interface SyncMutation {
  id: string; // operationId
  entityType: string;
  action: 'create' | 'update' | 'delete';
  payload: any;
  status: 'pending' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string;
  timestamp: number;
}

/** A mutation that exhausted its retries and was moved out of the active queue. */
export interface FailedMutation extends SyncMutation {
  failedAt: number;
  failureCode?: string;
}

export interface LegacyMigrationState {
  id: 'migration_state';
  status: 'NOT_STARTED' | 'IMPORTING' | 'IMPORTED' | 'SYNCING' | 'COMPLETED' | 'FAILED';
  lastError?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // A version upgrade is blocked while another tab still holds an older connection.
      // Log it, and let the OLD tab yield (see `blocking`) so upgrades complete instead of
      // hanging forever with a half-migrated schema.
      blocked() {
        console.warn('[NIR] IndexedDB upgrade is blocked by another open tab.');
      },
      blocking() {
        console.warn('[NIR] This tab holds an old IndexedDB connection; closing it so the upgrade can proceed.');
        dbPromise?.then((db) => db.close()).catch(() => { /* ignore */ });
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
      upgrade(db) {
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache'); // key is entity type (e.g., 'invoices', 'products')
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncQueue.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('failedMutations')) {
          // Dead-letter queue: permanently failed mutations live here, NEVER in syncQueue.
          const failed = db.createObjectStore('failedMutations', { keyPath: 'id' });
          failed.createIndex('by-failedAt', 'failedAt');
        }
        if (!db.objectStoreNames.contains('system')) {
          db.createObjectStore('system', { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
};

const dispatch = (event: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(event));
};

// Memory cache for synchronous UI reads
export const memoryCache: Record<string, any> = {};

export const setCacheItem = async (key: string, value: any) => {
  memoryCache[key] = value;
  const db = await initDB();
  await db.put('cache', value, key);
};

export const getCacheItem = (key: string) => {
  return memoryCache[key] ?? null;
};

// ---------------------------------------------------------------- active queue

export const enqueueMutation = async (mutation: Omit<SyncMutation, 'status' | 'retryCount' | 'timestamp'>) => {
  const db = await initDB();
  const fullMutation: SyncMutation = {
    ...mutation,
    status: 'pending',
    retryCount: 0,
    timestamp: Date.now(),
  };
  await db.put('syncQueue', fullMutation);
  dispatch('sync_queue_updated');
};

export const getPendingMutations = async () => {
  const db = await initDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
};

export const updateMutation = async (mutation: SyncMutation) => {
  const db = await initDB();
  await db.put('syncQueue', mutation);
  dispatch('sync_queue_updated');
};

export const removeMutation = async (id: string) => {
  const db = await initDB();
  await db.delete('syncQueue', id);
  dispatch('sync_queue_updated');
};

export const getSyncQueueCount = async (): Promise<number> => {
  const db = await initDB();
  return (await db.getAllKeys('syncQueue')).length;
};

// ---------------------------------------------------------------- dead-letter queue

export const getFailedMutationList = async (): Promise<FailedMutation[]> => {
  const db = await initDB();
  const rows = (await db.getAll('failedMutations')) as FailedMutation[];
  return rows.sort((a, b) => (b.failedAt || 0) - (a.failedAt || 0));
};

/** Backwards-compatible alias: failed mutations are their own store now. */
export const getFailedMutations = getFailedMutationList;

export const getFailedMutationCount = async (): Promise<number> => {
  const db = await initDB();
  return (await db.getAllKeys('failedMutations')).length;
};

/**
 * Move a mutation out of the retryable queue into the dead-letter queue.
 * This is what keeps a permanently failing mutation from blocking every future
 * hydration/sync cycle.
 */
export const moveToFailedMutations = async (id: string, failure: { code?: string; message?: string }) => {
  const db = await initDB();
  const mutation = (await db.get('syncQueue', id)) as SyncMutation | undefined;
  if (mutation) {
    const dead: FailedMutation = {
      ...mutation,
      status: 'failed',
      failureCode: failure.code,
      lastError: failure.message,
      failedAt: Date.now(),
    };
    await db.put('failedMutations', dead);
    await db.delete('syncQueue', id);
  }
  dispatch('sync_queue_updated');
  dispatch('failed_mutations_updated');
};

/** Put a dead-lettered mutation back at the head of the retryable queue. */
export const requeueFailedMutation = async (id: string) => {
  const db = await initDB();
  const dead = (await db.get('failedMutations', id)) as FailedMutation | undefined;
  if (!dead) return false;
  const { failedAt, failureCode, ...rest } = dead;
  void failedAt; void failureCode;
  await db.put('syncQueue', { ...rest, status: 'pending', retryCount: 0, timestamp: Date.now() } as SyncMutation);
  await db.delete('failedMutations', id);
  dispatch('sync_queue_updated');
  dispatch('failed_mutations_updated');
  return true;
};

export const discardFailedMutation = async (id: string) => {
  const db = await initDB();
  await db.delete('failedMutations', id);
  dispatch('failed_mutations_updated');
};

export const clearFailedMutations = async () => {
  const db = await initDB();
  await db.clear('failedMutations');
  dispatch('failed_mutations_updated');
};

// ---------------------------------------------------------------- system state

export const getSystemState = async <T>(id: string): Promise<T | null> => {
  const db = await initDB();
  return (await db.get('system', id)) || null;
};

export const setSystemState = async (state: any) => {
  const db = await initDB();
  await db.put('system', state);
};

export const clearCache = async () => {
  const db = await initDB();
  await db.clear('cache');
  for (const key in memoryCache) delete memoryCache[key];
};
