# psremoting\dev-mobile-phase1-db.ps1
#
# Phase 1, step 1 - applies the mobile data layer to the DEV database only (nir_dev).
#
#   .\psremoting\dev-mobile-phase1-db.ps1
#   .\psremoting\dev-mobile-phase1-db.ps1 -SkipBackup
#
# Runs, in order, via psql with ON_ERROR_STOP=1 (SQL is piped on stdin and is deliberately
# ASCII-only, so nothing can be mangled by a console code page):
#   1. migrations/0005_mobile_driver_link.sql    -> invoices.driver_id FK (+ index)
#   2. scripts/backfill-invoice-drivers.sql      -> name -> id data backfill (idempotent)
#   3. scripts/dev-seed-mobile-phase1.sql        -> 1 DRIVER + 1 FARMER test account, 5 farmer phones
#   4. verification queries (counts) for the report
#
# Safety: a pg_dump of nir_dev is taken first; the production tree (C:\Servers\NIR\app) is
# fingerprinted before/after and its database name is reported, so nobody can claim prod was touched.
param([switch] $SkipBackup)

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$db      = 'nir_dev'
$pgBin   = 'C:\Servers\PostgreSQL\bin'
$devRoot = 'C:\Servers\NIR\dev'
$appRoot = 'C:\Servers\NIR\app'
$prodEnv = Join-Path $appRoot '.env'

function Read-SqlFile([string] $relative) {
  $path = Join-Path $repo $relative
  if (-not (Test-Path $path)) { throw "missing SQL file: $path" }
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  foreach ($ch in $text.ToCharArray()) {
    # U+FEFF is the file's own BOM marker (harmless); anything else non-ASCII must be fixed because
    # this transport hands the SQL to psql through a console code page.
    if ([int]$ch -gt 127 -and $ch -ne [char]0xFEFF) {
      throw "$relative contains non-ASCII characters; this transport is ASCII-only"
    }
  }
  return $text
}

$sqlSchema   = Read-SqlFile 'migrations\0005_mobile_driver_link.sql'
$sqlBackfill = Read-SqlFile 'scripts\backfill-invoice-drivers.sql'
$sqlSeed     = Read-SqlFile 'scripts\dev-seed-mobile-phase1.sql'
"local sql   : 0005 ($($sqlSchema.Length) chars), backfill ($($sqlBackfill.Length)), seed ($($sqlSeed.Length)) - all ASCII"

$credFile = Join-Path $env:USERPROFILE 'vps-cred.xml'
if (Test-Path $credFile) {
  $cred = Import-Clixml $credFile
} else {
  if (-not $env:NIR_ADMIN_PW) { throw "no credentials: expected $credFile (or `$env:NIR_ADMIN_PW)" }
  $cred = New-Object System.Management.Automation.PSCredential('Administrator', (ConvertTo-SecureString $env:NIR_ADMIN_PW -AsPlainText -Force))
}
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
"session     : opened to 194.60.230.236 (WinRM/5985)"

