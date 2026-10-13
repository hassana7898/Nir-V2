# NIR dev deploy — writes ONLY C:\Servers\NIR\dev (dev.artadan.ir, port 3001, db nir_dev).
#
#   .\psremoting\wb-dev-deploy.ps1                 # build first: npm run build:dev
#   .\psremoting\wb-dev-deploy.ps1 -SkipBackup
#   .\psremoting\wb-dev-deploy.ps1 -WhatIf
#
# Guarantees this script makes (the reason it exists instead of reusing the prod script):
#   * source is .\dist-dev, and the build must be stamped 'dev' by scripts/stamp-build.mjs
#     -> a bundle built for prod can never land in dev, and vice versa
#   * C:\Servers\NIR\app is treated as read-only: fingerprints of app\dist\index.html,
#     app\server.cjs and app\.env are taken before and re-checked after; a mismatch is an error
#   * the prod service/task is never touched; only 'NIR Dev Service' is restarted
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch] $SkipBackup,
  [switch] $SkipRestart
)

$ErrorActionPreference = 'Stop'

$appRoot = 'C:\Servers\NIR\app'     # prod tree - read-only here, asserted before/after
$root    = 'C:\Servers\NIR\dev'     # the only tree this script writes to
$task    = 'NIR Dev Service'
$port    = 3001
$db      = 'nir_dev'

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo 'dist-dev'
if (-not (Test-Path $dist)) { throw "missing $dist  (run: npm run build:dev)" }

$marker = Join-Path $dist 'BUILD-TARGET.txt'
if (-not (Test-Path $marker)) { throw "missing $marker  (run: npm run build:dev - the dev build must be stamped)" }
$builtFor = (Get-Content $marker -Raw).Trim()
if ($builtFor -ne 'dev') { throw "$dist is stamped '$builtFor', not 'dev' - refusing to deploy to dev" }

# real reads even under -WhatIf, so a dry run can show which bundle would ship
$whatIfPref = $WhatIfPreference
$WhatIfPreference = $false
foreach ($need in @('server.cjs', 'server.cjs.map', 'weighbridge-worker.cjs', 'index.html', 'assets')) {
  $p = Join-Path $dist $need
  if (-not (Test-Path $p)) { throw "missing build artifact: $p  (run: npm run build:dev)" }
}
$local = @{}
foreach ($f in @('server.cjs', 'weighbridge-worker.cjs', 'index.html')) {
  $local[$f] = (Get-FileHash (Join-Path $dist $f) -Algorithm SHA256).Hash
}
$bundle = (Get-ChildItem (Join-Path $dist 'assets') -Filter 'index-*.js' | Sort-Object LastWriteTime | Select-Object -Last 1)
$WhatIfPreference = $whatIfPref

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $root "backups\deploy-dev-$ts"
$stage = Join-Path $root "deploy-tmp\$ts"

"target      : dev  ($root, port $port, db $db)"
"source      : $dist  (stamped 'dev')"
"server.cjs  : $($local['server.cjs'].Substring(0, 16))"
"worker      : $($local['weighbridge-worker.cjs'].Substring(0, 16))"
"client      : $($bundle.Name)  $($bundle.Length) bytes"
if (-not $PSCmdlet.ShouldProcess($root, "deploy dev $ts")) { return }

