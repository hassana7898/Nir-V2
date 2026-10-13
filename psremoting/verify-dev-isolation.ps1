# verify-dev-isolation.ps1 — proves dev.artadan.ir is independent of app.artadan.ir, and that
# prod is untouched. Prints one PASS/FAIL line per invariant and a final verdict.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File psremoting\verify-dev-isolation.ps1
#
# Exit code: 0 when every invariant passes (VERIFY-OK), 1 otherwise (VERIFY-FAIL).
$ErrorActionPreference = 'Stop'

$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  $rows = Invoke-Command -Session $s -ScriptBlock {
    $res = New-Object System.Collections.Generic.List[object]
    function T([string] $name, [bool] $ok, [string] $detail) {
      $res.Add([pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail })
    }
    function Http([string] $url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8).StatusCode } catch { 'ERR' } }

    $dev = 'C:\Servers\NIR\dev'
    $app = 'C:\Servers\NIR\app'
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    $devCred = Get-Content 'C:\Servers\NIR\secrets\dev-credentials.json' -Raw | ConvertFrom-Json
    $admCred = Get-Content 'C:\Servers\NIR\secrets\nir-credentials.json' -Raw | ConvertFrom-Json

    # ---- 1) both sites answer
    $prodH = Http 'http://127.0.0.1:3000/api/health'
    $devH = Http 'http://127.0.0.1:3001/api/health'
    T 'prod site answers 200' ($prodH -eq 200) "loopback 3000 -> $prodH"
    T 'dev site answers 200' ($devH -eq 200) "loopback 3001 -> $devH"
    T 'dev reachable through its nginx' ((Http 'http://127.0.0.1:8081/api/health') -eq 200) 'loopback 8081 -> dev-owned nginx'

    # ---- 2) database identity + isolation
    $env:PGPASSWORD = $admCred.postgres.password
    $dbOwner = ((& $psql -w -U postgres -h 127.0.0.1 -d postgres -t -A -c "select pg_get_userbyid(datdba) from pg_database where datname='nir_db'") -join '').Trim()
    $dvdOwner = ((& $psql -w -U postgres -h 127.0.0.1 -d postgres -t -A -c "select pg_get_userbyid(datdba) from pg_database where datname='nir_dev'") -join '').Trim()
    $prodTableOwners = ((& $psql -w -U postgres -h 127.0.0.1 -d nir_db -t -A -c "select distinct tableowner from pg_tables where schemaname='public'") -join ',').Trim()
    $prodConnAcl = ((& $psql -w -U postgres -h 127.0.0.1 -d postgres -t -A -c "select coalesce(datacl::text,'(default)') from pg_database where datname='nir_db'") -join '').Trim()
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    T 'nir_db is owned by nir_user' ($dbOwner -eq 'nir_user') "datdba=$dbOwner"
    T 'nir_db tables owned by nir_user' ($prodTableOwners -eq 'nir_user') "owners=$prodTableOwners"
    T 'no PUBLIC CONNECT on nir_db' ($prodConnAcl -notmatch '(\{|,)\s*=') "acl=$prodConnAcl"

    $env:PGPASSWORD = $devCred.password
    $devToDev = ((& $psql -w -U $devCred.user -h 127.0.0.1 -d nir_dev -t -A -c 'select count(*) from weighbridge_records' 2>&1) -join ' ').Trim()
    $devToProd = ((& $psql -w -U $devCred.user -h 127.0.0.1 -d nir_db -t -A -c 'select 1' 2>&1) -join ' ').Trim()
    $env:PGPASSWORD = $admCred.appDb.password
    $prodToProd = ((& $psql -w -U nir_user -h 127.0.0.1 -d nir_db -t -A -c 'select 1' 2>&1) -join ' ').Trim()
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    T 'dev role reaches nir_dev' ($devToDev -match '^\d+$') "select count(*) -> $devToDev"
    T 'dev role BLOCKED on nir_db' ($devToProd -match 'permission denied for database') $devToProd
    T 'prod role still reaches nir_db' ($prodToProd -eq '1') "nir_user -> nir_db -> $prodToProd"

    # ---- 3) secrets
    $shaOf = {
      param($p)
      $j = (Select-String -Path (Join-Path $p '.env') -Pattern '^JWT_SECRET=(.*)$').Matches.Groups[1].Value
      [System.BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($j))).Replace('-', '').Substring(0, 16)
    }
    $hApp = & $shaOf $app
    $hDev = & $shaOf $dev
    T 'dev JWT secret differs from prod' ($hApp -ne $hDev) "prod=$hApp dev=$hDev -> tokens cannot cross domains"

    # ---- 4) dev runtime config points only at dev
    $devEnv = Get-Content (Join-Path $dev '.env')
    $devDbUrl = (($devEnv | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', '')
    T 'dev uses its own DB role + DB' ($devDbUrl -match 'nir_dev' -and $devDbUrl -match 'nir_dev_user') 'DATABASE_URL -> nir_dev_user@nir_dev'
    T 'dev env never references nir_db' ($devDbUrl -notmatch '/nir_db') 'no prod database in dev config'
    $pgBin = ((($devEnv | Where-Object { $_ -match '^PG_BIN=' }) -replace '^PG_BIN=', '')).Trim()
    T 'dev PG_BIN exists (dump works)' ((Test-Path (Join-Path $pgBin 'pg_dump.exe'))) "PG_BIN=$pgBin"
    $devMap = ((($devEnv | Where-Object { $_ -match '^WEIGHBRIDGE_COLUMN_MAP=' }) -replace '^WEIGHBRIDGE_COLUMN_MAP=', '')).Trim()
    $appMap = ((($(Get-Content (Join-Path $app '.env')) | Where-Object { $_ -match '^WEIGHBRIDGE_COLUMN_MAP=' }) -replace '^WEIGHBRIDGE_COLUMN_MAP=', '')).Trim()
    T 'dev column map matches prod' ($devMap -eq $appMap) 'same weighbridge columns mapped in both environments'

    # ---- 5) separate processes / ports / folders
    $procs = Get-Process node -ErrorAction SilentlyContinue
    $appNode = @($procs | Where-Object { $_.Path -like "$app\runtime\*" }).Count
    $devNode = @($procs | Where-Object { $_.Path -like "$dev\runtime\*" }).Count
    T 'separate node runtimes + processes' (($appNode -ge 1) -and ($devNode -ge 1)) "prod node=$appNode dev node=$devNode"
    $l3000 = (@(Get-NetTCPConnection -State Listen -LocalPort 3000 | Select-Object -ExpandProperty LocalAddress -Unique) -join ',')
    $l3001 = (@(Get-NetTCPConnection -State Listen -LocalPort 3001 | Select-Object -ExpandProperty LocalAddress -Unique) -join ',')
    T 'both apps bound to loopback only' (($l3000 -eq '127.0.0.1') -and ($l3001 -eq '127.0.0.1')) "3000=$l3000 3001=$l3001"
    T 'dev tree is a real folder' ((Test-Path "$dev\server.cjs") -and ([string]::IsNullOrEmpty((Get-Item $dev).LinkType))) "$dev is not a junction/symlink"

    # ---- 6) nginx: dev owns its own process; main nginx keeps only a stub
    $mainNginx = @(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq 'C:\Servers\Nginx\nginx.exe' }).Count
    $devNginx = @(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq 'C:\Servers\NginxDev\nginx.exe' }).Count
    T 'dev nginx is a separate process' (($mainNginx -ge 1) -and ($devNginx -ge 1)) "main=$mainNginx dev=$devNginx (own conf/logs in C:\Servers\NginxDev)"
    $stub = [System.IO.File]::ReadAllText('C:\Servers\Nginx\conf\sites\dev.artadan.ir-ssl.conf', [System.Text.Encoding]::UTF8)
    T 'main nginx dev block is a stub' ($stub -match 'proxy_pass\s+http://127\.0\.0\.1:8081;') 'dev.artadan.ir-ssl.conf -> 8081 (dev-owned nginx)'
    T 'dev nginx listens on loopback only' ((@(Get-NetTCPConnection -State Listen -LocalPort 8081 | Select-Object -ExpandProperty LocalAddress -Unique) -join ',') -eq '127.0.0.1') '8081 is not exposed publicly'

    # ---- 7) scheduled tasks
    $need = @('NIR Production Service', 'NIR Dev Service', 'NIR Dev Health', 'NIR Dev Backup', 'NIR Dev Nginx', 'NIR Weighbridge Sync', 'NIR Weighbridge Sync Prod', 'NIR Health Check')
    $missing = @($need | Where-Object { -not (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) })
    T 'expected tasks are registered' ($missing.Count -eq 0) "missing: $($missing -join ', ')"
    $syncRunner = Get-Content 'C:\Servers\NIR\scripts\RUN-WEIGHBRIDGE-SYNC.ps1' -Raw
    T 'dev sync has its own kill switch' ($syncRunner -match 'WEIGHBRIDGE_SYNC_ENABLED') 'pausable from dev\.env without touching prod'

    # ---- 8) dev self-healing + backups
    $hl = @(Get-Content (Join-Path $dev 'logs\health.log') -Tail 1 -ErrorAction SilentlyContinue)
    $fresh = $false
    if (($hl -join '') -match 'time=([0-9T:\-\.]+)') { try { $fresh = ([datetime]$matches[1] -gt (Get-Date).AddHours(-1)) } catch { } }
    T 'dev health watchdog is running' $fresh ('last: ' + ($hl -join ''))
    $zip = Get-ChildItem (Join-Path $dev 'backups') -Filter 'nir-dev-backup-*.zip' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $zipDetail = 'none yet'
    if ($zip) { $zipDetail = "$($zip.Name) ($($zip.LastWriteTime))" }
    T 'dev has its own database backup' ($null -ne $zip) $zipDetail

    # ---- 9) prod untouched
    $envAge = (New-TimeSpan -Start (Get-Item (Join-Path $app '.env')).LastWriteTime -End (Get-Date)).TotalDays
    T 'prod .env not rewritten by dev work' ($envAge -gt 1) ("app\.env last written $([math]::Round($envAge, 1)) day(s) ago")
    T 'prod health stays 200 at the end' ((Http 'http://127.0.0.1:3000/api/health') -eq 200) 'final prod probe'
    return $res
  }

  $fail = 0
  foreach ($r in $rows) {
    $tag = 'FAIL'; if ($r.Ok) { $tag = 'PASS' } else { $fail++ }
    "{0}  {1,-36} {2}" -f $tag, $r.Name, $r.Detail
  }
  ''
  if ($fail -eq 0) {
    "VERIFY-OK   : $($rows.Count)/$($rows.Count) isolation invariants hold (dev independent, prod untouched)"
    exit 0
  } else {
    "VERIFY-FAIL : $fail of $($rows.Count) invariant(s) failed"
    exit 1
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
