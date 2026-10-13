# Local launcher: runs psremoting\_dev-db-query.ps1 on the VPS over WinRM.
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  Invoke-Command -Session $s -FilePath (Join-Path $PSScriptRoot '_dev-db-query.ps1') 2>&1
} finally {
  Remove-PSSession $s
}
