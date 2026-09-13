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

if (e2eTestRequested && !isProductionEnv) {
  console.log('[NIR DB] E2E DB Mock Enabled (non-production only)');
  const mockUsers = [];
  const mockQueryObj = (method, args) => {
    let q = {
      from: () => q,
      where: () => q,
      limit: () => q,
      values: (vals) => {
        if (method === 'insert') mockUsers.push(vals);
        return q;
      },
      then: (res, rej) => {
        if (method === 'select') {
          return Promise.resolve(mockUsers).then(res, rej);
        }
        return Promise.resolve().then(res, rej);
      },
      catch: (rej) => Promise.resolve().catch(rej)
    };
    return q;
  };
  
  drizzleDb = {
    select: (...args) => mockQueryObj('select', args),
    insert: (...args) => mockQueryObj('insert', args),
    delete: (...args) => mockQueryObj('delete', args),
    update: (...args) => mockQueryObj('update', args)
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

// Proxied Drizzle DB: When connected, calls real Drizzle. When not connected, fails with an actionable error.
const dbProxyHandler: ProxyHandler<any> = {
  get(_target, prop) {
    if (drizzleDb) {
      return (drizzleDb as any)[prop];
    }
    // Return a function or builder that rejects with a clear message
    return (..._args: any[]) => {
      const errorMsg = 'پایگاه داده PostgreSQL متصل نیست. لطفا متغیر DATABASE_URL را در فایل .env تنظیم نمایید.';
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
      error: 'DATABASE_URL is not configured. Please configure DATABASE_URL in .env (e.g., postgresql://postgres:password@localhost:5432/nir_db).'
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
