import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'NirV2DB';
const DB_VERSION = 2;

export interface SyncMutation {
  id: string; // operationId
  entityType: string;
  action: 'create' | 'update' | 'delete';
  payload: any;
  status: 'pending' | 'failed';
  retryCount: number;
  lastError?: string;
  timestamp: number;
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
      upgrade(db) {
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache'); // key is entity type (e.g., 'invoices', 'products')
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncQueue.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('system')) {
          db.createObjectStore('system', { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
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

export const enqueueMutation = async (mutation: Omit<SyncMutation, 'status' | 'retryCount' | 'timestamp'>) => {
  const db = await initDB();
  const fullMutation: SyncMutation = {
    ...mutation,
    status: 'pending',
    retryCount: 0,
    timestamp: Date.now(),
  };
  await db.put('syncQueue', fullMutation);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('sync_queue_updated'));
};

export const getPendingMutations = async () => {
  const db = await initDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
};

export const getFailedMutations = async () => {
  const db = await initDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'failed');
};

export const updateMutation = async (mutation: SyncMutation) => {
  const db = await initDB();
  await db.put('syncQueue', mutation);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('sync_queue_updated'));
};

export const removeMutation = async (id: string) => {
  const db = await initDB();
  await db.delete('syncQueue', id);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('sync_queue_updated'));
};

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
