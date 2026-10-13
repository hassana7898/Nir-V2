# NIR weighbridge deploy — non-destructive: backup → copy → restart → verify.
# Usage:
#   .\psremoting\wb-prod-deploy.ps1 -Target prod              # production (C:\Servers\NIR\app, port 3000)
#   .\psremoting\wb-prod-deploy.ps1 -Target dev -SkipBackup   # dev (C:\Servers\NIR\dev, port 3001)
#   .\psremoting\wb-prod-deploy.ps1 -Target prod -WhatIf
#
# Deploys exactly what `npm run build:weighbridge` produced in .\dist:
#   .\dist\*  --WinRM copy-->  app\deploy-tmp\<ts>   (staging; the copies below run on the server)
#   stage\assets\*, stage\fonts, stage\favicon.svg -> app\dist\...
#   stage\server.cjs -> app\server.cjs AND app\dist\server.cjs
#   stage\server.cjs.map -> app\dist\server.cjs.map
#   stage\weighbridge-worker.cjs -> app\dist\weighbridge-worker.cjs
#   stage\index.html  -> app\dist\index.html   (LAST: never leave a half-swapped bundle)
# It never deletes data: the only writes are files, and (unless -SkipBackup) a pg_dump + copy of the
# current artifacts into app\backups\<tag> for rollback (see docs\DEPLOYMENT.md §7).
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('prod', 'dev')] [string] $Target = 'prod',
  [switch] $SkipBackup,
  [switch] $SkipRestart
)

$ErrorActionPreference = 'Stop'

$cfg = @{
  prod = @{ Root = 'C:\Servers\NIR\app'; Task = 'NIR Production Service'; Port = 3000; Db = 'nir_db' }
  dev  = @{ Root = 'C:\Servers\NIR\dev'; Task = 'NIR Dev Service';        Port = 3001; Db = 'nir_dev' }
}[$Target]

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo 'dist'
$root = $cfg.Root
$port = $cfg.Port
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $root "backups\deploy-$Target-$ts"
$stage = Join-Path $root "deploy-tmp\$ts"

