-- 0005_mobile_driver_link.sql
-- Phase 1 (mobile) - link every remittance to its driver by FOREIGN KEY.
--
-- Why: until now a driver was attached to an invoice only through the free-text
-- `invoices.driver_name` column, and the mobile driver experience matched its loads by
-- comparing strings (~85% hit rate, silent misses). This migration adds the FK the mobile
-- API needs, WITHOUT removing `driver_name` (backward compatibility for the web UI, the
-- weighbridge worker and the legacy imports that still write it).
--
-- Additive + idempotent: safe to execute repeatedly and on a database that already has it.
-- The data backfill (name -> id) is deliberately kept OUT of this file: see
-- scripts/backfill-invoice-drivers.sql (run it right after this migration).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS driver_id TEXT REFERENCES drivers(id);
CREATE INDEX IF NOT EXISTS idx_invoices_driver_id ON invoices(driver_id);

COMMENT ON COLUMN invoices.driver_id IS
  'FK to drivers.id. Legacy free-text invoices.driver_name is kept for backward compatibility; backfilled by scripts/backfill-invoice-drivers.sql.';
