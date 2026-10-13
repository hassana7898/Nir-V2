# Remote (VPS) script: READ-ONLY probe of PRODUCTION database nir_db for the same report.
# Output is written UTF-8 and returned as base64 (Persian text survives WinRM).
$envPath = "C:\Servers\NIR\app\.env"
$url = (Select-String -Path $envPath -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
$env:PGPASSWORD = ([regex]::Match($url, "://[^:]+:([^@]+)@")).Groups[1].Value
$pg = "C:\Servers\PostgreSQL\bin\psql.exe"
$out = "C:\Windows\Temp\nir-q-prod.txt"
if (Test-Path $out) { Remove-Item $out -Force }

$qs = @(
  "select 'DBNAME|' || current_database();",
  "select 'USERS|' || role || '|n=' || count(*) || '|with_phone=' || count(phone) from users group by role order by 1;",
  "select 'USERS_PHONES|' || role || '|' || coalesce(phone,'-') || '|' || coalesce(full_name,'-') from users where phone is not null order by role;",
  "select 'FARMERS|total=' || count(*) || '|with_broods=' || count(*) filter (where broods is not null and jsonb_typeof(broods)='array' and jsonb_array_length(broods) > 0) || '|hidden=' || count(*) filter (where is_hidden) || '|deleted=' || count(*) filter (where deleted_at is not null) from farmers;",
  "select 'INV|type=' || coalesce(type,'-') || '|n=' || count(*) || '|null_farmer=' || count(*) filter (where farmer_id is null) from invoices group by type order by 1;",
  "select 'INV_DATE|min=' || min(date) || '|max=' || max(date) from invoices;",
  "select 'WAREHOUSE|' || coalesce(name,'-') || '|' || coalesce(code,'-') || '|' || coalesce(location,'-') || '|del=' || (deleted_at is not null)::text from warehouses order by name;",
  "select 'WB|n=' || count(*) || '|mapped=' || count(mapped_remittance_id) from weighbridge_records;",
  "select 'ORIGINS|n=' || count(*) from origins;",
  "select 'DRIVERS|n=' || count(*) || '|with_phone=' || count(phone) from drivers where deleted_at is null;",
  "select 'PROOFS|n=' || count(*) from delivery_proofs;",
  "select 'ORDERS|n=' || count(*) from farmer_orders;"
)

foreach ($q in $qs) {
  "---- " + $q.Split("'")[1] + " ----" | Out-File -FilePath $out -Append -Encoding UTF8
  ($q | & $pg $url -At) | Out-File -FilePath $out -Append -Encoding UTF8
}

[Convert]::ToBase64String([IO.File]::ReadAllBytes($out))
