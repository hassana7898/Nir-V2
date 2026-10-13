# Phase 2 (mobile) - apply migrations\0006_mobile_trip_status.sql to the DEV database (nir_dev)
# and prove the result. LOCAL launcher: the SQL never leaves this script except into the DEV .env
# DATABASE_URL, so there is no way to point it at prod by accident.
#
# What it does:
#   1. sends the migration file to the dev VPS and runs it with psql (idempotent, ASCII-only, guarded
#      to nir_dev by the file's own DO block);
#   2. prints the resulting column + index list so the run is auditable from the log.
#
# Run: .\psremoting\dev-mobile-phase2-db.ps1
$ErrorActionPreference = 'Stop'

$sqlPath = Join-Path $PSScriptRoot '..\migrations\0006_mobile_trip_status.sql'
if (-not (Test-Path $sqlPath)) { throw "missing $sqlPath" }
$sql = [IO.File]::ReadAllText($sqlPath)

# Guard: the file must stay ASCII (it travels over WinRM as base64 and is executed by psql on a
# console with a non-UTF8 code page - the Phase 1 lesson).
$nonAscii = [regex]::Matches($sql, '[^\x00-\x7F]')
if ($nonAscii.Count -gt 0) { throw "0006 contains $($nonAscii.Count) non-ASCII characters" }

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sql))
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
try {
  Invoke-Command -Session $s -ArgumentList $b64 -ScriptBlock {
    param($b64)
    $sql = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $f = 'C:\Windows\Temp\nir-dev-0006-trip-status.sql'
    [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding($false)))
    $url = (Select-String -Path 'C:\Servers\NIR\dev\.env' -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
    if ($url -notmatch '/nir_dev') { throw "DATABASE_URL does not point at nir_dev - refusing to run" }
    $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
    $pg = 'C:\Servers\PostgreSQL\bin\psql.exe'
    "DEV DB: " + ($url -replace '://[^:]+:[^@]+@', '://***:***@')
    & $pg --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "--file=$f" $url
    if ($LASTEXITCODE -ne 0) { throw "psql exited with $LASTEXITCODE" }
    "--- verify ---"
    & $pg --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "--command=SELECT column_name || ' | ' || data_type FROM information_schema.columns WHERE table_name = 'invoices' AND column_name LIKE 'trip%' ORDER BY 1" $url
    & $pg --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "--command=SELECT indexname FROM pg_indexes WHERE tablename = 'invoices' AND indexname = 'idx_invoices_trip_status'" $url
    & $pg --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "--command=SELECT 'reported=' || count(*) FILTER (WHERE trip_status IS NOT NULL) || ' null=' || count(*) FILTER (WHERE trip_status IS NULL) FROM invoices" $url
  } 2>&1
} finally { Remove-PSSession $s }
