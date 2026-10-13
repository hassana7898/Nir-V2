-- 0006_mobile_trip_status.sql
-- Phase 2 (mobile) - driver-reported trip state on the remittance itself.
--
-- Why: a driver load only had two DERIVED states, both computed from the existence of a
-- delivery_proofs row (`delivered` / `in_transit`). The flow the drivers actually follow
-- (assigned -> at the origin -> loading -> at the destination -> unloading -> delivered) had nowhere
-- to live, so the app could not show progress and the office could not see where a truck was.
--
-- Additive + idempotent. NULL means "never reported", and the mobile API keeps deriving
-- `assigned` / `delivered` from the delivery receipt for those rows, so every existing remittance
-- keeps its current meaning and the web UI / weighbridge worker (which never read these columns)
-- are untouched.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trip_status_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_invoices_trip_status ON invoices(trip_status);

COMMENT ON COLUMN invoices.trip_status IS
  'Mobile driver trip state: assigned|at_origin|loading|at_destination|unloading|delivered|cancelled. NULL = never reported; the mobile API derives assigned/delivered from delivery_proofs.';
COMMENT ON COLUMN invoices.trip_status_at IS
  'When the mobile app last changed invoices.trip_status (NULL when the state is derived, not reported).';
