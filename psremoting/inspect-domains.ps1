# Read-only inventory of the app/dev hosting setup on the NIR VPS (194.60.230.236).
# Only reads: no writes, no restarts. Run:  powershell -NoProfile -File psremoting\inspect-domains.ps1
$ErrorActionPreference = 'Stop'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 300000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  Invoke-Command -Session $s -ScriptBlock {
    $o = New-Object System.Collections.Generic.List[string]
    function A([string]$t) { $o.Add($t) }
    function Size($p) { if ((Get-Item $p).PSIsContainer) { "{0} files" -f (Get-ChildItem $p -File -ErrorAction SilentlyContinue | Measure-Object).Count } else { (Get-Item $p).Length } }

    A '### listeners (80/443/3000/3001/5432/5985)'
    foreach ($c in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                    Where-Object { $_.LocalPort -in 80, 443, 3000, 3001, 5432, 5985 })) {
      $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      A ("  {0}:{1}  pid={2}  {3}  {4}" -f $c.LocalAddress, $c.LocalPort, $c.OwningProcess, $p.ProcessName, $p.Path)
    }

    A '### processes'
    foreach ($p in (Get-Process | Where-Object { $_.ProcessName -match 'nginx|caddy|httpd|node|w3wp|postgres' })) {
      A ("  {0} pid={1} path={2}" -f $p.ProcessName, $p.Id, $p.Path)
    }

    A '### nginx config'
    $nx = Get-Process -Name nginx -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nx) {
      $nd = Split-Path -Parent $nx.Path
      A "  nginx root = $nd"
      foreach ($f in (Get-ChildItem (Join-Path $nd 'conf') -Recurse -File -Include '*.conf' -ErrorAction SilentlyContinue)) {
        A ("  ---- {0}  ({1} bytes, {2})" -f $f.FullName, $f.Length, $f.LastWriteTime)
        foreach ($ln in (Get-Content $f.FullName)) { A ("     " + $ln) }
      }
    } else { A '  nginx process NOT found' }

    A '### nginx service + binary folder'
    Get-Service | Where-Object { $_.Name -match 'nginx' } | ForEach-Object { A ("  svc {0} {1} ({2})" -f $_.Name, $_.Status, $_.DisplayName) }
    foreach ($d in @('C:\nginx', 'C:\Servers\nginx', 'C:\tools\nginx')) { if (Test-Path $d) { A "  exists: $d" } }

    A '### IIS'
    if (Get-Module -ListAvailable WebAdministration) {
      Import-Module WebAdministration -ErrorAction SilentlyContinue
      foreach ($w in (Get-Website -ErrorAction SilentlyContinue)) {
        A ("  site {0} state={1} path={2}" -f $w.Name, $w.State, $w.PhysicalPath)
        foreach ($b in $w.Bindings.Collection) { A ("     bind {0}  cert={1}" -f $b.BindingInformation, $b.CertificateHash) }
      }
      Get-WebAppPoolState -ErrorAction SilentlyContinue | ForEach-Object { A ("  pool {0} = {1}" -f $_.Name, $_.Value) }
    } else { A '  WebAdministration module not installed' }

    A '### scheduled tasks (NIR)'
    foreach ($t in (Get-ScheduledTask | Where-Object { $_.TaskName -match 'NIR|nir' })) {
      A ("  task '{0}' state={1} user={2}" -f $t.TaskName, $t.State, $t.Principal.UserId)
      foreach ($a in $t.Actions) { A ("     exec={0}  args={1}  wd={2}" -f $a.Execute, $a.Arguments, $a.WorkingDirectory) }
      foreach ($tr in $t.Triggers) { A ("     trigger={0} enabled={1}" -f $tr.CimClass.CimClassName, $tr.Enabled) }
      $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -ErrorAction SilentlyContinue
      if ($i) { A ("     last={0} result={1}" -f $i.LastRunTime, $i.LastTaskResult) }
    }

    A '### C:\Servers\NIR layout'
    foreach ($d in @('C:\Servers\NIR\app', 'C:\Servers\NIR\dev')) {
      if (Test-Path $d) {
        $it = Get-Item $d
        A ("  {0}  linkType={1} target={2}  created={3}" -f $d, $it.LinkType, ($it.Target -join ','), $it.CreationTime)
        foreach ($n in @('server.cjs', 'dist', 'dist\index.html', 'dist\assets', 'dist\weighbridge-worker.cjs', 'runtime', 'logs', 'backups', 'deploy-tmp')) {
          $p = Join-Path $d $n
          if (Test-Path $p) { A ("     {0,-30} {1,-8} {2}  {3}" -f $n, (Get-Item $p).PSIsContainer, (Get-Item $p).LastWriteTime, (Size $p)) }
          else { A ("     {0,-30} MISSING" -f $n) }
        }
      } else { A "  $d MISSING" }
    }

    A '### env files (password masked)'
    foreach ($d in @('C:\Servers\NIR\app', 'C:\Servers\NIR\dev')) {
      $e = Join-Path $d '.env'
      if (Test-Path $e) {
        A "  ---- $e"
        foreach ($ln in (Get-Content $e)) { A ("     " + ($ln -replace '(?i)(password|secret|pwd)=([^@\s]+)', '$1=***')) }
      } else { A "  $e missing" }
    }

    A '### bundle identity (do dev and app serve the same files?)'
    foreach ($d in @('C:\Servers\NIR\app', 'C:\Servers\NIR\dev')) {
      $ih = Join-Path $d 'dist\index.html'
      if (Test-Path $ih) {
        $html = Get-Content $ih -Raw
        $ref = ([regex]::Matches($html, 'assets/index-[A-Za-z0-9_-]+\.(js|css)') | ForEach-Object { $_.Value }) -join ' '
        A ("  {0}  index.html sha={1}  refs={2}" -f $d, (Get-FileHash $ih -Algorithm SHA256).Hash.Substring(0, 16), $ref)
        foreach ($m in ([regex]::Matches($html, 'assets/index-[A-Za-z0-9_-]+\.js') | ForEach-Object { $_.Value })) {
          $bp = Join-Path $d ('dist\' + $m)
          if (Test-Path $bp) { A ("     bundle sha={0}  {1} bytes" -f (Get-FileHash $bp -Algorithm SHA256).Hash.Substring(0, 16), (Get-Item $bp).Length) }
          else { A "     bundle MISSING: $bp" }
        }
      }
    }

    A '### postgres'
    Get-Service | Where-Object { $_.Name -match 'postgres' } | ForEach-Object { A ("  svc {0} {1}" -f $_.Name, $_.Status) }
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    if (Test-Path $psql) {
      $env:PGPASSWORD = 'oDkyX1CnOkKw8rHR94rHQQtRgKv0Q2UG'
      A '  databases:'
      & $psql -U nir_app -h 127.0.0.1 -p 5432 -d postgres -t -A -c "select datname||' | '||pg_size_pretty(pg_database_size(datname)) from pg_database where datistemplate=false order by datname" 2>&1 |
        ForEach-Object { A ("     " + $_) }
      foreach ($db in @('nir_db', 'nir_dev')) {
        $r = & $psql -U nir_app -h 127.0.0.1 -p 5432 -d $db -t -A -c "select count(*) from weighbridge_records" 2>&1
        A ("     {0}: weighbridge_records = {1}" -f $db, ($r -join ' '))
      }
      Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    } else { A "  psql not at $psql" }

    A '### firewall rules mentioning web ports'
    Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'HTTP|HTTPS|80|443|3000|3001|nginx|NIR|Web' } |
      ForEach-Object { A ("  {0} | {1}" -f $_.DisplayName, $_.Profile) }

    A '### certificates (LocalMachine\My)'
    foreach ($c in (Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue)) {
      A ("  {0}  expires {1}  subject={2}" -f $c.Thumbprint, $c.NotAfter, $c.Subject)
    }

    A '### git?'
    foreach ($d in @('C:\Servers\NIR\app', 'C:\Servers\NIR\dev', 'C:\Servers\NIR')) {
      A ("  {0} .git = {1}" -f $d, (Test-Path (Join-Path $d '.git')))
    }

    return $o
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
