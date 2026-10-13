# Case D/E: the branch production will actually take. A drift whose rows carry a fresh updated_at must be a
# WARN ("live scale"), not a stop; a row that vanished from the watermark set must count as LOST.
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
$r = Invoke-Command -Session $s -ScriptBlock {
    param($root, $maxId, $start)
    $envLines = Get-Content (Join-Path $root '.env')
    $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    $after = ((& $psql --dbname="$dbUrl" -t -A -c "SELECT coalesce(string_agg(id::text,',' ORDER BY id),'') FROM weighbridge_records WHERE id <= $maxId AND coalesce(net_weight,0) > 0" 2>&1) -join '').Trim()
    $before = @($after -split ',' | Where-Object { $_ -notin @('86678', '85861') })
    $before = @('1') + $before                       # id 1 is not in the after set -> must be reported as LOST
    $b = @($before); $a = @($after -split ',')
    $lost = @($b | Where-Object { $a -notcontains $_ })
    $gained = @($a | Where-Object { $b -notcontains $_ })
    $ids = @($lost + $gained) -join ','
    $uFresh = [int](((& $psql --dbname="$dbUrl" -t -A -c "SELECT count(*) FROM weighbridge_records WHERE id IN ($ids) AND updated_at <= timestamp '$start'" 2>&1) -join '').Trim())
    [pscustomobject]@{ Lost = ($lost -join ','); Gained = $gained.Count; UnexplainedWithDeployStart = $uFresh; UnexplainedWithOldStart = [int](((& $psql --dbname="$dbUrl" -t -A -c "SELECT count(*) FROM weighbridge_records WHERE id IN ($ids) AND updated_at <= timestamp '2026-08-01 00:00:00'" 2>&1) -join '').Trim()) }
} -ArgumentList 'C:\Servers\NIR\dev', 461121, '2026-10-13 13:09:14'
"D1 lost ids = '$($r.Lost)'   -> expect '1' (the bogus id)"
"D2 gained    = $($r.Gained)   -> expect 2"
"D3 unexplained with the real deploy start (13:09:14) = $($r.UnexplainedWithDeployStart)  -> expect 3 (all three rows are old)"
"D4 unexplained with an intentionally old start (2026-08-01) = $($r.UnexplainedWithOldStart)  -> expect 0 => guard prints the WARN line, not GUARD-STOP"
Remove-PSSession $s
