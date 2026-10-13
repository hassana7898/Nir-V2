# Local launcher: run scripts\dev-seed-mobile-manager.sql against the DEV database (nir_dev) over WinRM.
# The SQL is DEV-GUARDED (refuses to run outside nir_dev) and idempotent.
$ErrorActionPreference = 'Stop'
$sqlPath = Join-Path $PSScriptRoot '..\scripts\dev-seed-mobile-manager.sql'
if (-not (Test-Path $sqlPath)) { throw "missing $sqlPath" }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($sqlPath))

$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  Invoke-Command -Session $s -ArgumentList $b64 -ScriptBlock {
    param($b64)
    $sql = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $f = 'C:\Windows\Temp\nir-dev-seed-manager.sql'
    [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding($false)))
    $url = (Select-String -Path 'C:\Servers\NIR\dev\.env' -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
    $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
    $pg = 'C:\Servers\PostgreSQL\bin\psql.exe'
    "DB: " + ($url -replace '://[^:]+:[^@]+@', '://***:***@')
    & $pg --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "--file=$f" $url
  } 2>&1
} finally { Remove-PSSession $s }
