# Local launcher: run scripts\dev-seed-mobile-manager.sql against the DEV database (nir_dev) over WinRM.
# The SQL is DEV-GUARDED (refuses to run outside nir_dev) and idempotent.
#
#   .\psremoting\dev-seed-mobile-manager.ps1                       # shared dev test manager (09120000003)
#   .\psremoting\dev-seed-mobile-manager.ps1 -Phone 09123456789    # bind that number to the MANAGER role
#
# NOTE: a number that already belongs to a driver or a farmer still logs in as DRIVER/FARMER, because
# mobileAuth resolves drivers.phone -> farmers.phone -> users.phone in that order. The SQL reports that
# case as a SHADOW line - read the output, it is the difference between "seeded" and "works".
param(
  [string]$Phone = '09120000003'
)

$ErrorActionPreference = 'Stop'

# The number is interpolated into SQL, so normalise and validate it here (also accepts +989XXXXXXXXX).
$digits = ($Phone -replace '\D', '')
if ($digits.Length -eq 12 -and $digits.StartsWith('98')) { $digits = '0' + $digits.Substring(2) }
if ($digits.Length -ne 11 -or -not $digits.StartsWith('09')) {
  throw "Phone '$Phone' is not an Iranian mobile number (expected 09XXXXXXXXX)."
}
$Phone = $digits

$sqlPath = Join-Path $PSScriptRoot '..\scripts\dev-seed-mobile-manager.sql'
if (-not (Test-Path $sqlPath)) { throw "missing $sqlPath" }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($sqlPath))

$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  Invoke-Command -Session $s -ArgumentList $b64, $Phone -ScriptBlock {
    param($b64, $phone)
    $sql = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $f = 'C:\Windows\Temp\nir-dev-seed-manager.sql'
    [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding($false)))
    $url = (Select-String -Path 'C:\Servers\NIR\dev\.env' -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
    if ($url -notmatch '/nir_dev') { throw "DATABASE_URL does not point at nir_dev - refusing to run" }
    $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
    $pg = 'C:\Servers\PostgreSQL\bin\psql.exe'
    "DB: " + ($url -replace '://[^:]+:[^@]+@', '://***:***@')
    "PHONE: $phone"
    & $pg --set=ON_ERROR_STOP=1 --set="phone=$phone" --quiet --tuples-only --no-align "--file=$f" $url
    if ($LASTEXITCODE -ne 0) { throw "psql exited with $LASTEXITCODE" }
  } 2>&1
} finally { Remove-PSSession $s }