# ---------------------------------------------------------------- session
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
  # -------------------------------------------------------------- 0) prod fingerprint (before)
  $prodBefore = Invoke-Command -Session $s -ScriptBlock {
    param($app)
    @{
      indexHtml = (Get-FileHash "$app\dist\index.html" -Algorithm SHA256).Hash
      serverCjs = (Get-FileHash "$app\server.cjs" -Algorithm SHA256).Hash
      env       = (Get-FileHash "$app\.env" -Algorithm SHA256).Hash
    }
  } -ArgumentList $appRoot
  "prod        : fingerprint taken - prod must be byte-identical when this deploy finishes"

  # -------------------------------------------------------------- 1) dev backup (files + nir_dev dump)
  if (-not $SkipBackup) {
    Invoke-Command -Session $s -ScriptBlock {
      param($root, $bdir)
      $ErrorActionPreference = 'Stop'
      New-Item -ItemType Directory -Force -Path $bdir | Out-Null
      foreach ($f in @('server.cjs', 'dist\server.cjs', 'dist\server.cjs.map', 'dist\index.html',
                       'dist\weighbridge-worker.cjs', 'dist\assets', '.env')) {
        $src = Join-Path $root $f
        if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $bdir ($f -replace '[\\/]', '__')) -Recurse -Force }
      }
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
      $cands += @('C:\Servers\PostgreSQL\bin', 'C:\Program Files\PostgreSQL\16\bin')
      $pgbinFound = ($cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'pg_dump.exe')) } | Select-Object -First 1)
      if (-not $pgbinFound) { throw "pg_dump.exe not found (PG_BIN='$pgbin')" }
      $dump = Join-Path $bdir 'db-nir_dev-before.dump'
      $env:PGCLIENTENCODING = 'UTF8'
      & (Join-Path $pgbinFound 'pg_dump.exe') --dbname="$dbUrl" -Fc -f "$dump" 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "pg_dump of nir_dev failed (exit=$LASTEXITCODE) - refusing to deploy without a backup" }
      "backup      : $bdir  (dev files + .env + nir_dev dump via $pgbinFound)"
    } -ArgumentList $root, $backupDir
  } else {
    "backup      : SKIPPED (-SkipBackup)"
  }

  # -------------------------------------------------------------- 2) stage the dev build on the server
  Invoke-Command -Session $s -ScriptBlock { param($p) New-Item -ItemType Directory -Force -Path $p | Out-Null } -ArgumentList $stage
  Copy-Item -Path (Join-Path $dist '*') -Destination $stage -Recurse -Force -ToSession $s
  $staged = Invoke-Command -Session $s -ScriptBlock {
    param($p)
    (Get-ChildItem $p -Recurse -File | Measure-Object -Property Length -Sum)
  } -ArgumentList $stage
  "stage       : $($staged.Count) file(s), $([math]::Round($staged.Sum / 1MB, 2)) MB -> $stage"

  # -------------------------------------------------------------- 3) copy into dev (index.html last)
  $copy = @(
    "Get-ChildItem '$stage\assets' -File | Copy-Item -Destination '$root\dist\assets\' -Force"
    "if (Test-Path '$stage\fonts') { Copy-Item '$stage\fonts' -Destination '$root\dist\fonts' -Recurse -Force }"
    "if (Test-Path '$stage\favicon.svg') { Copy-Item '$stage\favicon.svg' -Destination '$root\dist\favicon.svg' -Force }"
    "Copy-Item '$stage\server.cjs' -Destination '$root\server.cjs' -Force"
    "Copy-Item '$stage\server.cjs' -Destination '$root\dist\server.cjs' -Force"
    "Copy-Item '$stage\server.cjs.map' -Destination '$root\dist\server.cjs.map' -Force"
    "Copy-Item '$stage\weighbridge-worker.cjs' -Destination '$root\dist\weighbridge-worker.cjs' -Force"
    "Copy-Item '$stage\index.html' -Destination '$root\dist\index.html' -Force"
    # legacy nesting left over from an older deploy layout - dev only, and already backed up above
    "if (Test-Path '$root\dist\assets\assets') { Remove-Item '$root\dist\assets\assets' -Recurse -Force }"
  ) -join '; '
  Invoke-Command -Session $s -ScriptBlock ([scriptblock]::Create('$ErrorActionPreference = ''Stop''; ' + $copy))
  "copy        : assets + fonts + server.cjs + worker + index.html -> $root\dist"

  # -------------------------------------------------------------- 4) restart dev only (prod untouched)
  if (-not $SkipRestart) {
    Invoke-Command -Session $s -ScriptBlock {
      param($task, $root, $port)
      Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Get-Process node -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$root\runtime\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Start-ScheduledTask -TaskName $task
      Start-Sleep -Seconds 4
      "task        : {0} = {1}" -f $task, (Get-ScheduledTask -TaskName $task).State
      $ok = $false
      for ($i = 0; $i -lt 40; $i++) {
        try {
          $r = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
          if ($r.StatusCode -eq 200) { "health      : 200 $($r.Content)"; $ok = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 750
      }
      if (-not $ok) { throw "dev health check failed on port $port after restart" }
    } -ArgumentList $task, $root, $port
  } else {
    "restart     : SKIPPED (-SkipRestart) - the running dev process still serves the OLD bundle"
  }

  # -------------------------------------------------------------- 5) verify the bytes that landed
  $remote = Invoke-Command -Session $s -ScriptBlock {
    param($root)
    $h = @{
      'server.cjs'             = @("$root\server.cjs", "$root\dist\server.cjs") | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }
      'weighbridge-worker.cjs' = @((Get-FileHash "$root\dist\weighbridge-worker.cjs" -Algorithm SHA256).Hash)
      'index.html'             = @((Get-FileHash "$root\dist\index.html" -Algorithm SHA256).Hash)
    }
    $html = Get-Content "$root\dist\index.html" -Raw
    [pscustomobject]@{
      Hashes           = $h
      ReferencedBundle = ([regex]::Matches($html, 'assets/index-[A-Za-z0-9_-]+\.(js|css)') | ForEach-Object { $_.Value }) -join ' '
      Assets           = (Get-ChildItem "$root\dist\assets" | Measure-Object).Count
    }
  } -ArgumentList $root

  $fail = 0
  foreach ($k in $local.Keys) {
    foreach ($h in @($remote.Hashes[$k])) {
      if ($h -ne $local[$k]) { "MISMATCH    : $k $($h.Substring(0, 16)) != local $($local[$k].Substring(0, 16))"; $fail++ }
    }
  }
  if ($fail -eq 0) { "verify      : hashes match on $root (server.cjs x2, worker, index.html)" }
  if ($fail -gt 0) { throw "$fail artifact(s) did not land correctly" }
  "verify      : index.html references $($remote.ReferencedBundle)"
  "verify      : $($remote.Assets) files in dev\dist\assets"
  if ($remote.ReferencedBundle -notmatch [regex]::Escape($bundle.Name)) {
    throw "the deployed index.html does not reference $($bundle.Name) - bundle/index mismatch"
  }
  "verify      : index.html references the freshly built $($bundle.Name)"

  # -------------------------------------------------------------- 6) proof that prod was not touched
  $prodAfter = Invoke-Command -Session $s -ScriptBlock {
    param($app, $port)
    $h = @{
      indexHtml = (Get-FileHash "$app\dist\index.html" -Algorithm SHA256).Hash
      serverCjs = (Get-FileHash "$app\server.cjs" -Algorithm SHA256).Hash
      env       = (Get-FileHash "$app\.env" -Algorithm SHA256).Hash
    }
    $health = 'ERR'
    try { $health = (Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 8).StatusCode } catch { }
    [pscustomobject]@{ Hashes = $h; Health = $health }
  } -ArgumentList $appRoot, 3000

  $drift = 0
  foreach ($k in $prodBefore.Keys) {
    if ($prodAfter.Hashes[$k] -ne $prodBefore[$k]) {
      "PROD DRIFT  : app $k changed! ($($prodBefore[$k].Substring(0, 16)) -> $($prodAfter.Hashes[$k].Substring(0, 16)))"
      $drift++
    }
  }
  if ($drift -gt 0) { throw "$drift prod file(s) changed during a dev deploy - investigate immediately" }
  "prod        : untouched (index.html, server.cjs, .env hashes identical)  health=$($prodAfter.Health)"
  "verify      : staging kept at $stage (rollback copy: $backupDir)"
  "OK          : dev deployed at $ts"
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
