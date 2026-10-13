-- scripts/dev-seed-mobile-phase1.sql
-- DEV ONLY (nir_dev) - Phase 1 mobile test data. DO NOT run against production.
--
-- Creates exactly what the operator approved:
--   1 DRIVER test account  -> 09120000001  (bound to an existing real driver that already has loads)
--   1 FARMER test account  -> 09120000002  (bound to an existing real farmer that already has exit invoices)
--   5 sample farmer phones -> 09121000001 .. 09121000005 (for testing farmer OTP on existing farmers)
--
-- Design rules:
--   * Every choice is DYNAMIC (the busiest driver / farmer is picked), so the seeded account sees
--     real invoices instead of an empty list. Existence is re-checked at run time, so the script
--     works whatever IDs the database happens to have.
--   * Idempotent: phones are only written where the column is empty, users are inserted only when
--     the id/username is absent, and the sample-phone block refuses to run once its 5 numbers exist.
--   * No literal Persian text: names are copied with SELECT (ASCII-only file survives psql over WinRM).
--   * `password_hash` is empty: these accounts are OTP-only (they can never be used with the
--     username/password endpoint, which needs a bcrypt hash).
--
-- Run:  psql -d nir_dev -v ON_ERROR_STOP=1 -f dev-seed-mobile-phase1.sql

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1) Driver test account
-- ---------------------------------------------------------------------------------------------
WITH picked AS (
  SELECT d.id
    FROM drivers d
   WHERE d.deleted_at IS NULL
     AND (d.phone IS NULL OR btrim(d.phone) = '')
     AND NOT EXISTS (SELECT 1 FROM drivers x WHERE x.deleted_at IS NULL AND x.phone = '09120000001')
   ORDER BY (SELECT count(*) FROM invoices i
              WHERE i.driver_id = d.id AND i.deleted_at IS NULL) DESC,
            (SELECT count(*) FROM invoices i2
              WHERE btrim(i2.driver_name) = btrim(d.name) AND i2.deleted_at IS NULL) DESC,
            d.created_at ASC
   LIMIT 1
)
UPDATE drivers d
   SET phone = '09120000001'
  FROM picked p
 WHERE d.id = p.id;

INSERT INTO users (id, username, password_hash, role, full_name, phone, driver_id, farmer_id, is_2fa_enabled, created_at, updated_at)
SELECT 'usr-mobile-test-driver', '09120000001', '', 'DRIVER', d.name, '09120000001', d.id, NULL, FALSE, now(), now()
  FROM drivers d
 WHERE d.phone = '09120000001'
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = 'usr-mobile-test-driver' OR u.username = '09120000001')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 2) Farmer test account
-- ---------------------------------------------------------------------------------------------
WITH picked AS (
  SELECT f.id
    FROM farmers f
   WHERE f.deleted_at IS NULL
     AND (f.phone IS NULL OR btrim(f.phone) = '')
     AND NOT EXISTS (SELECT 1 FROM farmers x WHERE x.deleted_at IS NULL AND x.phone = '09120000002')
   ORDER BY (SELECT count(*) FROM invoices i
              WHERE i.farmer_id = f.id AND i.deleted_at IS NULL AND i.type = 'exit') DESC,
            f.created_at ASC
   LIMIT 1
)
UPDATE farmers f
   SET phone = '09120000002'
  FROM picked p
 WHERE f.id = p.id;

INSERT INTO users (id, username, password_hash, role, full_name, phone, driver_id, farmer_id, is_2fa_enabled, created_at, updated_at)
SELECT 'usr-mobile-test-farmer', '09120000002', '', 'FARMER', f.name, '09120000002', NULL, f.id, FALSE, now(), now()
  FROM farmers f
 WHERE f.phone = '09120000002'
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = 'usr-mobile-test-farmer' OR u.username = '09120000002')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 3) Five sample farmer phones (for farmer OTP / login tests on existing farmers)
-- ---------------------------------------------------------------------------------------------
WITH cand AS (
  SELECT f.id, row_number() OVER (ORDER BY f.created_at ASC, f.id ASC) AS rn
    FROM farmers f
   WHERE f.deleted_at IS NULL
     AND (f.phone IS NULL OR btrim(f.phone) = '')
     AND NOT EXISTS (
           SELECT 1 FROM farmers x
            WHERE x.deleted_at IS NULL
              AND x.phone IN ('09121000001','09121000002','09121000003','09121000004','09121000005'))
   ORDER BY f.created_at ASC, f.id ASC
   LIMIT 5
)
UPDATE farmers f
   SET phone = '0912100000' || c.rn::text
  FROM cand c
 WHERE f.id = c.id;

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- Verification report
-- ---------------------------------------------------------------------------------------------
SELECT 'mobile test users (DRIVER/FARMER)' AS metric, count(*)::text AS value
  FROM users WHERE id IN ('usr-mobile-test-driver', 'usr-mobile-test-farmer')
UNION ALL
SELECT 'seeded phone numbers', count(*)::text
  FROM (
    SELECT phone FROM drivers WHERE phone = '09120000001'
    UNION ALL
    SELECT phone FROM farmers WHERE phone IN ('09120000002','09121000001','09121000002','09121000003','09121000004','09121000005')
  ) s
UNION ALL
SELECT 'loads visible to the driver account (backfilled FK)', count(*)::text
  FROM invoices i
  JOIN users u ON u.id = 'usr-mobile-test-driver' AND i.driver_id = u.driver_id
 WHERE i.deleted_at IS NULL
UNION ALL
SELECT 'exit invoices visible to the farmer account', count(*)::text
  FROM invoices i
  JOIN users u ON u.id = 'usr-mobile-test-farmer' AND i.farmer_id = u.farmer_id
 WHERE i.deleted_at IS NULL AND i.type = 'exit';

SELECT u.username, u.role, u.full_name, u.driver_id, u.farmer_id
  FROM users u
 WHERE u.id IN ('usr-mobile-test-driver', 'usr-mobile-test-farmer')
 ORDER BY u.role;
