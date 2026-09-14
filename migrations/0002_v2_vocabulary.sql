-- =============================================================================
-- NIR V2 vocabulary & immutable-ledger alignment — idempotent, additive only.
-- No table, column or text identifier is dropped or rewritten.
-- Safe to run repeatedly on the live database.
-- =============================================================================

-- 1) Immutable ledger: reversal entries point at the transaction they reverse.
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversal_of text;

-- 2) Idempotency: canonical payload hash (was `request_fingerprint`).
ALTER TABLE sync_mutations ADD COLUMN IF NOT EXISTS payload_hash text;

-- 3) Backfill the canonical hash from the pre-rename column.
UPDATE sync_mutations
   SET payload_hash = request_fingerprint
 WHERE payload_hash IS NULL
   AND request_fingerprint IS NOT NULL;

-- 4) Backfill reversal links for reversals created before this change.
UPDATE inventory_transactions
   SET reversal_of = substring(notes from 'Reversal of transaction (.+)$')
 WHERE reversal_of IS NULL
   AND type = 'reversal'
   AND notes LIKE 'Reversal of transaction %';

-- 5) Index for reversal lookups (idempotent reversal checks).
CREATE INDEX IF NOT EXISTS inventory_transactions_reversal_of_idx
  ON inventory_transactions (reversal_of);

-- 6) Dead-letter visibility on the server side: failed mutations keep their status.
CREATE INDEX IF NOT EXISTS sync_mutations_status_idx
  ON sync_mutations (status);
