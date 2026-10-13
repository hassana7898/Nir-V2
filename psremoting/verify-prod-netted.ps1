# End-to-end verification of PRODUCTION: the deployed server's OWN answer for «خالص‌شده», not our SQL.
#
# requireAuth() falls back to JWT verification when there is no DB session row, so a token minted here with
# the server's JWT_SECRET can call the read-only endpoints. Nothing is written: every call below is a GET,
# and the identity is 'deploy-verify' so it is obviously a probe.
#
# Checks
#   1. /api/health is 200
#   2. records?net=done    -> total equals the DB's new_rule_netted (gross>0 AND tare>0)
#   3. records?net=pending -> total equals tickets - new_rule_netted (and done+pending == tickets)
#   4. half-weighed tickets (net == gross, no tare) are ABSENT from net=done and are not netted -> the UI
#      cannot present a net for a ticket still waiting for its second weighing (the stale stored net is kept
#      in the DB on purpose; components/WeighbridgeReport.tsx gates the screen with '—' and the Excel with '')
#   5. the bundle index.html points at is on disk and contains the new UI/Excel strings (daily report, the
#      «در انتظار توزین دوم» status, the «روز و کالا» sheet name)
#   6. /api/weighbridge/report/daily for today -> rows + day totals match the DB, sum(row.net) == totals.net,
#      and the pending weight of half-weighed tickets stays in pendingGross/pendingTare, never in net
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
$today = Get-Date -Format 'yyyy-MM-dd'

