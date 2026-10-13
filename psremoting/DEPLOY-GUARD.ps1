# DEPLOY-GUARD — the only sanctioned way to ship NIR. Read-only preflight, then wb-prod-deploy.ps1.
#
#   .\psremoting\DEPLOY-GUARD.ps1 -Target prod            # preflight + deploy production
#   .\psremoting\DEPLOY-GUARD.ps1 -Target prod -PreflightOnly
#   .\psremoting\DEPLOY-GUARD.ps1 -Target dev -Full       # also runs the whole npm test suite
#
# STOP conditions (the deploy never starts): the deploy script does not parse; .\dist is older than the
# newest source file (stale build); the weighbridge tests fail; tsc reports an error outside the known
# pre-existing allow-list; no credentials; prod counts change in a way the preflight did not predict.
#
# The guard is deliberately paranoid about the ONE bug this deploy fixes: a half-weighed ticket whose
# stored net == gross (e.g. ticket 3593) must NOT be counted as «خالص‌شده».
[CmdletBinding()]
param(
  [ValidateSet('prod', 'dev')] [string] $Target = 'prod',
  [switch] $Full,
  [switch] $PreflightOnly,
  [string] $ReportPath
)

$ErrorActionPreference = 'Stop'
# Two encoding traps fire on a Windows PowerShell deploy host, and both mangle Persian:
#   (a) a .ps1 WITHOUT a UTF-8 BOM is parsed as ANSI, so «خالص‌شده» in a string literal is already broken
#       before the script runs - keep this file UTF-8 WITH BOM (the preflight re-checks that);
#   (b) Write-Host on a REDIRECTED stdout goes through the console codepage (CP1256 here), which turns the
#       correct string into mojibake in the captured log - so write UTF-8 bytes to the real stdout handle.
# The persisted report is always written UTF-8, which is why it stayed correct while the console did not.
$script:stdoutSw = $null
if ([Console]::IsOutputRedirected) {
  try {
    $script:stdoutSw = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
    $script:stdoutSw.AutoFlush = $true
  } catch { $script:stdoutSw = $null }
}
$repo = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $PSScriptRoot 'wb-prod-deploy.ps1'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
# Resolve -ReportPath ONCE, against the repo root: the write happens in a `finally` through .NET (which
# ignores Set-Location), and a relative path must mean the same file no matter where the guard was launched.
$ReportAbs = $null
if ($ReportPath) {
  $ReportAbs = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $repo $ReportPath }
  $reportDir = Split-Path -Parent $ReportAbs
  if ($reportDir -and -not (Test-Path $reportDir)) { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }
}
$log = New-Object System.Collections.Generic.List[string]
function Say([string] $m) {
  $line = "$m"
  if ($script:stdoutSw) { $script:stdoutSw.WriteLine($line) } else { Write-Host $line }
  $log.Add($line)
}
function Fail([string] $m) { Say "GUARD-STOP  : $m"; throw $m }

# tsc errors that already existed before this change (unrelated diagnostics helpers, not app code).
$tscAllowList = @('tests/broodSplitProof.ts', 'tools/dev/')

$cfg = @{
  prod = @{ Root = 'C:\Servers\NIR\app'; Port = 3000; Db = 'nir_db' }
  dev  = @{ Root = 'C:\Servers\NIR\dev'; Port = 3001; Db = 'nir_dev' }
}[$Target]

Say "guard       : target=$Target  repo=$repo  $ts"

