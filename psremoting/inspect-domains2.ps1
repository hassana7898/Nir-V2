# Round-2 read-only inventory: supervisors, scripts, certs, PG instance, secrets, disks, IPs.
$ErrorActionPreference = 'Stop'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 300000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  Invoke-Command -Session $s -ScriptBlock {
    $o = New-Object System.Collections.Generic.List[string]
    function A([string]$t) { $o.Add($t) }

    A '### services mentioning NIR / node'
    Get-Service | Where-Object { $_.Name -match 'NIR|nir|node' -or $_.DisplayName -match 'NIR|nir|node' } |
      ForEach-Object { A ("  {0} | {1} | {2} | {3}" -f $_.Name, $_.Status, $_.StartType, $_.DisplayName) }

    A '### C:\Servers top level'
    Get-ChildItem C:\Servers -Directory | ForEach-Object { A ("  {0}  ({1})" -f $_.FullName, $_.LastWriteTime) }

    A '### C:\Servers\NIR top level'
    Get-ChildItem C:\Servers\NIR -Force | ForEach-Object { A ("  {0,-28} {1,-6} {2}" -f $_.Name, $_.PSIsContainer, $_.LastWriteTime) }

    A '### scripts folder'
    foreach ($f in (Get-ChildItem C:\Servers\NIR\scripts -File -ErrorAction SilentlyContinue)) {
      A ("  {0}  {1} bytes  {2}" -f $f.Name, $f.Length, $f.LastWriteTime)
    }
    foreach ($n in @('RUN-DEV.ps1', 'RUN-PROD.ps1', 'RUN-APP.ps1', 'BACKUP-NIR.ps1')) {
      $p = Join-Path 'C:\Servers\NIR\scripts' $n
      if (Test-Path $p) {
        A ("  ---- $n")
        foreach ($ln in (Get-Content $p)) { A ("     " + $ln) }
      }
    }

    A '### certs'
    foreach ($d in (Get-ChildItem C:\Servers\certs -Directory -ErrorAction SilentlyContinue)) {
      A ("  dir {0}" -f $d.FullName)
      foreach ($f in (Get-ChildItem $d.FullName -File)) { A ("     {0,-40} {1} bytes  {2}" -f $f.Name, $f.Length, $f.LastWriteTime) }
    }

    A '### IPv4 addresses'
    Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { A ("  {0}/{1}  if={2}  {3}" -f $_.IPAddress, $_.PrefixLength, $_.InterfaceAlias, $_.SuffixOrigin) }

    A '### disks'
    Get-PSDrive -PSProvider FileSystem | ForEach-Object { A ("  {0}: used {1} GB free {2} GB" -f $_.Name, [math]::Round($_.Used/1GB,1), [math]::Round($_.Free/1GB,1)) }

    A '### postgres instance details'
    foreach ($svc in (Get-Service | Where-Object { $_.Name -match 'postgres' })) {
      $ci = Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $svc.Name)
      A ("  {0}: {1}" -f $svc.Name, $ci.PathName)
    }
    $conf = 'C:\Servers\PostgreSQL\data\postgresql.conf'
    if (Test-Path $conf) {
      foreach ($ln in (Select-String -Path $conf -Pattern '^\s*(port|data_directory|listen_addresses|max_connections|shared_buffers)\s*=')) { A ("  conf: " + $ln.Line.Trim()) }
    } else { A "  no $conf" }

    A '### databases + sizes + row counts (nir_user)'
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    if (Test-Path $psql) {
      $env:PGPASSWORD = 'TodsD86OK4akYHiPe5zYCC9QBSWJ'
      & $psql -U nir_user -h 127.0.0.1 -p 5432 -d postgres -t -A -c "select datname||' | '||pg_size_pretty(pg_database_size(datname)) from pg_database where datistemplate=false order by datname" 2>&1 |
        ForEach-Object { A ("     " + $_) }
      foreach ($db in @('nir_db', 'nir_dev')) {
        $r = & $psql -U nir_user -h 127.0.0.1 -p 5432 -d $db -t -A -c "select (select count(*) from weighbridge_records)||' wb rows, '||(select count(*) from remittances)||' remittances'" 2>&1
        A ("     {0}: {1}" -f $db, ($r -join ' '))
      }
      Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }

    A '### secrets: are dev and prod keys the same? (hashes only)'
    foreach ($d in @('C:\Servers\NIR\app', 'C:\Servers\NIR\dev')) {
      $e = Join-Path $d '.env'
      $jwt = (Select-String -Path $e -Pattern '^JWT_SECRET=(.*)$').Matches.Groups[1].Value
      $sha = [System.BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($jwt))).Replace('-', '').Substring(0, 24)
      A ("  {0}  JWT_SECRET len={1} sha={2}" -f $d, $jwt.Length, $sha)
    }

    A '### nginx: -t (syntax check) + version'
    $nx = 'C:\Servers\Nginx\nginx.exe'
    if (Test-Path $nx) {
      Push-Location 'C:\Servers\Nginx'
      & $nx -t 2>&1 | ForEach-Object { A ("  " + $_) }
      & $nx -v 2>&1 | ForEach-Object { A ("  " + $_) }
      Pop-Location
    }

    A '### node runtimes'
    foreach ($d in @('C:\Servers\NIR\app\runtime', 'C:\Servers\NIR\dev\runtime')) {
      Get-ChildItem $d -File -ErrorAction SilentlyContinue | ForEach-Object { A ("  {0}\{1}  {2} bytes" -f $d, $_.Name, $_.Length) }
      $nv = Join-Path $d 'node.exe'
      if (Test-Path $nv) { A ("  {0} -> {1}" -f $nv, (& $nv -v)) }
    }

    return $o
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