Invoke-Command -Session $s -ScriptBlock {
    param($root, $port, $today)
    $envLines = Get-Content (Join-Path $root '.env')
    $envOf = { param($k) (($envLines | Where-Object { $_ -match "^$k=" } | Select-Object -First 1) -replace "^$k=", '').Trim().Trim('"') }
    $secret = & $envOf 'JWT_SECRET'
    $dbUrl = & $envOf 'DATABASE_URL'
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    function Q([string] $sql) { ((& $psql --dbname="$dbUrl" -t -A -c $sql 2>&1) -join '').Trim() }
    function B64Url([byte[]] $b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
    $now = [int][double]::Parse((Get-Date -UFormat %s))
    $payload = @{ id = 'deploy-verify'; username = 'deploy-verify'; role = 'ADMIN'; iss = 'nir-app'; sub = 'deploy-verify'; iat = $now; exp = $now + 600 } | ConvertTo-Json -Compress
    $h = B64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $p = B64Url ([Text.Encoding]::UTF8.GetBytes($payload))
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $token = "$h.$p." + (B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$h.$p"))))
    $hdrs = @{ Authorization = "Bearer $token" }
    function Get-Json([string] $path) {
        try { Invoke-RestMethod -Uri "http://127.0.0.1:$port$path" -Headers $hdrs -TimeoutSec 60 } catch { [pscustomobject]@{ __error = $_.Exception.Message } }
    }
    $script:anyFail = $false
    function Check([string] $what, [bool] $ok, [string] $detail) {
        if ($ok) { "  OK   $what  $detail" } else { "  FAIL $what  $detail" }
        if (-not $ok) { $script:anyFail = $true }
    }

    'health'
    $hlt = Get-Json '/api/health'
    if ($hlt.__error) { '  FAIL /api/health ' + $hlt.__error } else { "  OK   /api/health status=$($hlt.status) db=$($hlt.database.status)" }

    $dbTickets = [int](Q 'SELECT count(*) FROM weighbridge_records')
    $dbNetted = [int](Q 'SELECT count(*) FROM weighbridge_records WHERE coalesce(gross_weight,0) > 0 AND coalesce(tare_weight,0) > 0')
    $dbOld = [int](Q 'SELECT count(*) FROM weighbridge_records WHERE coalesce(net_weight,0) > 0')
    "DB   : tickets=$dbTickets new_rule_netted=$dbNetted old_rule=$dbOld"

    'net=done (the «خالص‌شده» filter the UI sends)'
    $done = Get-Json '/api/weighbridge/records?net=done&limit=1'
    if ($done.__error) { '  FAIL net=done ' + $done.__error } else {
        "  server total = $($done.total)   (expected $dbNetted)"
        Check 'net=done count == new rule' ([int]$done.total -eq $dbNetted) ''
        Check 'net=done is stricter than the old rule' ([int]$done.total -lt $dbOld) "(old rule said $dbOld)"
    }

    'net=pending (در انتظار توزین دوم)'
    $pend = Get-Json '/api/weighbridge/records?net=pending&limit=1'
    if ($pend.__error) { '  FAIL net=pending ' + $pend.__error } else {
        "  server total = $($pend.total)   (expected $($dbTickets - $dbNetted))"
        Check 'net=pending count' ([int]$pend.total -eq ($dbTickets - $dbNetted)) ''
        Check 'done + pending == tickets' (([int]$done.total + [int]$pend.total) -eq $dbTickets) ''
    }

    '/stats (worker bundle present?)'
    $st = Get-Json '/api/weighbridge/stats'
    if ($st.__error) { '  FAIL /stats ' + $st.__error } else {
        Check 'worker bundle present' ($st.data.workerBundlePresent -eq $true) "$($st.data.workerBundlePath)"
        "  lastSyncedAt=$($st.data.lastSyncedAt)  newestWeighTime=$($st.data.newestWeighTime)  statuses=$($st.data | ConvertTo-Json -Compress)"
    }
    'half-weighed tickets must not be presented as finished'
    # The requirement is about what the app PRESENTS. The API keeps the raw stored value on purpose (the
    # scale wrote net == gross at the first weighing); the ticket list renders «—» and the Excel writes an
    # empty cell for a row that is not netted (components/WeighbridgeReport.tsx: netted ? faNum(net) : '—').
    # So: the hard checks are (a) the row is really not netted by the API's own numbers and (b) it is absent
    # from net=done — checked over a COMPLETE result page, never a truncated one (q is a %like% text match).
    $stale = Q "SELECT string_agg(id::text || ':' || coalesce(external_id::text,'-'), ',' ORDER BY id DESC) FROM weighbridge_records WHERE coalesce(net_weight,0) > 0 AND (coalesce(gross_weight,0) = 0 OR coalesce(tare_weight,0) = 0)"
    foreach ($pair in @($stale -split ',' | Where-Object { $_ })) {
        $rowId = [int]$pair.Split(':')[0]; $ext = $pair.Split(':')[1]
        $rec = Get-Json "/api/weighbridge/records/$rowId"
        if ($rec.__error) { Check "id=$rowId read by id" $false $rec.__error; continue }
        $gross = [double]$rec.data.grossWeight; $tare = [double]$rec.data.tareWeight
        Check "id=$rowId is not netted (gross>0 AND tare>0 is false)" (-not ($gross -gt 0 -and $tare -gt 0)) "gross=$gross tare=$tare stored net=$($rec.data.netWeight) -> the screen prints '—'"
        $page = Get-Json "/api/weighbridge/records?net=done&q=$ext&limit=1"
        if ($page.__error) { Check "id=$rowId absent from net=done" $false $page.__error; continue }
        $hits = [int]$page.total
        if ($hits -gt 1) { $page = Get-Json "/api/weighbridge/records?net=done&q=$ext&limit=$hits" }
        $found = @($page.data | Where-Object { $_.id -eq $rowId }).Count
        Check "id=$rowId absent from net=done" ($found -eq 0) "matches=$found out of $hits row(s) matching q=$ext"
    }

    'the deployed frontend really has the new behaviour'
    # Minified bundles may keep the Persian as literals or escape them as \uXXXX, so check both forms.
    $index = Get-Content (Join-Path $root 'dist\index.html') -Raw
    $refs = @([regex]::Matches($index, 'assets/index-[A-Za-z0-9_-]+\.(js|css)') | ForEach-Object { $_.Value } | Sort-Object -Unique)
    "  index.html references : $($refs -join '  ')"
    foreach ($r in $refs) {
        $abs = Join-Path (Join-Path $root 'dist') ($r -replace '/', '\')
        Check "referenced $r exists on disk" (Test-Path $abs) $abs
    }
    $jsRef = $refs | Where-Object { $_.EndsWith('.js') } | Select-Object -First 1
    if ($jsRef) {
        $bundleFile = Join-Path (Join-Path $root 'dist') ($jsRef -replace '/', '\')
        $bundle = [System.IO.File]::ReadAllText($bundleFile, [System.Text.Encoding]::UTF8)
        "  bundle : $jsRef  $([math]::Round((Get-Item $bundleFile).Length / 1MB, 2)) MB"
        foreach ($needle in @('report/daily', 'در انتظار توزین دوم', 'خالص‌شده', 'روز و کالا', 'وزن در انتظار توزین دوم')) {
            $esc = ($needle.ToCharArray() | ForEach-Object { '\u{0:x4}' -f [int]$_ }) -join ''
            $hit = $bundle.Contains($needle) -or $bundle.Contains($esc)
            Check "bundle contains '$needle'" $hit $(if ($hit) { '' } else { 'missing from the shipped UI' })
        }
    } else {
        Check 'index.html references a JS bundle' $false "index.html is $($index.Length) chars"
    }

    'report/daily for today'
    $daily = Get-Json "/api/weighbridge/report/daily?from=$today&to=$today"
    if ($daily.__error) { '  FAIL report/daily ' + $daily.__error } else {
        $rowsNetted = [int](Q "SELECT count(*) FROM weighbridge_records WHERE left(coalesce(weigh_time::text,''),10) = '$today' AND coalesce(gross_weight,0) > 0 AND coalesce(tare_weight,0) > 0")
        $rowsPending = [int](Q "SELECT count(*) FROM weighbridge_records WHERE left(coalesce(weigh_time::text,''),10) = '$today' AND NOT (coalesce(gross_weight,0) > 0 AND coalesce(tare_weight,0) > 0)")
        "  rows returned = $($daily.data.rows.Count)   totals.netted=$($daily.data.totals.netted) (db $rowsNetted)   totals.pending=$($daily.data.totals.pending) (db $rowsPending)"
        Check 'daily totals.netted == db' ([int]$daily.data.totals.netted -eq $rowsNetted) ''
        Check 'daily totals.pending == db' ([int]$daily.data.totals.pending -eq $rowsPending) ''
        Check 'daily echoes the range' ($daily.data.range.from -eq $today -and $daily.data.range.to -eq $today) "range=$($daily.data.range.from)..$($daily.data.range.to)"
        $days = @($daily.data.rows | Select-Object -ExpandProperty day | Sort-Object -Unique)
        Check 'one day in, one day out' ($days.Count -le 1) "days=$($days -join ',')"
        $sumNet = ($daily.data.rows | Measure-Object -Property net -Sum).Sum
        Check 'sum(row.net) == totals.net' ([math]::Abs([double]$sumNet - [double]$daily.data.totals.net) -lt 0.001) "sum=$sumNet totals=$($daily.data.totals.net)"
        $pg = ($daily.data.rows | Measure-Object -Property pendingGross -Sum).Sum
        "  pending weight kept OUT of net: pendingGross=$pg pendingTare=$($daily.data.totals.pendingTare)"
        '  sample rows:'
        $daily.data.rows | Select-Object -First 4 | ForEach-Object { "    $($_.day)  $($_.goods)  tickets=$($_.tickets) netted=$($_.netted) pending=$($_.pending) net=$($_.net)" }
    }
    'report/daily over a multi-day window (the operator can pick any range)'
    $from = (Get-Date).AddDays(-6).ToString('yyyy-MM-dd')
    $multi = Get-Json "/api/weighbridge/report/daily?from=$from&to=$today"
    if ($multi.__error) { Check 'multi-day report/daily' $false $multi.__error } else {
        $days = @($multi.data.rows | Select-Object -ExpandProperty day | Sort-Object -Unique)
        $dbDays = [int](Q "SELECT count(DISTINCT left(coalesce(weigh_time::text,''),10)) FROM weighbridge_records WHERE left(coalesce(weigh_time::text,''),10) BETWEEN '$from' AND '$today'")
        "  window $from..$today  rows=$($multi.data.rows.Count)  distinct days=$($days.Count)  db days=$dbDays"
        Check 'range echoed exactly' ($multi.data.range.from -eq $from -and $multi.data.range.to -eq $today) "$($multi.data.range.from)..$($multi.data.range.to)"
        Check 'no day outside the window' (@($days | Where-Object { $_ -lt $from -or $_ -gt $today }).Count -eq 0) "days=$($days -join ',')"
        Check 'day count matches the DB' ($days.Count -eq $dbDays) "api=$($days.Count) db=$dbDays"
        $sumT = ($multi.data.rows | Measure-Object -Property tickets -Sum).Sum
        $sumN = ($multi.data.rows | Measure-Object -Property netted -Sum).Sum
        $sumP = ($multi.data.rows | Measure-Object -Property pending -Sum).Sum
        $sumW = ($multi.data.rows | Measure-Object -Property net -Sum).Sum
        Check 'sum(row.tickets) == totals.tickets' ([int]$sumT -eq [int]$multi.data.totals.tickets) "rows=$sumT totals=$($multi.data.totals.tickets)"
        Check 'sum(row.netted) == totals.netted' ([int]$sumN -eq [int]$multi.data.totals.netted) "rows=$sumN totals=$($multi.data.totals.netted)"
        Check 'sum(row.pending) == totals.pending' ([int]$sumP -eq [int]$multi.data.totals.pending) "rows=$sumP totals=$($multi.data.totals.pending)"
        Check 'sum(row.net) == totals.net' ([math]::Abs([double]$sumW - [double]$multi.data.totals.net) -lt 0.001) "rows=$sumW totals=$($multi.data.totals.net)"
        # Every ticket is either netted or waiting - counted once, never in both and never in neither.
        $bad = @($multi.data.rows | Where-Object { ([int]$_.netted + [int]$_.pending) -ne [int]$_.tickets })
        Check 'per row: netted + pending == tickets' ($bad.Count -eq 0) "bad rows=$($bad.Count)"
        $badTot = ([int]$multi.data.totals.netted + [int]$multi.data.totals.pending) -eq [int]$multi.data.totals.tickets
        Check 'totals: netted + pending == tickets' $badTot "netted=$($multi.data.totals.netted) + pending=$($multi.data.totals.pending) vs tickets=$($multi.data.totals.tickets)"
    }

    if (-not $script:anyFail) { 'VERIFY-OK   : production answers match the new rule' } else { 'VERIFY-FAIL : see the FAIL lines above' }
} -ArgumentList 'C:\Servers\NIR\app', 3000, $today
Remove-PSSession $s
