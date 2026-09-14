import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

let realPool: Pool | null = null;
let drizzleDb: any = null;

const e2eTestRequested = process.env.E2E_TEST === 'true';
const isProductionEnv = process.env.NODE_ENV === 'production';

if (e2eTestRequested && isProductionEnv) {
  console.error('[NIR DB FATAL] E2E_TEST mock database is FORBIDDEN in production. Ignoring mock; PostgreSQL remains authoritative.');
}

// PGlite is a DEVELOPMENT-ONLY dependency. It is imported lazily so the production
// bundle never requires it and stays self-contained (no node_modules on the server).
let pgliteReady: Promise<void> | null = null;

if (process.env.PGLITE_TEST === 'true' && !isProductionEnv) {
  console.log('[NIR DB] PGlite Test DB Enabled');
  pgliteReady = (async () => {
    try {
      const { PGlite } = await import('@electric-sql/pglite');
      const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      const client = new PGlite();
      const pgliteDb: any = drizzlePglite(client, { schema });
      pgliteDb.migrateDb = async () => {
        await migrate(pgliteDb, { migrationsFolder: './drizzle' });
      };
      drizzleDb = pgliteDb;
    } catch (err: any) {
      console.error('[NIR DB] PGlite initialisation failed:', err?.message || err);
    }
  })();
} else if (e2eTestRequested && !isProductionEnv) {
  console.log('[NIR DB] E2E DB Mock Enabled (non-production only)');
  const mockUsers: any[] = [];
  const mockQueryObj = (method: string, args: any) => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: () => q,
      values: (vals: any) => {
        if (method === 'insert') mockUsers.push(vals);
        return q;
      },
      then: (res: any, rej: any) => {
        if (method === 'select') {
          return Promise.resolve(mockUsers).then(res, rej);
        }
        return Promise.resolve().then(res, rej);
      },
      catch: (rej: any) => Promise.resolve().catch(rej)
    };
    return q;
  };

  drizzleDb = {
    select: (...args: any[]) => mockQueryObj('select', args),
    insert: (...args: any[]) => mockQueryObj('insert', args),
    delete: (...args: any[]) => mockQueryObj('delete', args),
    update: (...args: any[]) => mockQueryObj('update', args)
  };
} else if (databaseUrl) {
  try {
    realPool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DB_POOL_MAX || 20),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
      keepAlive: true,
    });

    realPool.on('error', (error) => {
      console.error('[NIR DB] PostgreSQL pool error:', error.message);
    });

    drizzleDb = drizzle(realPool, { schema });
    console.log('[NIR DB] PostgreSQL client initialized via DATABASE_URL');
  } catch (err: any) {
    console.error('[NIR DB] Failed to initialize PostgreSQL pool:', err?.message || err);
    realPool = null;
    drizzleDb = null;
  }
} else {
  if (process.env.NODE_ENV === 'production') {
    console.error('[NIR DB FATAL] DATABASE_URL is not set. PostgreSQL is the authoritative source of truth. Please configure DATABASE_URL in .env');
  } else {
    console.warn('[NIR DB WARN] DATABASE_URL is not set. Database operations will return an actionable configuration error until DATABASE_URL is provided.');
  }
}

// Proxied Drizzle DB: when connected, calls the real Drizzle instance; when not
// connected, fails with an actionable error.
const dbProxyHandler: ProxyHandler<any> = {
  get(_target, prop) {
    if (prop === 'migrateDb') {
      return async () => {
        if (pgliteReady) await pgliteReady;
        if (drizzleDb && typeof drizzleDb.migrateDb === 'function') await drizzleDb.migrateDb();
      };
    }
    if (prop === 'then' && !drizzleDb) return undefined;
    if (drizzleDb) {
      return (drizzleDb as any)[prop];
    }
    // Return a builder that rejects with a clear message
    return (..._args: any[]) => {
      const errorMsg = 'اتصال به PostgreSQL برقرار نشد. لطفاً مقدار DATABASE_URL را در فایل .env بررسی کنید.';
      const queryObj: any = {
        from: () => queryObj,
        where: () => queryObj,
        orderBy: () => queryObj,
        limit: () => queryObj,
        offset: () => queryObj,
        values: () => queryObj,
        set: () => queryObj,
        onConflictDoUpdate: () => queryObj,
        onConflictDoNothing: () => queryObj,
        then: (_onFulfilled: any, onRejected?: any) => {
          const err = new Error(errorMsg);
          if (onRejected) return Promise.reject(err).catch(onRejected);
          return Promise.reject(err);
        },
        catch: (onRejected: any) => Promise.reject(new Error(errorMsg)).catch(onRejected)
      };
      return queryObj;
    };
  }
};

export const db = new Proxy({}, dbProxyHandler);

export const pool = realPool || ({
  query: async () => {
    throw new Error('PostgreSQL pool is not connected. DATABASE_URL is required.');
  },
  connect: async () => {
    throw new Error('PostgreSQL pool is not connected. DATABASE_URL is required.');
  },
  end: async () => {},
  on: () => {},
} as unknown as Pool);

export const checkDbHealth = async (): Promise<{ status: 'connected' | 'disconnected'; engine: string; error?: string }> => {
  if (process.env.E2E_TEST === 'true' && process.env.NODE_ENV !== 'production') return { status: 'connected', engine: 'postgresql' };
  if (!realPool) {
    return {
      status: 'disconnected',
      engine: 'postgresql',
      error: 'DATABASE_URL is not configured. Please configure DATABASE_URL in .env (e.g., postgresql://postgres:***@localhost:5432/nir_db).'
    };
  }
  try {
    const client = await realPool.connect();
    await client.query('SELECT 1');
    client.release();
    return { status: 'connected', engine: 'postgresql' };
  } catch (error: any) {
    return {
      status: 'disconnected',
      engine: 'postgresql',
      error: error?.message || 'Database unavailable'
    };
  }
};

export const closeDb = async () => {
  if (realPool) {
    await realPool.end();
  }
};
