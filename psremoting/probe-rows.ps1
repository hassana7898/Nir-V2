# Why did the row classes move during the deploy window? Read-only forensics, no writes.
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt
Invoke-Command -Session $s -ScriptBlock {
    $envLines = Get-Content 'C:\Servers\NIR\app\.env'
    $dbUrl = (($envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '').Trim().Trim('"')
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $env:PGCLIENTENCODING = 'UTF8'
    function Q([string]$sql) { (& $psql --dbname="$dbUrl" -t -A -F ' | ' -c $sql 2>&1) -join "`n" }

    '--- columns ---'
    Q "SELECT column_name || ' ' || data_type FROM information_schema.columns WHERE table_name='weighbridge_records' ORDER BY ordinal_position"

    '--- the 8 suspicious ids, as they are NOW ---'
    Q "SELECT id, gross_weight, tare_weight, net_weight, weigh_time, updated_at FROM weighbridge_records WHERE id IN (291980,288908,280218,1364,1363,1302,1151,334) ORDER BY id DESC"

    '--- classes right now (whole table) ---'
    Q "SELECT count(*), count(*) FILTER (WHERE coalesce(net_weight,0) > 0) AS old_rule, count(*) FILTER (WHERE coalesce(gross_weight,0) > 0 AND coalesce(tare_weight,0) > 0) AS new_rule, count(*) FILTER (WHERE coalesce(net_weight,0) > 0 AND (coalesce(gross_weight,0)=0 OR coalesce(tare_weight,0)=0)) AS half FROM weighbridge_records"

    '--- rows touched in the last 30 minutes (any column) ---'
    Q "SELECT id, external_id, gross_weight, tare_weight, net_weight, weigh_time, updated_at FROM weighbridge_records WHERE updated_at > now() - interval '30 minutes' ORDER BY updated_at DESC LIMIT 20"
}
Remove-PSSession $s
