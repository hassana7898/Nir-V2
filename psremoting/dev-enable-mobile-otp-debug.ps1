# psremoting\dev-enable-mobile-otp-debug.ps1
#
# Phase 1, step 1 - enables the DEV-ONLY OTP debug code on the dev VPS.
#
#   .\psremoting\dev-enable-mobile-otp-debug.ps1
#   .\psremoting\dev-enable-mobile-otp-debug.ps1 -SkipRestart
#
# Writes exactly two keys into C:\Servers\NIR\dev\.env:
#   MOBILE_OTP_DEBUG=true  -> the API returns `debugCode` in the OTP request response
#   NIR_ENV=dev            -> second, independent marker: server/services/mobileOtpDebug.ts refuses
#                             the debug code on a production-shaped runtime unless this says 'dev'
#
# Guarantees: dev .env is backed up first; C:\Servers\NIR\app (production) is fingerprinted before
# and after and must not change; only 'NIR Dev Service' is restarted, then /api/health must answer.
param([switch] $SkipRestart)

$ErrorActionPreference = 'Stop'
$devRoot = 'C:\Servers\NIR\dev'
$devEnv  = Join-Path $devRoot '.env'
$appRoot = 'C:\Servers\NIR\app'
$prodEnv = Join-Path $appRoot '.env'
$task    = 'NIR Dev Service'
$port    = 3001

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
    @{
      envHash   = (Get-FileHash $prodEnv -Algorithm SHA256).Hash
      hasOtpKey = (Select-String -Path $prodEnv -Pattern 'MOBILE_OTP_DEBUG' -SimpleMatch -Quiet) -eq $true
      hasNirEnv = (Select-String -Path $prodEnv -Pattern 'NIR_ENV' -SimpleMatch -Quiet) -eq $true
    }
  } -ArgumentList $prodEnv

  "prod .env   : hash $($prodBefore.envHash.Substring(0,16))  MOBILE_OTP_DEBUG=$($prodBefore.hasOtpKey)  NIR_ENV=$($prodBefore.hasNirEnv)"

  $result = Invoke-Command -Session $s -ScriptBlock {
    param($devEnv, $devRoot)

    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $devRoot 'backups'
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
    Copy-Item $devEnv (Join-Path $backupDir ".env-$ts") -Force

    $lines = [System.IO.File]::ReadAllLines($devEnv, [System.Text.Encoding]::UTF8)
    $wanted = [ordered]@{ 'MOBILE_OTP_DEBUG' = 'true'; 'NIR_ENV' = 'dev' }
    $out = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
      $trimmed = $line.Trim()
      $matchedKey = $null
      foreach ($key in $wanted.Keys) {
        if ($trimmed -match ("^\s*" + [regex]::Escape($key) + "\s*=")) { $matchedKey = $key; break }
      }
      if ($null -ne $matchedKey) {
        $out.Add("$matchedKey=$($wanted[$matchedKey])")
        $wanted.Remove($matchedKey)
      } else {
        $out.Add($line)
      }
    }

    if ($wanted.Count -gt 0) {
      if ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -ne '') { $out.Add('') }
      $out.Add('# Phase 1 mobile: dev-only OTP debug code (server/services/mobileOtpDebug.ts)')
      foreach ($key in $wanted.Keys) { $out.Add("$key=$($wanted[$key])") }
    }

    [System.IO.File]::WriteAllLines($devEnv, $out, (New-Object System.Text.UTF8Encoding($false)))

    $verify = [System.IO.File]::ReadAllLines($devEnv, [System.Text.Encoding]::UTF8) |
      Where-Object { $_ -match '^\s*(MOBILE_OTP_DEBUG|NIR_ENV|NODE_ENV|PORT)\s*=' } |
      ForEach-Object { $_ }

    [pscustomobject]@{ Backup = (Join-Path $backupDir ".env-$ts"); Keys = $verify }
  } -ArgumentList $devEnv, $devRoot

  "backup      : $($result.Backup)"
  "dev .env    :"
  foreach ($k in $result.Keys) { "              $k" }

  if (-not $SkipRestart) {
    $health = Invoke-Command -Session $s -ScriptBlock {
      param($task, $root, $port)
      Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Get-Process node -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$root\runtime\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Start-ScheduledTask -TaskName $task
      Start-Sleep -Seconds 4
      for ($i = 0; $i -lt 40; $i++) {
        try {
          $r = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
          if ($r.StatusCode -eq 200) { return "200 $($r.Content)" }
        } catch { }
        Start-Sleep -Milliseconds 750
      }
      throw "dev health check failed on port $port after restart"
    } -ArgumentList $task, $devRoot, $port
    "dev health  : $health"
  } else {
    "dev health  : SKIPPED (-SkipRestart) - the running process still has the OLD environment"
  }

  $prodAfter = Invoke-Command -Session $s -ScriptBlock { param($prodEnv) (Get-FileHash $prodEnv -Algorithm SHA256).Hash } -ArgumentList $prodEnv
  if ($prodAfter -ne $prodBefore.envHash) {
    throw "PROD .env CHANGED during a dev-only operation - investigate immediately"
  }
  "prod        : untouched (.env hash identical)"
  "OK          : dev OTP debug enabled (dev only)"
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
