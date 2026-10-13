# Local launcher: runs psremoting\_dev-verify-mobile-phase1.ps1 on the VPS over WinRM and mirrors
# its exit code. Verifies the Phase 1 mobile backend end to end against the DEV deployment only.
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  $out = Invoke-Command -Session $s -FilePath (Join-Path $PSScriptRoot '_dev-verify-mobile-phase1.ps1') 2>&1
  $out | ForEach-Object { $_ }
  $failLine = $out | Where-Object { $_ -match '^FAILURES:' } | Select-Object -Last 1
  if ($failLine -and [int]($failLine -replace 'FAILURES:\s*', '') -gt 0) { exit 1 }
} finally {
  Remove-PSSession $s
}