try {
  $prodBefore = Invoke-Command -Session $s -ScriptBlock {
    param($prodEnv)
    $dbName = 'unknown'
    $line = Get-Content $prodEnv | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if ($line) {
      $url = ($line -split '=', 2)[1].Trim()
      if ($url -match '/([^/?]+)(\?|$)') { $dbName = $Matches[1] }
    }
    @{ envHash = (Get-FileHash $prodEnv -Algorithm SHA256).Hash; dbName = $dbName }
  } -ArgumentList $prodEnv

  "prod .env   : hash $($prodBefore.envHash.Substring(0,16))  prod DATABASE_URL points at '$($prodBefore.dbName)'"
  if ($prodBefore.dbName -eq $db) { throw "production .env points at $db - refusing to continue" }


  # ---------------------------------------------------------------- 1) backup
  if (-not $SkipBackup) {
    $backup = Invoke-Command -Session $s -ScriptBlock {
      param($pgBin, $devRoot, $db)
      $dir = Join-Path $devRoot 'backups'
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $file = Join-Path $dir ("db-$db-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')

      # WinRM cannot answer an interactive password prompt: take the connection string from the dev
      # .env (same pattern as psremoting/_dev-db-query.ps1) and pass -w so pg_dump fails fast
      # instead of hanging. $url is asserted to point at nir_dev before anything is run.
      $url = (Select-String -Path (Join-Path $devRoot '.env') -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
      if ($url -notmatch ('/' + $db + '(\?|$)')) { throw "dev .env DATABASE_URL does not point at $db - refusing to continue" }
      $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value

      $out = & (Join-Path $pgBin 'pg_dump.exe') -w -d $url -f $file --no-owner --no-privileges 2>&1
      $code = $LASTEXITCODE
      [pscustomobject]@{
        File  = $file
        Bytes = if (Test-Path $file) { (Get-Item $file).Length } else { 0 }
        Code  = $code
        Out   = ($out | Select-Object -First 3) -join ' | '
      }
    } -ArgumentList $pgBin, $devRoot, $db

    if ($backup.Code -ne 0) { throw "pg_dump failed (exit $($backup.Code)): $($backup.Out)" }
    "backup      : $($backup.File) ($([math]::Round($backup.Bytes / 1KB, 1)) KB)"
  } else {
    "backup      : SKIPPED (-SkipBackup)"
  }

  # ---------------------------------------------------------------- 2) migrations + seed
  $run = Invoke-Command -Session $s -ScriptBlock {
    param($pgBin, $db, $devRoot, $schema, $backfill, $seed)
    $psql = Join-Path $pgBin 'psql.exe'
    $log = New-Object System.Collections.Generic.List[string]

    $url = (Select-String -Path (Join-Path $devRoot '.env') -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
    if ($url -notmatch ('/' + $db + '(\?|$)')) { return [pscustomobject]@{ Ok = $false; Log = @("dev .env DATABASE_URL does not point at $db") } }
    $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
    $log.Add("endpoint: " + ($url -replace '://[^:]+:[^@]+@', '://***:***@'))

    $steps = @(
      @{ Name = '0005_mobile_driver_link'; Sql = $schema }
      @{ Name = 'backfill-invoice-drivers'; Sql = $backfill }
      @{ Name = 'dev-seed-mobile-phase1'; Sql = $seed }
    )

    foreach ($step in $steps) {
      $log.Add("--- $($step.Name) ---")
      $out = $step.Sql | & $psql -w -d $url -v ON_ERROR_STOP=1 -q 2>&1
      $code = $LASTEXITCODE
      foreach ($line in $out) { $log.Add([string]$line) }
      $log.Add("exit=$code")
      if ($code -ne 0) { return [pscustomobject]@{ Ok = $false; Log = $log } }
    }

    return [pscustomobject]@{ Ok = $true; Log = $log }
  } -ArgumentList $pgBin, $db, $devRoot, $sqlSchema, $sqlBackfill, $sqlSeed

  foreach ($line in $run.Log) { "              $line" }
  if (-not $run.Ok) { throw "a database step failed on $db (see log above)" }


  # ---------------------------------------------------------------- 3) verification report
  $reportSql = @"
SELECT 'invoices total' AS metric, count(*)::text AS value FROM invoices
UNION ALL SELECT 'invoices with driver_id (FK)', count(*)::text FROM invoices WHERE driver_id IS NOT NULL
UNION ALL SELECT 'test users (DRIVER/FARMER)', count(*)::text FROM users WHERE id IN ('usr-mobile-test-driver','usr-mobile-test-farmer')
UNION ALL SELECT 'drivers with phone 09120000001', count(*)::text FROM drivers WHERE phone = '09120000001'
UNION ALL SELECT 'farmers with seeded phones', count(*)::text FROM farmers WHERE phone IN ('09120000002','09121000001','09121000002','09121000003','09121000004','09121000005')
ORDER BY 1;
"@

  $report = Invoke-Command -Session $s -ScriptBlock {
    param($pgBin, $db, $devRoot, $sql)
    $psql = Join-Path $pgBin 'psql.exe'
    $url = (Select-String -Path (Join-Path $devRoot '.env') -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
    if ($url -notmatch ('/' + $db + '(\?|$)')) { return @("dev .env DATABASE_URL does not point at $db") }
    $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
    $sql | & $psql -w -d $url -q 2>&1
  } -ArgumentList $pgBin, $db, $devRoot, $reportSql

  "verification:"
  foreach ($line in $report) { "              $line" }

  # ---------------------------------------------------------------- 4) prod untouched
  $prodAfter = Invoke-Command -Session $s -ScriptBlock { param($prodEnv) (Get-FileHash $prodEnv -Algorithm SHA256).Hash } -ArgumentList $prodEnv
  if ($prodAfter -ne $prodBefore.envHash) { throw "PROD .env CHANGED - investigate immediately" }
  "prod        : untouched (.env hash identical, prod database never opened)"
  "OK          : $db migrated, backfilled and seeded"
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
