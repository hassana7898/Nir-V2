# Phase A / step 3 — give dev.artadan.ir its own nginx process and config.
#
# Only one public IP / one :443 listener exists, so TLS for both vhosts must stay on the main
# nginx (C:\Servers\Nginx). What this changes is the blast radius: the risky parts of the dev
# config (proxy tuning, gzip, headers, timeouts, caching) move into C:\Servers\NginxDev, a
# separate nginx process on 127.0.0.1:8081. The main nginx keeps a stable stub for
# dev.artadan.ir -> 127.0.0.1:8081, so a broken dev config can no longer stop the main nginx
# from starting/reloading (which would have taken app.artadan.ir down with it).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File psremoting\dev-nginx-split.ps1
[CmdletBinding()]
param([switch] $SkipSharedReload)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cred = Import-Clixml (Join-Path $env:USERPROFILE 'vps-cred.xml')
$opt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck -OpenTimeout 60000 -OperationTimeout 600000
$s = New-PSSession -ComputerName '194.60.230.236' -Port 5985 -Credential $cred -Authentication Negotiate -SessionOption $opt

try {
  Invoke-Command -Session $s -ArgumentList $stamp, $SkipSharedReload.IsPresent -ScriptBlock {
    param($stamp, $skipSharedReload)
    $o = New-Object System.Collections.Generic.List[string]
    function A([string] $t) { $o.Add($t) }
    function Http([string] $url) {
      try { $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8; "$($r.StatusCode)" } catch { 'ERR' }
    }

    $main = 'C:\Servers\Nginx'
    $dng = 'C:\Servers\NginxDev'
    $dev = 'C:\Servers\NIR\dev'
    $scripts = 'C:\Servers\NIR\scripts'
    $bak = Join-Path $dev "backups\nginx-split-$stamp"
    New-Item -ItemType Directory -Force -Path $bak | Out-Null
    Copy-Item (Join-Path $main 'conf\sites\dev.artadan.ir-ssl.conf') $bak -Force
    Copy-Item (Join-Path $main 'conf\sites\dev.artadan.ir.conf') $bak -Force
    A "step0 prod health before : $(Http 'http://127.0.0.1:3000/api/health')"
    A "step0 dev  health before : $(Http 'http://127.0.0.1:3001/api/health')"
    A "step1 config backup      : $bak"

    # ---------------------------------------------------------------- 1) the dev nginx install
    if (-not (Test-Path "$dng\nginx.exe")) {
      New-Item -ItemType Directory -Force -Path "$dng\conf", "$dng\logs", "$dng\html", "$dng\temp" | Out-Null
      Copy-Item "$main\nginx.exe" $dng -Force
      foreach ($f in @('mime.types', 'fastcgi_params', 'koi-utf', 'koi-win', 'scgi_params', 'uwsgi_params', 'win-utf')) {
        $src = Join-Path $main "conf\$f"
        if (Test-Path $src) { Copy-Item $src "$dng\conf" -Force }
      }
      foreach ($f in @('index.html', '50x.html')) {
        $src = Join-Path $main "html\$f"
        if (Test-Path $src) { Copy-Item $src "$dng\html" -Force }
      }
      A "step2 dev nginx install  : $dng (nginx.exe + conf scratch + logs)"
    } else {
      A "step2 dev nginx install  : already present at $dng"
    }

    # ---------------------------------------------------------------- 2) dev nginx.conf (dev owns its proxy)
    $conf = @'
# dev-only nginx for dev.artadan.ir - own process, own config, own logs, loopback only.
#
# The public TLS listener (:443) belongs to C:\Servers\Nginx because this box has a single IP.
# That main nginx keeps a STABLE stub:  dev.artadan.ir -> http://127.0.0.1:8081  (this file).
# Everything experimental for dev (timeouts, headers, compression, caching, extra locations)
# belongs HERE: whatever you break in this file can only affect dev.artadan.ir.
worker_processes  1;
error_log  logs/dev-error.log  warn;
pid        logs/dev-nginx.pid;

events {
    worker_connections  512;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;
    client_max_body_size 50m;
    server_tokens off;

    access_log  logs/dev-access.log;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_vary on;
    gzip_types text/plain text/css text/xml application/javascript text/javascript application/x-javascript application/json application/xml image/svg+xml font/woff font/woff2 application/wasm;

    server {
        listen       127.0.0.1:8081;
        server_name  dev.artadan.ir;

        # health probe for the dev watchdog
        location = /nginx-dev-health {
            default_type text/plain;
            return 200 "dev-nginx ok\n";
        }

        location / {
            proxy_pass         http://127.0.0.1:3001;
            proxy_http_version 1.1;
            proxy_set_header   Host              $host;
            proxy_set_header   X-Real-IP         $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto https;
            proxy_set_header   Upgrade           $http_upgrade;
            proxy_set_header   Connection        "upgrade";
            proxy_read_timeout 300s;
            proxy_send_timeout 300s;
        }
    }
}
'@
    Set-Content -Path "$dng\conf\nginx.conf" -Value $conf -Encoding ASCII
    A 'step3 dev nginx.conf     : written (listen 127.0.0.1:8081 -> 127.0.0.1:3001, own logs)'

    $runner = @'
$ng = 'C:\Servers\NginxDev'
$log = 'C:\Servers\NIR\dev\logs'
New-Item -ItemType Directory -Force -Path $log | Out-Null
Set-Location $ng
& "$ng\nginx.exe" -p "$ng" -c "conf\nginx.conf" *>> "$log\dev-nginx-console.log"
'@
    Set-Content -Path (Join-Path $scripts 'RUN-NGINX-DEV.ps1') -Value $runner -Encoding UTF8
    A 'step3 dev nginx runner   : RUN-NGINX-DEV.ps1 written'

    # boot task, trigger/settings cloned from the prod nginx task
    $srcTask = Get-ScheduledTask -TaskName 'NIR Nginx Proxy' -ErrorAction SilentlyContinue
    if ($srcTask) {
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $scripts 'RUN-NGINX-DEV.ps1'))
      Register-ScheduledTask -TaskName 'NIR Dev Nginx' -Action $action -Trigger $srcTask.Triggers -Settings $srcTask.Settings -Principal $srcTask.Principal -Force | Out-Null
      A 'step3 dev nginx task     : NIR Dev Nginx registered (boot trigger cloned from NIR Nginx Proxy)'
    } else {
      A 'step3 dev nginx task     : WARNING - NIR Nginx Proxy not found, task not registered'
    }

    # ---------------------------------------------------------------- 3) syntax test + start the dev nginx
    Push-Location $dng
    $t = & "$dng\nginx.exe" -p $dng -c 'conf\nginx.conf' -t 2>&1
    $tCode = $LASTEXITCODE
    Pop-Location
    foreach ($ln in $t) { A ("     nginx -t: " + $ln) }
    if ($tCode -ne 0) { throw "dev nginx config test failed (exit=$tCode)" }

    $devProcs = @(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$dng\nginx.exe" })
    if ($devProcs.Count -eq 0) {
      Start-Process -FilePath "$dng\nginx.exe" -ArgumentList '-p', $dng, '-c', 'conf\nginx.conf' -WorkingDirectory $dng -WindowStyle Hidden
      Start-Sleep -Seconds 3
      $devProcs = @(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$dng\nginx.exe" })
    }
    A "step4 dev nginx processes: $($devProcs.Count)"
    A "step4 probe 8081         : health=$(Http 'http://127.0.0.1:8081/nginx-dev-health')  api=$(Http 'http://127.0.0.1:8081/api/health')"

    # ---------------------------------------------------------------- 4) main nginx: stable stub only
    if (-not $skipSharedReload) {
      $shared = Join-Path $main 'conf\sites\dev.artadan.ir-ssl.conf'
      $txt = [System.IO.File]::ReadAllText($shared, [System.Text.Encoding]::UTF8)
      if ($txt -match 'proxy_pass\s+http://127\.0\.0\.1:3001;') {
        $txt = $txt -replace 'proxy_pass\s+http://127\.0\.0\.1:3001;', 'proxy_pass         http://127.0.0.1:8081;   # stable stub -> dev-owned nginx (C:\Servers\NginxDev)'
        $txt = $txt -replace '# dev\.artadan\.ir -> NIR DEV \(127\.0\.0\.1:3001\)\s+\[HTTPS\]\s+staging clone of app\.artadan\.ir', "# dev.artadan.ir -> dev-owned nginx 127.0.0.1:8081 (which proxies NIR DEV on 3001)`r`n# KEEP THIS BLOCK STATIC - dev tuning belongs in C:\Servers\NginxDev\conf\nginx.conf"
        [System.IO.File]::WriteAllText($shared, $txt, (New-Object System.Text.UTF8Encoding($false)))
        A 'step5 main nginx         : dev.artadan.ir-ssl.conf now proxies dev to the dev nginx (8081)'
      } elseif ($txt -match 'proxy_pass\s+http://127\.0\.0\.1:8081;') {
        A 'step5 main nginx         : already proxying dev to 8081 (no change)'
      } else {
        A 'step5 main nginx         : WARNING - unexpected proxy_pass in dev.artadan.ir-ssl.conf; left untouched'
      }

      Push-Location $main
      $mt = & "$main\nginx.exe" -p $main -c 'conf\nginx.conf' -t 2>&1
      $mtCode = $LASTEXITCODE
      Pop-Location
      foreach ($ln in $mt) { A ("     main nginx -t: " + $ln) }

      if ($mtCode -ne 0) {
        Copy-Item (Join-Path $bak 'dev.artadan.ir-ssl.conf') $shared -Force
        A 'step6 reload             : main config test FAILED - conf restored, NOT reloaded (prod untouched)'
      } else {
        Push-Location $main
        & "$main\nginx.exe" -p $main -c 'conf\nginx.conf' -s reload 2>&1 | ForEach-Object { A ("     reload: " + $_) }
        $rCode = $LASTEXITCODE
        Pop-Location
        if ($rCode -ne 0) {
          A 'step6 reload             : graceful signal refused; using reload-nginx.ps1 (test-then-restart)'
          & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'reload-nginx.ps1') | Out-Null
        } else {
          A 'step6 reload             : main nginx reloaded with the stub'
        }
        Start-Sleep -Seconds 3
      }
    } else {
      A 'step5/6 main nginx       : SKIPPED (-SkipSharedReload)'
    }

    A "step7 prod health        : $(Http 'http://127.0.0.1:3000/api/health')   (must stay 200)"
    A "step7 dev  health        : direct=$(Http 'http://127.0.0.1:3001/api/health')  via-dev-nginx=$(Http 'http://127.0.0.1:8081/api/health')"
    A ('step7 nginx processes   : main=' + (@(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$main\nginx.exe" }).Count) + '  dev=' + (@(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$dng\nginx.exe" }).Count))
    return $o
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
