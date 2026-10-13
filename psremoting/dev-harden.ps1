# Phase A / step 2 — make the dev environment self-sufficient and self-healing.
#
# Adds, all strictly dev-scoped (prod files/tasks/PG objects are never touched):
#   * C:\Servers\NIR\scripts\RUN-DEV-HEALTH.ps1  + task 'NIR Dev Health'   (every 10 min, restarts dev if down)
#   * C:\Servers\NIR\scripts\RUN-DEV-BACKUP.ps1  + task 'NIR Dev Backup'   (daily, dumps nir_dev + uploads)
#   * RUN-WEIGHBRIDGE-SYNC.ps1 honours WEIGHBRIDGE_SYNC_ENABLED from dev\.env (pause the live-scale poll)
#   * dev\.env WEIGHBRIDGE_COLUMN_MAP aligned with prod (adds direction / goods / remittanceNumber)
# Task triggers/settings/principal are cloned from the existing prod tasks, so scheduling semantics match.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File psremoting\dev-harden.ps1
[CmdletBinding()]
param([switch] $SkipTasks)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  Invoke-Command -Session $s -ArgumentList $stamp, $SkipTasks.IsPresent -ScriptBlock {
    param($stamp, $skipTasks)
    $o = New-Object System.Collections.Generic.List[string]
    function A([string] $t) { $o.Add($t) }
    function Health([int] $p) {
      try { (Invoke-WebRequest "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 8).StatusCode } catch { 'ERR' }
    }

    $dev = 'C:\Servers\NIR\dev'
    $scripts = 'C:\Servers\NIR\scripts'
    $bak = Join-Path $dev "backups\hardening-$stamp"
    New-Item -ItemType Directory -Force -Path $bak | Out-Null
    Copy-Item (Join-Path $scripts 'RUN-WEIGHBRIDGE-SYNC.ps1') $bak -Force
    Copy-Item (Join-Path $dev '.env') $bak -Force
    A "step0 prod health before : $(Health 3000)"
    A "step1 backups            : $bak (previous RUN-WEIGHBRIDGE-SYNC.ps1 + dev\.env)"

    # ---------------------------------------------------------------- dev health watchdog
    $health = @'
$ErrorActionPreference = 'SilentlyContinue'
$dev = 'C:\Servers\NIR\dev'
$log = Join-Path $dev 'logs'
New-Item -ItemType Directory -Force -Path $log | Out-Null
$out = @()
$out += 'time=' + (Get-Date).ToString('s')
$listening = ((Get-NetTCPConnection -State Listen -LocalPort 3001) -ne $null)
if (-not $listening) {
  Start-ScheduledTask 'NIR Dev Service'
  $out += 'ACTION=started_nir_dev'
  for ($i = 0; $i -lt 20; $i++) { if ((Get-NetTCPConnection -State Listen -LocalPort 3001)) { break }; Start-Sleep -Seconds 1 }
}
$out += 'port3001=' + ((Get-NetTCPConnection -State Listen -LocalPort 3001) -ne $null)
try { $out += 'health=' + (Invoke-WebRequest 'http://127.0.0.1:3001/api/health' -UseBasicParsing -TimeoutSec 8).Content } catch { $out += 'health=ERR' }
$out += 'ram_free_MB=' + [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB, 0)
$out += 'disk_free_GB=' + [math]::Round(((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace / 1GB), 2)
$file = Join-Path $log 'health.log'
($out -join ' | ') | Add-Content $file
if ((Get-Item $file).Length -gt 1MB) { Get-Content $file | Select-Object -Last 200 | Set-Content $file }
'@
    Set-Content -Path (Join-Path $scripts 'RUN-DEV-HEALTH.ps1') -Value $health -Encoding UTF8
    A 'step2 dev health         : RUN-DEV-HEALTH.ps1 written (port 3001 + /api/health, restarts only NIR Dev Service)'

    # ---------------------------------------------------------------- dev backup
    $backup = @'
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dev = 'C:\Servers\NIR\dev'
$backups = Join-Path $dev 'backups'
$logs = Join-Path $dev 'logs'
New-Item -ItemType Directory -Force -Path $backups, $logs | Out-Null
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmp = Join-Path $backups "_tmp-$ts"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$envLines = Get-Content (Join-Path $dev '.env')
$dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
$env:PGCLIENTENCODING = 'UTF8'
& 'C:\Servers\PostgreSQL\bin\pg_dump.exe' --dbname="$dbUrl" -Fc -f "$tmp\nir_dev.dump" 2>$null | Out-Null
$dbOk = ($LASTEXITCODE -eq 0)
$upSrc = Join-Path $dev 'uploads'
New-Item -ItemType Directory -Force -Path $upSrc | Out-Null
$up = Get-ChildItem $upSrc -Force
if ($up) { Compress-Archive -Path "$upSrc\*" -DestinationPath "$tmp\uploads.zip" -Force }
else { $az = [System.IO.Compression.ZipFile]::Open("$tmp\uploads.zip", [System.IO.Compression.ZipArchiveMode]::Create); $az.Dispose() }
Copy-Item (Join-Path $dev '.env') (Join-Path $tmp 'dev.env.bak') -Force
"created=$ts host=$env:COMPUTERNAME db=nir_dev dbOk=$dbOk uploadsFiles=$(@($up).Count)" | Set-Content "$tmp\manifest.txt"
$zip = Join-Path $backups "nir-dev-backup-$ts.zip"
Compress-Archive -Path "$tmp\*" -DestinationPath $zip -Force
Remove-Item $tmp -Recurse -Force
Get-ChildItem $backups -Filter 'nir-dev-backup-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 | Remove-Item -Force
"[$ts] backup=$zip dbOk=$dbOk" | Add-Content (Join-Path $logs 'backup.log')
'@
    Set-Content -Path (Join-Path $scripts 'RUN-DEV-BACKUP.ps1') -Value $backup -Encoding UTF8
    A 'step3 dev backup         : RUN-DEV-BACKUP.ps1 written (nir_dev dump + uploads + .env, 7 copies kept)'

    # ---------------------------------------------------------------- weighbridge sync: dev kill switch
    $sync = @'
$ErrorActionPreference = 'Continue'
$dev = 'C:\Servers\NIR\dev'
Set-Location $dev
New-Item -ItemType Directory -Force -Path "$dev\logs" | Out-Null
# dev-only kill switch: WEIGHBRIDGE_SYNC_ENABLED=false in dev\.env pauses polling of the plant's
# live scale (100.71.164.40) without touching this task or the production sync at all.
$enabled = $true
$envFile = Join-Path $dev '.env'
if (Test-Path $envFile) {
  $line = (Get-Content $envFile | Where-Object { $_ -match '^\s*WEIGHBRIDGE_SYNC_ENABLED\s*=' } | Select-Object -First 1)
  if ($line) { $enabled = (((($line -split '=', 2)[1]).Trim().Trim('"')).ToLower() -notin @('false', '0', 'no', 'off')) }
}
if (-not $enabled) {
  "[$(Get-Date -Format s)] weighbridge sync SKIPPED (WEIGHBRIDGE_SYNC_ENABLED=false in dev\.env)" | Add-Content (Join-Path $dev 'logs\weighbridge-worker.log')
  exit 0
}
& "$dev\runtime\node.exe" "$dev\dist\weighbridge-worker.cjs" --once 2>&1 | ForEach-Object { $_ }
exit 0
'@
    Set-Content -Path (Join-Path $scripts 'RUN-WEIGHBRIDGE-SYNC.ps1') -Value $sync -Encoding UTF8
    A 'step4 sync runner        : dev sync now honours WEIGHBRIDGE_SYNC_ENABLED (prod runner untouched)'

    # ---------------------------------------------------------------- dev COLUMN_MAP aligned with prod
    $envPath = Join-Path $dev '.env'
    $text = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
    $fullMap = 'WEIGHBRIDGE_COLUMN_MAP={"externalId":"ID","ticketNumber":"ShomareHavale","plateNumber":"TruckNo","driverName":"DriverName","grossWeight":"WeightFull","tareWeight":"WeightEmpty","netWeight":"NetWeight","weighTime":"DateFull","direction":"InOutFlag","goods":"Goods","remittanceNumber":"ShomareHavale"}'
    if ($text -match '(?m)^WEIGHBRIDGE_COLUMN_MAP=.*$') {
      $text = $text -replace '(?m)^WEIGHBRIDGE_COLUMN_MAP=.*$', $fullMap
      [System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding($false)))
      A 'step5 column map         : dev WEIGHBRIDGE_COLUMN_MAP aligned with prod (direction/goods/remittanceNumber restored)'
    } else {
      A 'step5 column map         : SKIPPED - no WEIGHBRIDGE_COLUMN_MAP line in dev\.env'
    }

    # ---------------------------------------------------------------- dev tasks (triggers/settings cloned from prod)
    if (-not $skipTasks) {
      foreach ($pair in @(, @('NIR Health Check', 'NIR Dev Health', 'RUN-DEV-HEALTH.ps1')) + @(, @('NIR Daily Backup', 'NIR Dev Backup', 'RUN-DEV-BACKUP.ps1'))) {
        $srcName = $pair[0]; $newName = $pair[1]; $file = $pair[2]
        $src = Get-ScheduledTask -TaskName $srcName -ErrorAction SilentlyContinue
        if (-not $src) { A ("step6 task               : {0} SKIPPED - '{1}' not found" -f $newName, $srcName); continue }
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $scripts $file))
        Register-ScheduledTask -TaskName $newName -Action $action -Trigger $src.Triggers -Settings $src.Settings -Principal $src.Principal -Force | Out-Null
        A ("step6 task               : {0} registered (trigger/settings cloned from '{1}')" -f $newName, $srcName)
      }
    } else {
      A 'step6 task               : SKIPPED (-SkipTasks)'
    }

    # ---------------------------------------------------------------- verify by running both new tasks once
    A 'step7 verify:'
    if (-not $skipTasks) {
      foreach ($n in @('NIR Dev Health', 'NIR Dev Backup')) {
        $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
        $state = 'MISSING'
        if ($t) { $state = $t.State }
        A ("     task              : {0} state={1}" -f $n, $state)
      }
      Start-ScheduledTask -TaskName 'NIR Dev Backup'
      Start-Sleep -Seconds 12
      Start-ScheduledTask -TaskName 'NIR Dev Health'
      Start-Sleep -Seconds 8
      $bl = Get-Content (Join-Path $dev 'logs\backup.log') -Tail 1 -ErrorAction SilentlyContinue
      $hl = Get-Content (Join-Path $dev 'logs\health.log') -Tail 1 -ErrorAction SilentlyContinue
      A ('     dev backup.log    : ' + ($bl -join ''))
      A ('     dev health.log    : ' + ($hl -join ''))
      A ('     dev backup zips   : ' + ((Get-ChildItem (Join-Path $dev 'backups') -Filter 'nir-dev-backup-*.zip' -ErrorAction SilentlyContinue | Measure-Object).Count))
    }
    A ("step8 prod health after  : $(Health 3000)   (prod untouched)")
    A ("       dev  health after : $(Health 3001)")
    return $o
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
