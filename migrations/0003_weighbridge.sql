-- 0003_weighbridge.sql
-- Weighbridge (باسکول توزین نگار) integration: imported tickets from the factory
-- SQL Server `WeightTable`, plus the mapping of a ticket to an entry/exit invoice.
-- Idempotent: safe to run repeatedly (the server also applies this at boot via server/db/migrate.ts).

CREATE TABLE IF NOT EXISTS weighbridge_records (
  id                    SERIAL PRIMARY KEY,
  external_id           INTEGER NOT NULL UNIQUE,           -- WeightTable primary key on SQL Server
  ticket_number         TEXT,
  plate_number          TEXT,
  driver_name           TEXT,
  carrier_company       TEXT,
  gross_weight          NUMERIC(14, 3),                    -- وزن پر (وزن اول)
  tare_weight           NUMERIC(14, 3),                    -- وزن خالی (وزن دوم)
  net_weight            NUMERIC(14, 3),                    -- وزن خالص
  weigh_time            TIMESTAMP,                         -- زمان ثبت توزین
  status                TEXT NOT NULL DEFAULT 'unmapped',  -- unmapped | mapped | archived
  mapped_remittance_id  TEXT REFERENCES invoices(id),      -- حواله ورود/خروج متصل‌شده
  source                TEXT DEFAULT 'WEIGHNGDB.WeightTable',
  raw_payload           JSONB,                             -- the row exactly as read from SQL Server
  last_synced_at        TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT weighbridge_records_status_chk CHECK (status IN ('unmapped', 'mapped', 'archived'))
);

CREATE INDEX IF NOT EXISTS weighbridge_records_weigh_time_idx ON weighbridge_records(weigh_time DESC);
CREATE INDEX IF NOT EXISTS weighbridge_records_plate_idx      ON weighbridge_records(plate_number);
CREATE INDEX IF NOT EXISTS weighbridge_records_status_idx     ON weighbridge_records(status);
CREATE INDEX IF NOT EXISTS weighbridge_records_mapped_idx     ON weighbridge_records(mapped_remittance_id);

-- direction: the weighing software's own in/out flag (entry=ورود | exit=خروج | unknown)
ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'unknown';
ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS direction_locked boolean NOT NULL DEFAULT FALSE;
ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS goods text;
ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS remittance_number text;
ALTER TABLE weighbridge_records ADD COLUMN IF NOT EXISTS customer_name text;
