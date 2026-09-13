import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.error('[NIR MIGRATION ERROR] DATABASE_URL is not set. Please provide a valid PostgreSQL connection string.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

export async function runMigrations() {
  console.log('[NIR MIGRATION] Starting PostgreSQL schema migration...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'ADMIN',
        full_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token);
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category_id TEXT REFERENCES product_categories(id),
        unit TEXT DEFAULT 'kg',
        min_stock NUMERIC,
        current_stock NUMERIC DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS products_name_idx ON products(name);
      CREATE INDEX IF NOT EXISTS products_type_idx ON products(type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT UNIQUE,
        location TEXT,
        manager TEXT,
        capacity NUMERIC,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS warehouses_name_idx ON warehouses(name);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS farmers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        broods JSONB,
        is_hidden BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS farmers_name_idx ON farmers(name);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        phone TEXT,
        iban TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS drivers_name_idx ON drivers(name);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS origins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT,
        driver_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP,
        seller_name TEXT,
        bill_weight NUMERIC,
        scale_weight NUMERIC,
        factory TEXT,
        bill_number TEXT,
        origin TEXT,
        transport_cost NUMERIC,
        driver_phone TEXT,
        driver_iban TEXT,
        wastage NUMERIC,
        farmer_id TEXT REFERENCES farmers(id),
        weight NUMERIC,
        invoice_number TEXT,
        product_variant TEXT,
        is_crumble BOOLEAN DEFAULT FALSE,
        is_page_break BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'completed',
        notes TEXT,
        created_by TEXT,
        updated_by TEXT
      );
      CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(date);
      CREATE INDEX IF NOT EXISTS invoices_type_idx ON invoices(type);
      CREATE INDEX IF NOT EXISTS invoices_product_id_idx ON invoices(product_id);
      CREATE INDEX IF NOT EXISTS invoices_farmer_id_idx ON invoices(farmer_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        batch_number TEXT NOT NULL UNIQUE,
        product_id TEXT NOT NULL REFERENCES products(id),
        production_record_id TEXT,
        initial_quantity NUMERIC NOT NULL,
        remaining_quantity NUMERIC NOT NULL,
        production_date TEXT,
        expiry_date TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS batches_product_id_idx ON batches(product_id);
      CREATE INDEX IF NOT EXISTS batches_batch_number_idx ON batches(batch_number);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS formulas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        finished_good_id TEXT NOT NULL REFERENCES products(id),
        items JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS formula_items (
        id TEXT PRIMARY KEY,
        formula_id TEXT NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        percentage NUMERIC,
        quantity NUMERIC,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS formula_items_formula_id_idx ON formula_items(formula_id);
      CREATE INDEX IF NOT EXISTS formula_items_product_id_idx ON formula_items(product_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS production_records (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        finished_good_id TEXT NOT NULL REFERENCES products(id),
        formula_id TEXT REFERENCES formulas(id),
        quantity_produced NUMERIC NOT NULL,
        batch_number TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS production_records_date_idx ON production_records(date);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        new_quantity NUMERIC NOT NULL,
        reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        type TEXT NOT NULL,
        quantity NUMERIC NOT NULL,
        balance_after NUMERIC,
        reference_type TEXT,
        reference_id TEXT,
        batch_id TEXT REFERENCES batches(id),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS inventory_tx_product_id_idx ON inventory_transactions(product_id);
      CREATE INDEX IF NOT EXISTS inventory_tx_date_idx ON inventory_transactions(date);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        action TEXT NOT NULL,
        action_text TEXT,
        type TEXT,
        details TEXT,
        "by" TEXT,
        user_id TEXT,
        ip_address TEXT
      );
      CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS logs_type_idx ON logs(type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_mutations (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        action TEXT NOT NULL,
        payload JSONB,
        user_id TEXT REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('[NIR MIGRATION] PostgreSQL schema successfully applied!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[NIR MIGRATION ERROR] Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Execute when run directly, either as TS (tsx server/db/migrate.ts) or as the
// bundled CommonJS entry (node db-migrate.cjs). Works under both ESM and CJS.
const entry = process.argv[1] || '';
if (/(?:^|[\\/])(?:db[-_])?migrate\.(?:ts|cjs|mjs|js)$/.test(entry)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