# ---------------------------------------------------------------- preflight (local)
# Real reads even under -WhatIf (Get-FileHash/Get-Item honour $WhatIfPreference, and a dry run that cannot
# show which bundle would ship is useless). $WhatIfPreference is restored before ShouldProcess below.
$whatIfPref = $WhatIfPreference
$WhatIfPreference = $false
foreach ($need in @('server.cjs', 'server.cjs.map', 'weighbridge-worker.cjs', 'index.html', 'assets')) {
  $p = Join-Path $dist $need
  if (-not (Test-Path $p)) { throw "missing build artifact: $p  (run: npm run build:weighbridge)" }
}
$local = @{}
foreach ($f in @('server.cjs', 'weighbridge-worker.cjs', 'index.html')) {
  $local[$f] = (Get-FileHash (Join-Path $dist $f) -Algorithm SHA256).Hash
}
$bundle = (Get-ChildItem (Join-Path $dist 'assets') -Filter 'index-*.js' | Sort-Object LastWriteTime | Select-Object -Last 1)
# Build provenance (scripts/stamp-build.mjs): a bundle built for dev must never be shipped here.
# A copy that predates the marker only warns, so the pre-marker pipeline keeps working.
$marker = Join-Path $dist 'BUILD-TARGET.txt'
if (Test-Path $marker) {
  $builtFor = (Get-Content $marker -Raw).Trim()
  if ($builtFor -ne 'prod') { throw "dist is stamped '$builtFor', not 'prod' - run: npm run build:weighbridge   (marker: $marker)" }
  "provenance  : dist stamped 'prod'"
} else {
  "provenance  : WARNING - $marker missing (legacy build). Run npm run build:weighbridge to stamp it."
}
"target      : $Target  ($root, port $port, db $($cfg.Db))"
"server.cjs  : $($local['server.cjs'].Substring(0,16))"
"worker      : $($local['weighbridge-worker.cjs'].Substring(0,16))"
"client      : $($bundle.Name)  $($bundle.Length) bytes"
$WhatIfPreference = $whatIfPref
if (-not $PSCmdlet.ShouldProcess($root, "deploy $ts")) { return }


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
  # -------------------------------------------------------------- 1) backup (files + logical DB dump)
  if (-not $SkipBackup) {
    Invoke-Command -Session $s -ScriptBlock {
      param($root, $bdir, $db)
      $ErrorActionPreference = 'Stop'
      New-Item -ItemType Directory -Force -Path $bdir | Out-Null
      foreach ($f in @('server.cjs', 'dist\server.cjs', 'dist\server.cjs.map', 'dist\index.html',
                       'dist\weighbridge-worker.cjs', 'dist\assets', '.env')) {
        $src = Join-Path $root $f
        if (Test-Path $src) {
          $flat = ($f -replace '[\\/]', '__')
          Copy-Item -LiteralPath $src -Destination (Join-Path $bdir $flat) -Recurse -Force
        }
      }
      $envLines = Get-Content (Join-Path $root '.env')
      $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
      # Find the binaries instead of guessing: PG_BIN from .env, else the running postgres service's own bin
      # dir (this server keeps PostgreSQL at C:\Servers\PostgreSQL\bin), else PATH, else the usual globs.
      $pgbin = (($envLines | Where-Object { $_ -match '^PG_BIN=' } | Select-Object -First 1) -replace '^PG_BIN=', '').Trim().Trim('"')
      $cands = @()
      if ($pgbin) { $cands += $pgbin }
      $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'pg_ctl\.exe' } | Select-Object -First 1
      if ($svc) {
        $m = [regex]::Match($svc.PathName, '"([^"]+pg_ctl\.exe)"')
        if (-not $m.Success) { $m = [regex]::Match($svc.PathName, '(\S+pg_ctl\.exe)') }
        if ($m.Success) { $cands += (Split-Path $m.Groups[1].Value -Parent) }
      }
      $cmd = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
      if ($cmd) { $cands += (Split-Path $cmd.Source -Parent) }
      $cands += @(Get-Item 'C:\Program Files\PostgreSQL\*\bin', 'C:\Servers\PostgreSQL\bin', 'C:\PostgreSQL\*\bin' -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName)
      $pgbinFound = ($cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'pg_dump.exe')) } | Select-Object -First 1)
      if (-not $pgbinFound) { throw "pg_dump.exe not found (PG_BIN='$pgbin'; tried: $($cands -join '; '))" }
      $dump = Join-Path $bdir 'db-before-deploy.dump'
      $env:PGCLIENTENCODING = 'UTF8'
      & (Join-Path $pgbinFound 'pg_dump.exe') --dbname="$dbUrl" -Fc -f "$dump" 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit=$LASTEXITCODE) - refusing to deploy without a backup" }
      "backup      : $bdir  (pg_dump ok from $pgbinFound, db=$db)"
    } -ArgumentList $root, $backupDir, $cfg.Db
  } else {
    "backup      : SKIPPED (-SkipBackup)"
  }

  # -------------------------------------------------------------- 2) stage the local build on the server
  # The artifacts live in .\dist on THIS machine; the copy below runs on the server, so the tree has to
  # be transferred first (WinRM file copy) or the remote paths would be local ones.
  Invoke-Command -Session $s -ScriptBlock {
    param($p)
    New-Item -ItemType Directory -Force -Path $p | Out-Null
  } -ArgumentList $stage
  Copy-Item -Path (Join-Path $dist '*') -Destination $stage -Recurse -Force -ToSession $s
  $staged = Invoke-Command -Session $s -ScriptBlock {
    param($p)
    (Get-ChildItem $p -Recurse -File | Measure-Object -Property Length -Sum)
  } -ArgumentList $stage
  "stage       : $($staged.Count) file(s), $([math]::Round($staged.Sum / 1MB, 2)) MB -> $stage"

  # -------------------------------------------------------------- 3) copy artifacts (index.html last)
  $copy = @(
    "Get-ChildItem '$stage\assets' -File | Copy-Item -Destination '$root\dist\assets\' -Force"
    "if (Test-Path '$stage\fonts') { Copy-Item '$stage\fonts' -Destination '$root\dist\fonts' -Recurse -Force }"
    "if (Test-Path '$stage\favicon.svg') { Copy-Item '$stage\favicon.svg' -Destination '$root\dist\favicon.svg' -Force }"
    "Copy-Item '$stage\server.cjs' -Destination '$root\server.cjs' -Force"
    "Copy-Item '$stage\server.cjs' -Destination '$root\dist\server.cjs' -Force"
    "Copy-Item '$stage\server.cjs.map' -Destination '$root\dist\server.cjs.map' -Force"
    "Copy-Item '$stage\weighbridge-worker.cjs' -Destination '$root\dist\weighbridge-worker.cjs' -Force"
    "Copy-Item '$stage\index.html' -Destination '$root\dist\index.html' -Force"
  ) -join '; '
  Invoke-Command -Session $s -ScriptBlock ([scriptblock]::Create('$ErrorActionPreference = ''Stop''; ' + $copy))
  "copy        : assets + fonts + server.cjs + worker + index.html -> $root\dist"

  # -------------------------------------------------------------- 4) restart the service task
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
      if (-not $ok) { throw "health check failed on port $port after restart" }
    } -ArgumentList $cfg.Task, $root, $port
  } else {
    "restart     : SKIPPED (-SkipRestart) - the running process still serves the OLD bundle"
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
      if ($h -ne $local[$k]) { "MISMATCH    : $k $($h.Substring(0,16)) != local $($local[$k].Substring(0,16))"; $fail++ }
    }
  }
  if ($fail -eq 0) { "verify      : hashes match on $root (server.cjs x2, worker, index.html)" }
  if ($fail -gt 0) { throw "$fail artifact(s) did not land correctly" }
  "verify      : index.html references $($remote.ReferencedBundle)"
  "verify      : $($remote.Assets) files in dist\assets"
  # The bundle the fresh index.html points at must be the one just built (guards against a stale/mis-copied pair).
  if ($remote.ReferencedBundle -notmatch [regex]::Escape($bundle.Name)) {
    throw "the deployed index.html does not reference $($bundle.Name) - bundle/index mismatch"
  }
  "verify      : index.html references the freshly built $($bundle.Name)"
  "verify      : staging kept at $stage (rollback copy: $backupDir)"

  "OK          : $Target deployed at $ts"
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}

