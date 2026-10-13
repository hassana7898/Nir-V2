# Phase A / step 1 — hard-isolate dev.artadan.ir data + secrets from app.artadan.ir.
#
# Writes (dev-only):
#   * a dedicated PG role  nir_dev_user  that OWNS nir_dev and canNOT connect to nir_db
#   * REVOKE CONNECT ON nir_db FROM PUBLIC  (nir_user, the owner, keeps full access)
#   * dev\.env : DATABASE_URL -> nir_dev_user, new JWT_SECRET, PG_BIN fixed, DB_POOL_MAX lowered
#   * dev\backups\isolation-<ts>\ copies of the previous .env + nginx dev confs
#   * C:\Servers\NIR\secrets\dev-credentials.json
# Prod files/processes/PG objects are NOT modified; prod health is asserted before and after.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File psremoting\dev-isolate-step1.ps1
[CmdletBinding()]
param(
  [switch] $SkipJwt,      # keep the existing dev JWT secret
  [switch] $SkipDbRole    # only rewrite .env (no new role / no ACL changes)
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function New-Alnum([int] $n) {
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ })
}
$devRole = 'nir_dev_user'
$devDbPw = New-Alnum 32
$devJwt = New-Alnum 64

$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  $res = Invoke-Command -Session $s -ArgumentList $stamp, $devRole, $devDbPw, $devJwt, $SkipJwt.IsPresent, $SkipDbRole.IsPresent -ScriptBlock {
    param($stamp, $role, $devPw, $devJwt, $skipJwt, $skipDbRole)

    $o = New-Object System.Collections.Generic.List[string]
    function A([string] $t) { $o.Add($t) }
    function Health([int] $p) {
      try { (Invoke-WebRequest "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 8).StatusCode } catch { 'ERR' }
    }

    $dev = 'C:\Servers\NIR\dev'
    $app = 'C:\Servers\NIR\app'
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $bak = Join-Path $dev "backups\isolation-$stamp"
    New-Item -ItemType Directory -Force -Path $bak | Out-Null

    # ---------------------------------------------------------------- 0) prod gate
    $prodBefore = Health 3000
    A ("step0 prod health before : $prodBefore")
    if ($prodBefore -ne 200) { throw "prod is not healthy (got '$prodBefore') - aborting, nothing changed" }
    A ("step0 dev  health before : " + (Health 3001))

    # ---------------------------------------------------------------- 1) backups of what we touch
    Copy-Item (Join-Path $dev '.env') (Join-Path $bak '.env.before') -Force
    Copy-Item 'C:\Servers\Nginx\conf\sites\dev.artadan.ir-ssl.conf' $bak -Force
    Copy-Item 'C:\Servers\Nginx\conf\sites\dev.artadan.ir.conf' $bak -Force
    A "step1 config backup      : $bak"

    # ---------------------------------------------------------------- 2) dedicated role + ACL lock
    $store = Get-Content 'C:\Servers\NIR\secrets\nir-credentials.json' -Raw | ConvertFrom-Json
    $env:PGPASSWORD = $store.postgres.password          # on-box superuser secret, never printed

    if (-not $skipDbRole) {
      $exists = & $psql -U postgres -h 127.0.0.1 -d postgres -t -A -c "select 1 from pg_roles where rolname='$role'"
      if ($exists -ne '1') {
        & $psql -U postgres -h 127.0.0.1 -d postgres -c "create role $role login nosuperuser nocreatedb nocreaterole password '$devPw'" | Out-Null
        A "step2 role               : created $role"
      } else {
        & $psql -U postgres -h 127.0.0.1 -d postgres -c "alter role $role login nosuperuser nocreatedb nocreaterole password '$devPw'" | Out-Null
        A "step2 role               : $role exists -> password rotated, attributes re-asserted"
      }

      # nir_dev becomes the dev role's own database; its objects move with it (nir_dev ONLY).
      # NOTE: never use REASSIGN OWNED here - it also rewrites SHARED catalog entries and would
      # hand the nir_db *database* to the dev role (which implicitly grants it CONNECT there).
      & $psql -U postgres -h 127.0.0.1 -d postgres -c "alter database nir_dev owner to $role" | Out-Null
      $objSql = (& $psql -U postgres -h 127.0.0.1 -d nir_dev -t -A -c @"
select case c.relkind
         when 'S' then format('alter sequence public.%I owner to %I', c.relname, '$role')
         when 'v' then format('alter view public.%I owner to %I', c.relname, '$role')
         when 'm' then format('alter materialized view public.%I owner to %I', c.relname, '$role')
         else format('alter table public.%I owner to %I', c.relname, '$role')
       end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_roles o on o.oid = c.relowner
where n.nspname = 'public' and o.rolname = 'nir_user' and c.relkind in ('r','p','S','v','m')
"@) | Where-Object { $_ -match '^alter ' }
      $fnSql = (& $psql -U postgres -h 127.0.0.1 -d nir_dev -t -A -c @"
select format('alter function public.%I(%s) owner to %I', p.proname, pg_get_function_identity_arguments(p.oid), '$role')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles o on o.oid = p.proowner
where n.nspname = 'public' and o.rolname = 'nir_user'
"@) | Where-Object { $_ -match '^alter ' }
      $moved = 0
      foreach ($q in @($objSql) + @($fnSql)) { & $psql -U postgres -h 127.0.0.1 -d nir_dev -c $q | Out-Null; $moved++ }
      A "step2 ownership         : $moved object(s) in nir_dev moved nir_user -> $role"
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "grant all on schema public to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "grant all on all tables in schema public to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "grant all on all sequences in schema public to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "grant all on all functions in schema public to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "alter default privileges for role $role in schema public grant all on tables to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d nir_dev -c "alter default privileges for role $role in schema public grant all on sequences to $role" | Out-Null
      A "step2 grants             : $role owns nir_dev + all objects in schema public"

      # The lock: only the proper role per database may connect (owner nir_user keeps full access).
      & $psql -U postgres -h 127.0.0.1 -d postgres -c "grant connect on database nir_db to nir_user" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d postgres -c "revoke connect on database nir_db from public" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d postgres -c "grant connect on database nir_dev to $role" | Out-Null
      & $psql -U postgres -h 127.0.0.1 -d postgres -c "revoke connect on database nir_dev from public" | Out-Null
      A "step2 acl lock           : CONNECT on nir_db => nir_user only; CONNECT on nir_dev => $role only"
    } else {
      A 'step2 role               : SKIPPED (-SkipDbRole)'
    }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

    # ---------------------------------------------------------------- 3) dev\.env rewrite (byte shape preserved)
    $envPath = Join-Path $dev '.env'
    $bytes = [System.IO.File]::ReadAllBytes($envPath)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $text = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
    if ($hasBom -and $text.StartsWith([char]0xFEFF)) { $text = $text.Substring(1) }
    $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
    $newConn = "DATABASE_URL=postgresql://$role`:$devPw@127.0.0.1:5432/nir_dev"
    $touched = New-Object System.Collections.Generic.List[string]
    $lines = foreach ($ln in ($text -split "`r?`n")) {
      if ($ln -match '^DATABASE_URL=') { $touched.Add('DATABASE_URL'); $newConn }
      elseif ($ln -match '^JWT_SECRET=' -and -not $skipJwt) { $touched.Add('JWT_SECRET'); "JWT_SECRET=$devJwt" }
      elseif ($ln -match '^PG_BIN=') { $touched.Add('PG_BIN'); 'PG_BIN=C:\Servers\PostgreSQL\bin' }
      elseif ($ln -match '^DB_POOL_MAX=') { $touched.Add('DB_POOL_MAX'); 'DB_POOL_MAX=8' }
      elseif ($ln -match '^WEIGHBRIDGE_SYNC_ENABLED=') { $touched.Add('WEIGHBRIDGE_SYNC_ENABLED'); 'WEIGHBRIDGE_SYNC_ENABLED=true' }
      else { $ln }
    }
    $out = ($lines -join $nl)
    if ($out -notmatch '(?m)^WEIGHBRIDGE_SYNC_ENABLED=') {
      $out = $out.TrimEnd("`r", "`n") + $nl + 'WEIGHBRIDGE_SYNC_ENABLED=true' + $nl
      $touched.Add('WEIGHBRIDGE_SYNC_ENABLED (+)')
    }
    [System.IO.File]::WriteAllText($envPath, $out, (New-Object System.Text.UTF8Encoding($hasBom)))
    A ("step3 dev .env           : rewritten (bom={0}) -> {1}" -f $hasBom, ($touched -join ', '))

    # ---------------------------------------------------------------- 4) dev credential store
    $devStore = [ordered]@{
      createdAt   = (Get-Date).ToString('s')
      host        = '127.0.0.1'; port = 5432; user = $role; password = $devPw
      database    = 'nir_dev'
      databaseUrl = "postgresql://$role`:$devPw@127.0.0.1:5432/nir_dev"
      note        = 'dev.artadan.ir dedicated role - owns nir_dev ONLY, cannot connect to nir_db (docs\DEV-ENVIRONMENT.md)'
    }
    $devStorePath = 'C:\Servers\NIR\secrets\dev-credentials.json'
    ($devStore | ConvertTo-Json -Depth 4) | Set-Content $devStorePath -Encoding UTF8
    Set-Acl -Path $devStorePath -AclObject (Get-Acl 'C:\Servers\NIR\secrets\nir-credentials.json')
    A "step4 dev credentials     : $devStorePath (ACL mirrored from nir-credentials.json)"

    # ---------------------------------------------------------------- 5) restart dev only
    Stop-ScheduledTask -TaskName 'NIR Dev Service' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dev\runtime\*" } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName 'NIR Dev Service'
    $devOk = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 750
      if ((Health 3001) -eq 200) { $devOk = $true; break }
    }
    $devMsg = 'dev health 200 after restart'
    if (-not $devOk) { $devMsg = 'DEV HEALTH FAILED - check C:\Servers\NIR\dev\logs' }
    A ("step5 dev restart         : $devMsg")
    if (-not $devOk) {
      foreach ($f in @('C:\Servers\NIR\dev\logs\nir-dev-server.err.log', 'C:\Servers\NIR\dev\logs\nir-dev-server.out.log')) {
        if (Test-Path $f) { foreach ($ln in (Get-Content $f -Tail 6)) { A ("     {0}: {1}" -f (Split-Path -Leaf $f), $ln) } }
      }
    }

    # ---------------------------------------------------------------- 6) isolation proof
    A 'step6 isolation proof:'
    $env:PGPASSWORD = $devPw
    $r1 = ((& $psql -U $role -h 127.0.0.1 -d nir_dev -t -A -c "select count(*) from weighbridge_records" 2>&1) -join ' ').Trim()
    $r2 = ((& $psql -U $role -h 127.0.0.1 -d nir_db  -t -A -c "select 1" 2>&1) -join ' ').Trim()
    $env:PGPASSWORD = $store.appDb.password
    $r3 = ((& $psql -U nir_user -h 127.0.0.1 -d nir_db  -t -A -c "select count(*) from weighbridge_records" 2>&1) -join ' ').Trim()
    $r4 = ((& $psql -U nir_user -h 127.0.0.1 -d nir_dev -t -A -c "select 1" 2>&1) -join ' ').Trim()
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    $p1 = 'FAIL'; if ($r1 -match '^\d+$') { $p1 = 'PASS' }
    $p2 = 'FAIL'; if ($r2 -match 'permission denied for database') { $p2 = 'PASS' }
    $p3 = 'FAIL'; if ($r3 -match '^\d+$') { $p3 = 'PASS' }
    A ("     {0}  {1} -> nir_dev : {2}"        -f $p1, $role, $r1)
    A ("     {0}  {1} -> nir_db  : {2}"        -f $p2, $role, $r2)
    A ("     {0}  nir_user -> nir_db  : {1}"   -f $p3, $r3)
    A ("            nir_user -> nir_dev : {0}" -f $r4)

    $shaOf = {
      param($p)
      $j = (Select-String -Path (Join-Path $p '.env') -Pattern '^JWT_SECRET=(.*)$').Matches.Groups[1].Value
      [System.BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($j))).Replace('-', '').Substring(0, 16)
    }
    $hApp = & $shaOf $app
    $hDev = & $shaOf $dev
    $p4 = 'FAIL'; if ($hApp -ne $hDev) { $p4 = 'PASS' }
    A ("     {0}  JWT secrets differ : prod={1} dev={2}" -f $p4, $hApp, $hDev)

    $prodAfter = Health 3000
    A ("step7 prod health after   : $prodAfter   (prod files/processes were never touched)")

    # prod DB ownership must still be nir_user - guards the REASSIGN OWNED class of mistake
    $env:PGPASSWORD = $store.postgres.password
    $owner = ((& $psql -w -U postgres -h 127.0.0.1 -d postgres -t -A -c "select pg_get_userbyid(datdba) from pg_database where datname='nir_db'") -join '').Trim()
    $devOwner = ((& $psql -w -U postgres -h 127.0.0.1 -d postgres -t -A -c "select pg_get_userbyid(datdba) from pg_database where datname='nir_dev'") -join '').Trim()
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    $p5 = 'FAIL'; if ($owner -eq 'nir_user') { $p5 = 'PASS' }
    A ("     {0}  nir_db  owner = nir_user  ({1})" -f $p5, $owner)
    A ("            nir_dev owner = {0}" -f $devOwner)
    return $o
  }
  $res
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
