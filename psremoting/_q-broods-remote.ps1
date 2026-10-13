# Remote (VPS) script: READ-ONLY probe of nir_dev for the "missing farmers / periods / waybills" report.
# All output is written to a UTF-8 file and returned as base64 so Persian text survives WinRM.
$envPath = "C:\Servers\NIR\dev\.env"
$url = (Select-String -Path $envPath -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
$env:PGPASSWORD = ([regex]::Match($url, "://[^:]+:([^@]+)@")).Groups[1].Value
$pg = "C:\Servers\PostgreSQL\bin\psql.exe"
$out = "C:\Windows\Temp\nir-q-broods.txt"
if (Test-Path $out) { Remove-Item $out -Force }

$qs = @(
  "select 'USERS|' || id || '|' || username || '|' || role || '|' || coalesce(phone,'-') || '|' || coalesce(driver_id,'-') || '|' || coalesce(farmer_id,'-') from users order by role, username;",
  "select 'FARMERS|total=' || count(*) || '|with_broods=' || count(*) filter (where broods is not null and jsonb_typeof(broods)='array' and jsonb_array_length(broods) > 0) || '|hidden=' || count(*) filter (where is_hidden) || '|deleted=' || count(*) filter (where deleted_at is not null) from farmers;",
  "select 'INV|type=' || coalesce(type,'-') || '|n=' || count(*) || '|null_farmer=' || count(*) filter (where farmer_id is null) || '|distinct_farmer=' || count(distinct farmer_id) from invoices group by type order by 1;",
  "select 'INV_DATE|min=' || min(date) || '|max=' || max(date) from invoices;",
  "select 'ORIGIN|' || coalesce(name,'-') from origins order by name;",
  "select 'FACTORY|' || coalesce(factory,'-') || '|n=' || count(*) from invoices group by factory order by count(*) desc;",
  "select 'BROOD_SAMPLE|' || name || '|' || coalesce(broods::text,'null') from farmers where broods is not null and jsonb_array_length(broods) > 0 limit 3;",
  "select 'WB_DIR|direction=' || coalesce(direction,'-') || '|n=' || count(*) || '|mapped=' || count(mapped_remittance_id) from weighbridge_records group by direction order by 1;",
  "select 'INVNO_SAMPLE|' || coalesce(invoice_number,'-') || '|' || coalesce(bill_number,'-') || '|' || coalesce(seller_name,'-') from invoices order by created_at desc nulls last limit 5;"
)

foreach ($q in $qs) {
  "---- " + $q.Split("'")[1] + " ----" | Out-File -FilePath $out -Append -Encoding UTF8
  ($q | & $pg $url -At) | Out-File -FilePath $out -Append -Encoding UTF8
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($out))
$b64
