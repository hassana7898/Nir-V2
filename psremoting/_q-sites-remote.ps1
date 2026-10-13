# Remote (VPS) READ-ONLY probe #2: env KEY NAMES only (values never printed) + weighbridge source split.
$out = "C:\Windows\Temp\nir-q-sites.txt"
if (Test-Path $out) { Remove-Item $out -Force }

foreach ($pair in @(@('PROD','C:\Servers\NIR\app\.env'), @('DEV','C:\Servers\NIR\dev\.env'))) {
  "---- ENV KEYS: " + $pair[0] + " (" + $pair[1] + ") ----" | Out-File -FilePath $out -Append -Encoding UTF8
  if (Test-Path $pair[1]) {
    (Get-Content $pair[1]) | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object {
      $k = ($_ -split '=', 2)[0].Trim()
      $v = ($_ -split '=', 2)[1]
      $k + " (len=" + $v.Length + ")"
    } | Out-File -FilePath $out -Append -Encoding UTF8
  } else { "MISSING" | Out-File -FilePath $out -Append -Encoding UTF8 }
}

$pg = "C:\Servers\PostgreSQL\bin\psql.exe"
foreach ($db in @(@('PROD','C:\Servers\NIR\app\.env'), @('DEV','C:\Servers\NIR\dev\.env'))) {
  $url = (Select-String -Path $db[1] -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
  $env:PGPASSWORD = ([regex]::Match($url, "://[^:]+:([^@]+)@")).Groups[1].Value
  "---- " + $db[0] + " weighbridge source / goods / customer ----" | Out-File -FilePath $out -Append -Encoding UTF8
  @(
    "select 'SRC|' || coalesce(source,'-') || '|n=' || count(*) from weighbridge_records group by source order by count(*) desc;",
    "select 'GOODS_TOP|' || coalesce(goods,'-') || '|n=' || count(*) from weighbridge_records group by goods order by count(*) desc limit 10;",
    "select 'WB_TICKETS|min=' || min(weigh_time)::text || '|max=' || max(weigh_time)::text from weighbridge_records;"
  ) | ForEach-Object {
    ($_ | & $pg $url -At) | Out-File -FilePath $out -Append -Encoding UTF8
  }
}

"---- C:\Servers\NIR tree ----" | Out-File -FilePath $out -Append -Encoding UTF8
(Get-ChildItem 'C:\Servers\NIR' -Force | Select-Object -ExpandProperty Name) | Out-File -FilePath $out -Append -Encoding UTF8

[Convert]::ToBase64String([IO.File]::ReadAllBytes($out))
