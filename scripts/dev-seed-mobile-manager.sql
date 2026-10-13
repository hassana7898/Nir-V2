-- scripts/dev-seed-mobile-manager.sql
-- DEV ONLY (nir_dev) - manager test account for the NIR mobile app (Phase 1 device test).
--
-- Why: OTP login resolves the role from the phone number in this order
--   (1) drivers.phone -> DRIVER, (2) farmers.phone -> FARMER, (3) users.phone -> that role.
-- Neither nir_dev nor nir_db currently has ANY ADMIN/MANAGER user carrying a phone, so every OTP
-- login lands on the driver or farmer navigator and the manager-only screens (farmers + breeding
-- periods, approvals cartable, weighbridge, remittances/waybills, inventory, KPI) can never be
-- reached. This script creates exactly one MANAGER identity bound to phone 09120000003.
--
-- Design rules (same as dev-seed-mobile-phase1.sql):
--   * Idempotent: inserts only when the username/phone is absent; re-running changes nothing.
--   * Guarded: refuses to run unless current_database() = 'nir_dev'.
--   * ASCII-only text (survives psql over WinRM); full_name is copied with SELECT.
--   * password_hash is empty: OTP-only account, the password endpoint cannot use it.
--
-- Phone is a parameter, so the same file serves the shared test manager and any real operator:
--   psql -d nir_dev -v ON_ERROR_STOP=1 -f dev-seed-mobile-manager.sql                      (default)
--   psql -d nir_dev -v ON_ERROR_STOP=1 -v phone=09123456789 -f dev-seed-mobile-manager.sql (explicit)
-- Without -v phone the shared dev test number 09120000003 is used, i.e. re-running this file keeps
-- behaving exactly as it did in the Phase 1 device test.

\set ON_ERROR_STOP on

\if :{?phone}
\else
\set phone '09120000003'
\endif

DO $$
BEGIN
  IF current_database() <> 'nir_dev' THEN
    RAISE EXCEPTION 'Refusing to run on database % - this seed is DEV ONLY (nir_dev)', current_database();
  END IF;
END $$;

BEGIN;

-- 1) Manager role identity (OTP login -> role MANAGER -> ManagerNavigator).
INSERT INTO users (id, username, password_hash, role, full_name, phone, driver_id, farmer_id, is_2fa_enabled, created_at, updated_at)
SELECT 'usr-mobile-test-manager-' || :'phone',
       :'phone',
       '',
       'MANAGER',
       coalesce(
         (SELECT u.full_name FROM users u
           WHERE u.role = 'ADMIN' AND coalesce(btrim(u.full_name), '') <> ''
           ORDER BY u.created_at LIMIT 1),
         'NIR Dev Manager'
       ),
       :'phone',
       NULL,
       NULL,
       FALSE,
       now(),
       now()
WHERE NOT EXISTS (SELECT 1 FROM users x WHERE x.username = :'phone' OR x.phone = :'phone');

-- 2) Make sure the phone is present even if a row with this username already existed.
UPDATE users SET phone = :'phone', role = 'MANAGER', updated_at = now()
 WHERE username = :'phone' AND (phone IS NULL OR btrim(phone) = '');

COMMIT;

-- Assertion: exactly one MANAGER row carrying the requested phone.
SELECT 'MANAGER_SEED|' || username || '|role=' || role || '|phone=' || coalesce(phone, '-')
  FROM users
 WHERE username = :'phone';

-- Role-resolution shadow check (important): mobileAuth resolves a number in the order
-- drivers.phone -> DRIVER, farmers.phone -> FARMER, users.phone -> that role. If the requested
-- number already belongs to a driver or a farmer, OTP login will STILL land on that role and the
-- manager screens stay hidden. Reported here instead of silently "fixing" it, because the caller
-- must decide (a different number, or a deliberate test account).
SELECT 'SHADOW|' || w.kind || '|' || w.name
  FROM (
    SELECT 'driver' AS kind, d.name
      FROM drivers d
     WHERE d.deleted_at IS NULL
       AND regexp_replace(coalesce(d.phone, ''), '\D', '', 'g') = regexp_replace(:'phone', '\D', '', 'g')
    UNION ALL
    SELECT 'farmer' AS kind, f.name
      FROM farmers f
     WHERE f.deleted_at IS NULL
       AND regexp_replace(coalesce(f.phone, ''), '\D', '', 'g') = regexp_replace(:'phone', '\D', '', 'g')
  ) w;
