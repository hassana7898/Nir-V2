# Validates the guard's drift-diagnosis algorithm against the REAL dev database, using the same queries the
# guard runs, with a deliberately doctored "before" set so both branches (explained / unexplained) execute.
# Read-only: no writes anywhere.
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
$maxId = 461121
$real = Invoke-Command -Session $s -ScriptBlock {
    param($root, $maxId)
    $envLines = Get-Content (Join-Path $root '.env')
    $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    $ids = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT coalesce(string_agg(id::text,',' ORDER BY id),'') FROM weighbridge_records WHERE id <= $maxId AND coalesce(net_weight,0) > 0" 2>&1) -join '').Trim()
    $clock = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT to_char(now(),'YYYY-MM-DD HH24:MI:SS')" 2>&1) -join '').Trim()
    # the 5 stale rows on dev (net==gross, no tare) - these must be reported as an unexplained drift
    $stale = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT string_agg(id::text,',') FROM weighbridge_records WHERE coalesce(net_weight,0) > 0 AND (coalesce(gross_weight,0)=0 OR coalesce(tare_weight,0)=0)" 2>&1) -join '').Trim()
    [pscustomobject]@{ Ids = $ids; Clock = $clock; Stale = $stale }
} -ArgumentList 'C:\Servers\NIR\dev', $maxId

# --- mirror of the guard's algorithm (DEPLOY-GUARD.ps1 step 6) ---
function Judge([string] $beforeOld, [string] $afterOld, [string] $start, [string] $idList) {
    $b = @($beforeOld -split ',' | Where-Object { $_ })
    $a = @($afterOld -split ',' | Where-Object { $_ })
    $lost = @($b | Where-Object { $a -notcontains $_ })
    $gained = @($a | Where-Object { $b -notcontains $_ })
    if (-not ($lost.Count -or $gained.Count)) { return [pscustomobject]@{ Lost = 0; Gained = 0; Unexplained = $null } }
    $shown = if ($lost.Count + $gained.Count -gt 40) { @($lost + $gained)[0..39] } else { @($lost + $gained) }
    $u = Invoke-Command -Session $s -ScriptBlock {
        param($root, $ids, $start)
        $envLines = Get-Content (Join-Path $root '.env')
        $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
        $rows = (& 'C:\Servers\PostgreSQL\bin\psql.exe' --dbname="$dbUrl" -t -A -F ' | ' -c "SELECT id, gross_weight, tare_weight, net_weight, updated_at FROM weighbridge_records WHERE id IN ($ids) ORDER BY id DESC" 2>&1) -join "`n"
        $n = [int](((& 'C:\Servers\PostgreSQL\bin\psql.exe' --dbname="$dbUrl" -t -A -c "SELECT count(*) FROM weighbridge_records WHERE id IN ($ids) AND updated_at <= timestamp '$start'" 2>&1) -join '').Trim())
        "$rows`n@@unexplained=$n"
    } -ArgumentList 'C:\Servers\NIR\dev', ($shown -join ','), $start
    [pscustomobject]@{ Lost = $lost.Count; Gained = $gained.Count; Unexplained = $u }
}

'=== A) happy path: before == after (no drift expected) ==='
$r = Judge $real.Ids $real.Ids $real.Clock $real.Ids
"A1 lost=$($r.Lost) gained=$($r.Gained) -> expect 0/0 (verdict: 'counts unchanged')"

'=== B) doctored before: two rows that really lost their net are missing from the before-set ==='
$doctored = (@($real.Ids -split ',' | Where-Object { $_ -notin @('86678', '85861') }) -join ',')
$r2 = Judge $doctored $real.Ids $real.Clock $real.Ids
"B1 lost=$($r2.Lost) gained=$($r2.Gained) -> expect 2/0 (their history predates the deploy)"
$r2.Unexplained

'=== C) doctored before: a row that really gained net (post-deploy update) appears as new ==='
$doctoredC = (@($real.Ids -split ',' | Where-Object { $_ -ne '86891' }) -join ',')
$r3 = Judge $doctoredC $real.Ids $real.Clock $real.Ids
"C1 lost=$($r3.Lost) gained=$($r3.Gained) -> expect 0/1, and unexplained=1 because 86891 was last written on 2026-08-12"
$r3.Unexplained

'=== server clock the guard stamps into the snapshot ==='
$real.Clock
Remove-PSSession $s
