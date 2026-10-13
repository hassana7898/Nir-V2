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
        totp_secret TEXT,
        is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
        sort_order INTEGER,
        status TEXT DEFAULT 'completed',
        notes TEXT,
        created_by TEXT,
        updated_by TEXT
      );
      CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(date);
      CREATE INDEX IF NOT EXISTS invoices_type_idx ON invoices(type);
      CREATE INDEX IF NOT EXISTS invoices_product_id_idx ON invoices(product_id);
      CREATE INDEX IF NOT EXISTS invoices_farmer_id_idx ON invoices(farmer_id);
      -- Additive upgrade for databases created before per-day ordering was persisted.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sort_order INTEGER;
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

    // Server-authoritative audit trail (ردپای کاربران): atomic with the business change.
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        role TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        target_ids JSONB,
        summary JSONB,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity);
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

    // ------------------------------------------------------------------
    // Additive schema-parity upgrades.
    // These columns are required by server/db/schema.ts and were added to the
    // live database over time, but were never folded back into the CREATE TABLE
    // statements above. Without them a FRESH install (or a disaster-recovery
    // restore from this script) produced a database the server could not query:
    //   * every invoice/product/... SELECT 500'd on the missing `version`,
    //   * offline idempotency 500'd on the missing `sync_mutations.resource_id`.
    // `ADD COLUMN IF NOT EXISTS` is a no-op on already-migrated databases.
    await client.query(`
      ALTER TABLE products              ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE farmers               ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE drivers               ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE origins               ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE invoices              ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE batches               ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE formulas              ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE formula_items         ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE production_records    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversal_of TEXT;
      ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS resource_id TEXT;
      ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS payload_hash TEXT;
      ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
      ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
      ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS original_result JSONB;
      CREATE INDEX IF NOT EXISTS sync_mutations_created_at_idx ON sync_mutations(created_at);
      CREATE INDEX IF NOT EXISTS sync_mutations_fingerprint_idx ON sync_mutations(id, request_fingerprint);
    `);

    // Additive upgrade for TOTP / two-factor authentication. These columns are
    // required by server/db/schema.ts; adding them here lets existing databases
    // (created before 2FA existed) upgrade safely. `ADD COLUMN IF NOT EXISTS`
    // is a no-op on already-migrated databases, so this block is idempotent.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // ---- Weighbridge (باسکول توزین نگار) ------------------------------------------------
    // Tickets imported from the factory SQL Server by the background worker, plus the link to
    // the entry/exit invoice they were assigned to. Fully idempotent (mirrors
    // migrations/0003_weighbridge.sql so a fresh install and an upgraded one converge).
    await client.query(`
      CREATE TABLE IF NOT EXISTS weighbridge_records (
        id                    SERIAL PRIMARY KEY,
        external_id           INTEGER NOT NULL UNIQUE,
        ticket_number         TEXT,
        plate_number          TEXT,
        driver_name           TEXT,
        carrier_company       TEXT,
        gross_weight          NUMERIC(14, 3),
        tare_weight           NUMERIC(14, 3),
        net_weight            NUMERIC(14, 3),
        weigh_time            TIMESTAMP,
        status                TEXT NOT NULL DEFAULT 'unmapped',
        mapped_remittance_id  TEXT REFERENCES invoices(id),
        previous_weight_value TEXT,
        source                TEXT DEFAULT 'WEIGHNGDB.WeightTable',
        raw_payload           JSONB,
        last_synced_at        TIMESTAMP,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'WEIGHNGDB.WeightTable';
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS raw_payload JSONB;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS previous_weight_value TEXT;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS direction_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS goods TEXT;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS remittance_number TEXT;
      ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS customer_name TEXT;
      CREATE INDEX IF NOT EXISTS weighbridge_records_weigh_time_idx ON weighbridge_records(weigh_time DESC);
      CREATE INDEX IF NOT EXISTS weighbridge_records_plate_idx      ON weighbridge_records(plate_number);
      CREATE INDEX IF NOT EXISTS weighbridge_records_status_idx     ON weighbridge_records(status);
      CREATE INDEX IF NOT EXISTS weighbridge_records_mapped_idx     ON weighbridge_records(mapped_remittance_id);
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weighbridge_records_status_chk') THEN
          ALTER TABLE weighbridge_records ADD CONSTRAINT weighbridge_records_status_chk
            CHECK (status IN ('unmapped', 'mapped', 'archived'));
        END IF;
      END $$;
    `);

    // ---- Phase 1 mobile: driver <-> invoice foreign key (mirrors migrations/0005_mobile_driver_link.sql)
    // Adds the FK the mobile API matches loads on. `driver_name` stays for backward compatibility;
    // the name -> id data backfill runs separately (scripts/backfill-invoice-drivers.sql).
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS driver_id TEXT REFERENCES drivers(id);
      CREATE INDEX IF NOT EXISTS idx_invoices_driver_id ON invoices(driver_id);
    `);

    // ---- Phase 2 mobile: driver-reported trip state (mirrors migrations/0006_mobile_trip_status.sql)
    // NULL keeps the pre-Phase-2 meaning for every existing row: the mobile API then derives
    // `assigned` / `delivered` from delivery_proofs. The web UI and the weighbridge worker never
    // read or write these columns.
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_invoices_trip_status ON invoices(trip_status);
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
