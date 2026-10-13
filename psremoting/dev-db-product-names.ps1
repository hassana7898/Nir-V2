# Local script: read-only coverage check of `invoices.product_name` on the DEV database.
#
# Why: the driver-loads endpoint used to answer «نامشخص» for every product because `product_name` is
# empty. Before deciding whether the mobile remittance list needs the same joined fallback, measure how
# much of the real data actually carries the stored name.
#
# Run: .\psremoting\dev-db-product-names.ps1
$ErrorActionPreference = 'Stop'
$credPath = Join-Path $env:USERPROFILE 'vps-cred.xml'
if (-not (Test-Path $credPath)) { throw "credential file not found: $credPath" }
$cred = Import-Clixml $credPath
$hostIp = '194.60.230.236'
$session = New-PSSession -ComputerName $hostIp -Port 5985 -Credential $cred -Authentication Negotiate

$remote = {
  $envPath = 'C:\Servers\NIR\dev\.env'
  $url = (Select-String -Path $envPath -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
  if ($url -notmatch '/nir_dev') { throw "refusing: not the dev database ($url)" }
  $env:PGPASSWORD = ([regex]::Match($url, '://[^:]+:([^@]+)@')).Groups[1].Value
  $pg = 'C:\Servers\PostgreSQL\bin\psql.exe'

  '---- product_name coverage (deleted_at is null) ----'
  @'
select type || ' | rows=' || count(*) || ' | with_name=' || count(nullif(btrim(product_name), '')) || ' | with_product_id=' || count(product_id)
from invoices where deleted_at is null group by type order by 1;
'@ | & $pg $url -At

  '---- top products referenced by invoices ----'
  @'
select coalesce(i.product_id, '(no_product_id)') || ' | stored_name=' || coalesce(nullif(btrim(i.product_name), ''), '(empty)') || ' | product_master=' || coalesce(p.name, '(missing)') || ' | rows=' || count(*)
from invoices i left join products p on p.id = i.product_id
where i.deleted_at is null
group by i.product_id, i.product_name, p.name
order by count(*) desc limit 8;
'@ | & $pg $url -At
}

try {
  Invoke-Command -Session $session -ScriptBlock $remote
} finally {
  Remove-PSSession -Session $session
}
