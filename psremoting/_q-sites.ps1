# Local launcher for psremoting\_q-sites-remote.ps1 (read-only env-key + weighbridge-source probe).
$ErrorActionPreference = 'Stop'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  $b64 = Invoke-Command -Session $s -FilePath (Join-Path $PSScriptRoot '_q-sites-remote.ps1') 2>&1
  $raw = ($b64 | Where-Object { $_ -is [string] }) -join ''
  $target = Join-Path $PSScriptRoot '..\logs\q-sites.txt'
  [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($raw))
  Get-Content $target -Encoding UTF8
} finally {
  Remove-PSSession $s
}
