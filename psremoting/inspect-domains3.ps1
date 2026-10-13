# Round-3 read-only inventory: supervisors, worker scripts, DB roles/grants, dev logs.
$ErrorActionPreference = 'Stop'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 300000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  Invoke-Command -Session $s -ScriptBlock {
    $o = New-Object System.Collections.Generic.List[string]
    function A([string]$t) { $o.Add($t) }

    A '### every task whose action mentions NIR (proves how prod is started)'
    foreach ($t in (Get-ScheduledTask)) {
      $hit = $false
      foreach ($a in $t.Actions) { if (("$($a.Execute) $($a.Arguments) $($a.WorkingDirectory)") -match 'NIR') { $hit = $true } }
      if ($hit) {
        A ("  task '{0}' state={1} user={2}" -f $t.TaskName, $t.State, $t.Principal.UserId)
        foreach ($a in $t.Actions) { A ("     exec={0} args={1} wd={2}" -f $a.Execute, $a.Arguments, $a.WorkingDirectory) }
        foreach ($tr in $t.Triggers) { A ("     trigger={0} enabled={1} repeat={2}" -f $tr.CimClass.CimClassName, $tr.Enabled, $tr.Repetition.Interval) }
        $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -ErrorAction SilentlyContinue
        if ($i) { A ("     last={0} next={1} result={2}" -f $i.LastRunTime, $i.NextRunTime, $i.LastTaskResult) }
      }
    }

    A '### node process start times (how long have they been up?)'
    foreach ($p in (Get-Process node -ErrorAction SilentlyContinue)) {
      A ("  pid={0} start={1} path={2}" -f $p.Id, $p.StartTime, $p.Path)
    }

    A '### runner scripts'
    foreach ($n in @('RUN-NIR.ps1', 'RUN-DEV.ps1', 'RUN-WEIGHBRIDGE-SYNC.ps1', 'RUN-WEIGHBRIDGE-SYNC-PROD.ps1', 'reload-nginx.ps1', 'nginx-hard-restart.ps1')) {
      $p = Join-Path 'C:\Servers\NIR\scripts' $n
      if (Test-Path $p) {
        A ("  ---- $n")
        foreach ($ln in (Get-Content $p)) { A ("     " + $ln) }
      }
    }

    A '### DB roles + who can reach which DB'
    $psql = 'C:\Servers\PostgreSQL\bin\psql.exe'
    if (Test-Path $psql) {
      $env:PGPASSWORD = 'TodsD86OK4akYHiPe5zYCC9QBSWJ'
      A '  roles:'
      & $psql -U nir_user -h 127.0.0.1 -p 5432 -d postgres -t -A -c "select rolname||' | super='||rolsuper||' | createdb='||rolcreatedb||' | canlogin='||rolcanlogin from pg_roles where rolname not like 'pg\_%' order by rolname" 2>&1 | ForEach-Object { A ("     " + $_) }
      A '  connect privileges on nir_db / nir_dev:'
      & $psql -U nir_user -h 127.0.0.1 -p 5432 -d postgres -t -A -c "select datname||' -> '||coalesce(datacl::text,'(default: owner only)')||' owner='||pg_get_userbyid(datdba) from pg_database where datname in ('nir_db','nir_dev')" 2>&1 | ForEach-Object { A ("     " + $_) }
      foreach ($db in @('nir_db', 'nir_dev')) {
        $tbl = & $psql -U nir_user -h 127.0.0.1 -p 5432 -d $db -t -A -c "select count(*) from information_schema.tables where table_schema='public'" 2>&1
        $wb = & $psql -U nir_user -h 127.0.0.1 -p 5432 -d $db -t -A -c "select count(*) from weighbridge_records" 2>&1
        $usr = & $psql -U nir_user -h 127.0.0.1 -p 5432 -d $db -t -A -c "select count(*) from users" 2>&1
        A ("     {0}: public tables={1}  weighbridge_records={2}  users={3}" -f $db, ($tbl -join ''), ($wb -join ''), ($usr -join ''))
      }
      # what dev's own credentials could still reach (same role for both DBs?)
      A '  does the dev DATABASE_URL user resolve to the same role as prod? nir_user (yes if both use nir_user)'
      Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }

    A '### dev logs (tail)'
    foreach ($f in (Get-ChildItem 'C:\Servers\NIR\dev\logs' -File -ErrorAction SilentlyContinue)) {
      A ("  ---- {0} ({1} bytes, {2})" -f $f.Name, $f.Length, $f.LastWriteTime)
      foreach ($ln in (Get-Content $f.FullName -Tail 4)) { A ("     " + $ln) }
    }

    A '### prod logs (tail)'
    foreach ($f in (Get-ChildItem 'C:\Servers\NIR\app\logs' -File -ErrorAction SilentlyContinue)) {
      A ("  ---- {0} ({1} bytes, {2})" -f $f.Name, $f.Length, $f.LastWriteTime)
      foreach ($ln in (Get-Content $f.FullName -Tail 4)) { A ("     " + $ln) }
    }

    A '### secrets folder + backup log'
    Get-ChildItem 'C:\Servers\NIR\secrets' -Force -ErrorAction SilentlyContinue | ForEach-Object { A ("  {0}  {1} bytes  {2}" -f $_.Name, $_.Length, $_.LastWriteTime) }
    if (Test-Path 'C:\Servers\NIR\logs\backup.log') { foreach ($ln in (Get-Content 'C:\Servers\NIR\logs\backup.log' -Tail 3)) { A ("  backup.log: " + $ln) } }

    A '### which DB does each process actually have open?'
    foreach ($p in (Get-Process node -ErrorAction SilentlyContinue)) {
      $conns = Get-NetTCPConnection -OwningProcess $p.Id -State Established -ErrorAction SilentlyContinue |
        Where-Object { $_.RemotePort -in 5432, 1433 } | Select-Object -ExpandProperty RemotePort -Unique
      A ("  node pid={0} remote ports: {1}" -f $p.Id, ($conns -join ','))
    }

    return $o
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
