# read-only probe of the two app instances (dev 3001 / prod 3000) before any deploy
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
Invoke-Command -Session $s -ScriptBlock {
    Get-ScheduledTask | Where-Object { $_.TaskName -match 'NIR' } | ForEach-Object { "task        : $($_.TaskName) = $($_.State)" }
    "dev dir     : $(Test-Path 'C:\Servers\NIR\dev')"
    if (Test-Path 'C:\Servers\NIR\dev') {
        "dev files   : " + ((Get-ChildItem 'C:\Servers\NIR\dev' -Force | Select-Object -ExpandProperty Name) -join ', ')
    }
    if (Test-Path 'C:\Servers\NIR\dev\.env') {
        $keys = (Get-Content 'C:\Servers\NIR\dev\.env') | Where-Object { $_ -match '^(DATABASE_URL|PG_BIN|PORT|NODE_ENV)=' }
        "dev env     : " + (($keys | ForEach-Object { ($_ -split '=')[0] }) -join ', ')
    }
    if (Test-Path 'C:\Servers\NIR\dev\dist') {
        "dev dist    : " + ((Get-ChildItem 'C:\Servers\NIR\dev\dist' | Select-Object -ExpandProperty Name) -join ', ')
    }
    foreach ($p in @(3000, 3001)) {
        $h = try { (Invoke-WebRequest "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 4).StatusCode } catch { 'down' }
        "health $p    : $h"
    }
    "node procs  : " + ((Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path) -join ', ')
}
Remove-PSSession $s