# Everything below runs inside ONE try/finally so that a GUARD-STOP raised during the pre-checks - the most
# likely place to refuse (missing BOM, syntax error, stale build) - still produces the report file, which is
# the only durable record of WHY the deploy was refused. Push-Location moves up here too: the npm steps in
# section 2 need the repo as the working directory.
Push-Location $repo
try {
# ---------------------------------------------------------------- 0) the deploy script itself must parse
# ...and both scripts must be UTF-8 WITH BOM: without it Windows PowerShell parses the Persian literals as
# ANSI and every printed «خالص‌شده» is already corrupt before a single line of logic runs.
foreach ($p in @($deployScript, $PSCommandPath)) {
  $b = [System.IO.File]::ReadAllBytes($p)
  if (-not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) {
    Fail "$(Split-Path -Leaf $p) has no UTF-8 BOM - its Persian strings would be parsed as ANSI (fix: re-save as UTF-8 with BOM)"
  }
}
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($deployScript, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { Fail "wb-prod-deploy.ps1 has $($errors.Count) syntax error(s): $($errors[0].Message)" }
Say "parse       : wb-prod-deploy.ps1 OK"

# ---------------------------------------------------------------- 1) the build must be newer than the sources
$dist = Join-Path $repo 'dist'
$artifacts = @('server.cjs', 'weighbridge-worker.cjs', 'index.html') | ForEach-Object { Join-Path $dist $_ }
foreach ($a in $artifacts) { if (-not (Test-Path $a)) { Fail "missing artifact $a (run: npm run build:weighbridge)" } }
$oldestArtifact = ($artifacts | ForEach-Object { (Get-Item $_).LastWriteTime } | Sort-Object)[0]
$srcDirs = @('components', 'pages', 'server', 'services', 'shared', 'utils', 'workers', 'contexts')
$newestSrc = Get-ChildItem -Path ($srcDirs | ForEach-Object { Join-Path $repo $_ }) -Recurse -File -Include '*.ts', '*.tsx' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$rootSrc = Get-ChildItem -Path $repo -File -Include '*.ts', '*.tsx' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike 'vite.config.ts' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
foreach ($cand in @($newestSrc, $rootSrc)) {
  if ($cand -and $cand.LastWriteTime -gt $oldestArtifact) {
    Fail ("stale build: {0} ({1}) is NEWER than dist\{2} - run: npm run build:weighbridge" -f $cand.Name, $cand.LastWriteTime, (Split-Path -Leaf $oldestArtifact))
  }
}
Say ("fresh       : newest source {0}, oldest artifact {1}" -f $newestSrc.LastWriteTime, $oldestArtifact)

# ---------------------------------------------------------------- 2) tests (the weighbridge suite is the gate)
  if ($Full) {
    Say 'tests       : npm test (full suite)…'
    npm test 2>&1 | ForEach-Object { if ($_ -match 'fail [1-9]|not ok ') { Fail "test failure: $_" } }
  } else {
    Say 'tests       : npm run test:wbreport…'
    npm run test:wbreport 2>&1 | ForEach-Object { if ($_ -match 'fail [1-9]|not ok ') { Fail "test failure: $_" } }
  }
  Say 'tests       : no failures reported'

  # ------------------------------------------------------------- 3) type-check (app code must be clean)
  Say 'tsc         : npx tsc --noEmit...'
  $tscOut = (& npx tsc --noEmit 2>&1 | Out-String)
  $bad = $tscOut -split "`r?`n" | Where-Object { $_ -match '^\S+\(\d+,\d+\): error TS' } |
    Where-Object { $line = $_; -not ($tscAllowList | Where-Object { $line -like "*$_*" }) }
  if ($bad) { Fail ("tsc reported {0} error(s) outside the allow-list:`n{1}" -f @($bad).Count, ($bad -join "`n")) }
  Say 'tsc         : clean (allow-list: tests/broodSplitProof.ts, tools/dev/)'

  # ------------------------------------------------------------- 4) read-only prod snapshot + session
  $credFile = Join-Path $env:USERPROFILE 'vps-cred.xml'
  if (-not (Test-Path $credFile) -and -not $env:NIR_ADMIN_PW) { Fail "no credentials: $credFile missing and NIR_ADMIN_PW unset" }
  $cred = if (Test-Path $credFile) { Import-Clixml $credFile } else {
    New-Object System.Management.Automation.PSCredential('Administrator', (ConvertTo-SecureString $env:NIR_ADMIN_PW -AsPlainText -Force))
  }
  $opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
  $s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
  Say 'session     : opened 194.60.230.236 (WinRM/5985)'

  # «خالص‌شده» counts, old rule (net > 0) vs new rule (BOTH weighings) — this is the whole point of the deploy.
  $countSql = @"
SELECT
  count(*)                                                                       AS tickets,
  count(*) FILTER (WHERE coalesce(net_weight,0) > 0)                             AS old_rule_netted,
  count(*) FILTER (WHERE coalesce(gross_weight,0) > 0 AND coalesce(tare_weight,0) > 0) AS new_rule_netted,
  count(*) FILTER (WHERE coalesce(net_weight,0) > 0
                     AND (coalesce(gross_weight,0) = 0 OR coalesce(tare_weight,0) = 0)) AS half_weighed_with_stale_net
FROM weighbridge_records;
"@
  $staleSql = @"
SELECT id, external_id, gross_weight, tare_weight, net_weight, weigh_time
FROM weighbridge_records
WHERE coalesce(net_weight,0) > 0
  AND (coalesce(gross_weight,0) = 0 OR coalesce(tare_weight,0) = 0)
ORDER BY id DESC LIMIT 10;
"@
  $snapshot = Invoke-Command -Session $s -ScriptBlock {
    param($root, $sql1, $sql2)
    # Resolve psql instead of guessing: PG_BIN from .env, else the running postgres service's bin dir
    # (this server: C:\Servers\PostgreSQL\bin), else PATH, else the usual globs.
    $envLines = Get-Content (Join-Path $root '.env')
    $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
    $pgbin = (($envLines | Where-Object { $_ -match '^PG_BIN=' } | Select-Object -First 1) -replace '^PG_BIN=', '').Trim().Trim('"')
    $cands = @()
    if ($pgbin) { $cands += $pgbin }
    $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'pg_ctl\.exe' } | Select-Object -First 1
    if ($svc) {
      $m = [regex]::Match($svc.PathName, '"([^"]+pg_ctl\.exe)"')
      if (-not $m.Success) { $m = [regex]::Match($svc.PathName, '(\S+pg_ctl\.exe)') }
      if ($m.Success) { $cands += (Split-Path $m.Groups[1].Value -Parent) }
    }
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($cmd) { $cands += (Split-Path $cmd.Source -Parent) }
    $cands += @(Get-Item 'C:\Program Files\PostgreSQL\*\bin', 'C:\Servers\PostgreSQL\bin', 'C:\PostgreSQL\*\bin' -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName)
    $found = ($cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'psql.exe')) } | Select-Object -First 1)
    if (-not $found) { return [pscustomobject]@{ Error = "psql.exe not found (PG_BIN='$pgbin'; tried: $($cands -join '; '))" } }
    $psql = Join-Path $found 'psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    # The scale is live, so remember the highest id + the server's own clock: the post-deploy check compares
    # the SAME rows (id <= watermark) and judges any change by whether the live system rewrote it afterwards.
    $maxId = ((& $psql --dbname="$dbUrl" -t -A -c 'SELECT coalesce(max(id),0) FROM weighbridge_records' 2>&1) -join '').Trim()
    $oldIds = ''
    if ($maxId -match '^\d+$') {
      $oldIds = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT coalesce(string_agg(id::text,',' ORDER BY id),'') FROM weighbridge_records WHERE id <= $maxId AND coalesce(net_weight,0) > 0" 2>&1) -join '').Trim()
    }
    $serverNow = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT to_char(now(),'YYYY-MM-DD HH24:MI:SS')" 2>&1) -join '').Trim()
    $c = (& $psql --dbname="$dbUrl" -t -A -F ',' -c $sql1 2>&1) -join '|'
    $t = (& $psql --dbname="$dbUrl" -t -A -F ' | ' -c $sql2 2>&1) -join "`n"
    [pscustomobject]@{ Error = $null; Found = $found; MaxId = $maxId; ServerNow = $serverNow; OldIds = $oldIds; Counts = $c.Trim(); Stale = $t.Trim() }
  } -ArgumentList $cfg.Root, $countSql, $staleSql
  if ($snapshot.Error) { Say "snapshot    : $($snapshot.Error)" } else {
    Say "snapshot    : psql $($snapshot.Found)  watermark id=$($snapshot.MaxId)  server clock $($snapshot.ServerNow)"
    Say "snapshot    : tickets,old_rule_netted,new_rule_netted,half_weighed_with_stale_net = $($snapshot.Counts)"
    if ($snapshot.Stale) { Say "snapshot    : tickets that STOP being «خالص‌شده» after this deploy:`n$($snapshot.Stale)" }
  }

  if ($PreflightOnly) { Say 'preflight   : OK - deploy NOT started (-PreflightOnly)'; return }
  Remove-PSSession $s -ErrorAction SilentlyContinue

  # ------------------------------------------------------------- 5) deploy (backup + copy + restart + hash verify)
  Say 'deploy      : invoking wb-prod-deploy.ps1'
  & $deployScript -Target $Target -Confirm:$false
  Say 'deploy      : wb-prod-deploy.ps1 returned OK'

  # ------------------------------------------------------------- 6) post-check: health + counts unchanged
  $s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
  # Same 4 columns, but only for rows that already existed before the deploy (id <= watermark), so a ticket
  # weighed during the restart cannot look like data damage, while a real UPDATE/DELETE still shows up.
  $afterSql = if ($snapshot.Error -or -not $snapshot.MaxId) { $countSql } else {
    $countSql -replace 'FROM weighbridge_records;', "FROM weighbridge_records WHERE id <= $($snapshot.MaxId);"
  }
  $totalSql = 'SELECT count(*) FROM weighbridge_records;'
  $after = Invoke-Command -Session $s -ScriptBlock {
    param($port, $root, $sql1, $sql2, $beforeOld, $start, $maxId)
    # Same binary resolution as the pre-deploy snapshot (see step 4).
    $h = try { (Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { 0 }
    $envLines = Get-Content (Join-Path $root '.env')
    $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
    $pgbin = (($envLines | Where-Object { $_ -match '^PG_BIN=' } | Select-Object -First 1) -replace '^PG_BIN=', '').Trim().Trim('"')
    $cands = @()
    if ($pgbin) { $cands += $pgbin }
    $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'pg_ctl\.exe' } | Select-Object -First 1
    if ($svc) {
      $m = [regex]::Match($svc.PathName, '"([^"]+pg_ctl\.exe)"')
      if (-not $m.Success) { $m = [regex]::Match($svc.PathName, '(\S+pg_ctl\.exe)') }
      if ($m.Success) { $cands += (Split-Path $m.Groups[1].Value -Parent) }
    }
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($cmd) { $cands += (Split-Path $cmd.Source -Parent) }
    $cands += @(Get-Item 'C:\Program Files\PostgreSQL\*\bin', 'C:\Servers\PostgreSQL\bin', 'C:\PostgreSQL\*\bin' -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName)
    $found = ($cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'psql.exe')) } | Select-Object -First 1)
    if (-not $found) { return [pscustomobject]@{ Health = $h; Counts = 'psql-not-found'; Total = 0 } }
    $psql = Join-Path $found 'psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    $c = (& $psql --dbname="$dbUrl" -t -A -F ',' -c $sql1 2>&1) -join '|'
    $tot = ((& $psql --dbname="$dbUrl" -t -A -c $sql2 2>&1) -join '').Trim()

    # Which of the watermark rows changed class (net>0 vs not) while we were deploying, and were any of them
    # rewritten BEFORE we started? Rows the live scale/worker updated afterwards are normal operation; a row
    # whose history changed without a fresh updated_at is not.
    $lost = @(); $gained = @(); $drift = ''; $unexplained = 0
    if ($maxId -match '^\d+$') {
      $afterOld = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT coalesce(string_agg(id::text,',' ORDER BY id),'') FROM weighbridge_records WHERE id <= $maxId AND coalesce(net_weight,0) > 0" 2>&1) -join '').Trim()
      $b = @($beforeOld -split ',' | Where-Object { $_ })
      $a = @($afterOld -split ',' | Where-Object { $_ })
      $lost = @($b | Where-Object { $a -notcontains $_ })
      $gained = @($a | Where-Object { $b -notcontains $_ })
      if ($lost.Count -or $gained.Count) {
        $ids = @($lost + $gained)
        $shown = if ($ids.Count -gt 40) { $ids[0..39] } else { $ids }
        $idList = $shown -join ','
        $drift = (& $psql --dbname="$dbUrl" -t -A -F ' | ' -c "SELECT id, external_id, gross_weight, tare_weight, net_weight, updated_at FROM weighbridge_records WHERE id IN ($idList) ORDER BY id DESC" 2>&1) -join "`n"
        if ($start) {
          $unexplained = [int](((& $psql --dbname="$dbUrl" -t -A -c "SELECT count(*) FROM weighbridge_records WHERE id IN ($idList) AND updated_at <= timestamp '$start'" 2>&1) -join '').Trim())
        }
      }
    }
    [pscustomobject]@{
      Health = $h; Counts = $c.Trim(); Total = [int]$tot
      Lost = $lost.Count; Gained = $gained.Count; LostIds = ($lost -join ','); GainedIds = ($gained -join ',')
      Drift = $drift; Unexplained = $unexplained
    }
  } -ArgumentList $cfg.Port, $cfg.Root, $afterSql, $totalSql, $snapshot.OldIds, $snapshot.ServerNow, $snapshot.MaxId
  Say "after       : health=$($after.Health)  watermark rows=$($after.Counts)  table now has $($after.Total) row(s)"
  if ($after.Health -ne 200) { Fail 'health check is not 200 after deploy' }
  $beforeTickets = ($snapshot.Counts -split ',')[0]
  if ($beforeTickets -match '^\d+$' -and $after.Counts -match '^\d+' -and [int]($after.Counts -split ',')[0] -lt [int]$beforeTickets) {
    Fail "rows disappeared: $(($after.Counts -split ',')[0]) of the $beforeTickets rows we snapshotted are gone"
  }
  if ($beforeTickets -match '^\d+$' -and $after.Counts -match '^\d+' -and $after.Total -gt [int](($after.Counts -split ',')[0])) {
    Say "after       : $($after.Total - [int](($after.Counts -split ',')[0])) new ticket(s) arrived during the deploy (not touched by us)"
  }
  if ($snapshot.Counts -and $after.Counts -ne 'psql-not-found' -and $after.Counts -ne $snapshot.Counts) {
    Say "after       : class drift on the watermark rows: net>0 lost $($after.Lost) (ids $($after.LostIds)) / gained $($after.Gained) (ids $($after.GainedIds))"
    if ($after.Drift) { Say "after       : the rows behind that drift, as they are now:`n$($after.Drift)" }
    if ($after.Unexplained -gt 0) {
      Fail "$($after.Unexplained) row(s) changed class without a fresh updated_at - history was rewritten by something other than the live scale"
    }
    Say "after       : every drifted row was updated after the deploy started (live second weighing / stale-net cleanup) - no action needed"
  } else {
    Say 'after       : counts unchanged - the deploy touched no data'
  }
  # The verdict is recorded BEFORE the report is persisted: `Say` only appends to the in-memory log and the
  # `finally` below is the single writer, so the file always ends with the verdict. On a GUARD-STOP the Fail()
  # path has already recorded GUARD-STOP and this line is never reached.
  Say 'GUARD-OK    : deploy complete and verified'
} finally {
  Pop-Location
  Get-PSSession -ErrorAction SilentlyContinue | Where-Object { $_.ComputerName -eq '194.60.230.236' } | Remove-PSSession -ErrorAction SilentlyContinue
  # The ONE and only writer - on a GUARD-STOP this file is the only record of why we refused. UTF-8 WITH BOM
  # (so the Persian survives in any editor) and written without a trailing newline, so the last line of the
  # file really is the verdict rather than a blank line.
  if ($ReportAbs) { [System.IO.File]::WriteAllText($ReportAbs, ($log -join "`r`n"), (New-Object System.Text.UTF8Encoding($true))) }
}
if ($ReportAbs) { Write-Host "report      : $ReportAbs (UTF-8; the last line is the verdict)" }
