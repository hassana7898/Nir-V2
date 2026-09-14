-- =============================================================================
-- NIR V2 upgrade — idempotent. Safe to run repeatedly on an existing database.
-- Adds optimistic-concurrency `version` columns and the idempotency/outbox
-- columns required by V2. Does NOT drop or rewrite any data.
-- =============================================================================

-- Optimistic concurrency (OCC) versions
ALTER TABLE products                ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE farmers                 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE drivers                 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE origins                 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE invoices                ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE batches                 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE formulas                ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE formula_items           ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE production_records      ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE inventory_adjustments   ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Invoice bookkeeping columns (present in V2 ORM model)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status     text DEFAULT 'active';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes      text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_by text;

-- Idempotency / outbox ledger (V2 uses sync_mutations as the operation log)
ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS resource_id          text;
ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS request_fingerprint  text;
ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS status               text DEFAULT 'success';
ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS original_result      json;

CREATE INDEX IF NOT EXISTS sync_mutations_fingerprint_idx ON sync_mutations (id, request_fingerprint);

-- Ensure the business tables exist on a brand-new database (no-op otherwise)
CREATE TABLE IF NOT EXISTS warehouses (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  location text,
  manager text,
  capacity numeric,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  deleted_at timestamp
);
