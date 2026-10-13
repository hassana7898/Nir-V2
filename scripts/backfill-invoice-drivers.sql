-- scripts/backfill-invoice-drivers.sql
-- Phase 1 (mobile) data migration: fill invoices.driver_id from the legacy free-text
-- invoices.driver_name column so the mobile driver experience can match loads by FK.
--
-- Design rules (why it looks like this):
--   * ONLY rows with driver_id IS NULL are touched -> the script is idempotent and a manual
--     assignment made by an operator is never overwritten.
--   * A name that resolves to MORE THAN ONE driver row is SKIPPED (count(DISTINCT driver_id) = 1):
--     a wrong FK link would show another driver's loads, which is worse than an unmapped row.
--   * Two passes: exact btrim() match first (highest confidence), then a normalised match
--     (Arabic yeh/kaf -> Persian, ta-marbuta/heh -> heh, ZWNJ + collapsed whitespace) which
--     catches the spelling variants seen in the imported data.
--   * ASCII-only: no literal Persian characters in this file, so it survives being piped to
--     psql over WinRM/PowerShell without codepage damage (U&'\\xxxx' escapes are used instead).
--
-- Run (transport is transport - always the same SQL):
--   psql -d nir_dev -v ON_ERROR_STOP=1 -f backfill-invoice-drivers.sql
--
-- Every statement below is a single transaction; nothing is committed unless the whole
-- script succeeds in the caller's session.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- Pass 1 - exact match on the trimmed name
-- ---------------------------------------------------------------------------------------------
WITH cand AS (
  SELECT i.id AS invoice_id, d.id AS driver_id
    FROM invoices i
    JOIN drivers d ON btrim(d.name) = btrim(i.driver_name)
   WHERE i.driver_id IS NULL
     AND i.driver_name IS NOT NULL
     AND btrim(i.driver_name) <> ''
     AND d.deleted_at IS NULL
), uniq AS (
  SELECT invoice_id, min(driver_id) AS driver_id
    FROM cand
   GROUP BY invoice_id
  HAVING count(DISTINCT driver_id) = 1
)
UPDATE invoices i
   SET driver_id = u.driver_id
  FROM uniq u
 WHERE i.id = u.invoice_id
   AND i.driver_id IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Pass 2 - normalised match (Arabic yeh 064A -> Persian yeh 06CC, Arabic kaf 0643 -> Persian
-- kaf 06A9, ta-marbuta 0629 + heh-with-yeh-above 06C0 -> heh 0647, ZWNJ 200C -> space,
-- whitespace runs collapsed). Same one-to-one safety guard as pass 1.
-- ---------------------------------------------------------------------------------------------
WITH drv AS (
  SELECT d.id,
         regexp_replace(
           translate(replace(btrim(d.name), U&'\200C', ' '),
                     U&'\064A\0643\0629\06C0',
                     U&'\06CC\06A9\0647\0647'),
           '\s+', ' ', 'g') AS name_key
    FROM drivers d
   WHERE d.deleted_at IS NULL
), inv AS (
  SELECT i.id,
         regexp_replace(
           translate(replace(btrim(i.driver_name), U&'\200C', ' '),
                     U&'\064A\0643\0629\06C0',
                     U&'\06CC\06A9\0647\0647'),
           '\s+', ' ', 'g') AS name_key
    FROM invoices i
   WHERE i.driver_id IS NULL
     AND i.driver_name IS NOT NULL
     AND btrim(i.driver_name) <> ''
), cand AS (
  SELECT inv.id AS invoice_id, drv.id AS driver_id
    FROM inv
    JOIN drv ON drv.name_key = inv.name_key
), uniq AS (
  SELECT invoice_id, min(driver_id) AS driver_id
    FROM cand
   GROUP BY invoice_id
  HAVING count(DISTINCT driver_id) = 1
)
UPDATE invoices i
   SET driver_id = u.driver_id
  FROM uniq u
 WHERE i.id = u.invoice_id
   AND i.driver_id IS NULL;

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- Verification report (printed by psql; also used as the Phase 1 evidence in the report)
-- ---------------------------------------------------------------------------------------------
SELECT 'invoices total'            AS metric, count(*)::text AS value FROM invoices
UNION ALL
SELECT 'invoices with driver_id',        count(*)::text FROM invoices WHERE driver_id IS NOT NULL
UNION ALL
SELECT 'invoices with driver_name',      count(*)::text FROM invoices WHERE driver_name IS NOT NULL AND btrim(driver_name) <> ''
UNION ALL
SELECT 'invoices still unmapped (have name)',
       count(*)::text FROM invoices WHERE driver_id IS NULL AND driver_name IS NOT NULL AND btrim(driver_name) <> ''
UNION ALL
SELECT 'distinct unmapped names',
       count(DISTINCT btrim(driver_name))::text FROM invoices WHERE driver_id IS NULL AND driver_name IS NOT NULL AND btrim(driver_name) <> '';
