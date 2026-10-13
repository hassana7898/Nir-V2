# Remote (VPS) read-only probe #2: dev env flags + data-shape counts that decide
# whether the driver/farmer mobile flows can work against nir_dev today.
$envPath = "C:\Servers\NIR\dev\.env"
"---- DEV .env (secret values masked) ----"
Get-Content $envPath | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq '' -or $line.StartsWith('#')) { return }
  if ($line -match '^(?<k>[A-Za-z0-9_]+)\s*=\s*(?<v>.*)$') {
    $k = $Matches['k']; $v = $Matches['v'].Trim().Trim([char]34)
    if ($k -match 'PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL') { $v = '<masked len=' + $v.Length + '>' }
    "$k = $v"
  }
}

$url = (Select-String -Path $envPath -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
$env:PGPASSWORD = ([regex]::Match($url, "://[^:]+:([^@]+)@")).Groups[1].Value
$pg = "C:\Servers\PostgreSQL\bin\psql.exe"

"---- DATA SHAPE FOR MOBILE FLOWS ----"
$q = @'
select 'invoices_total=' || (select count(*) from invoices)
    || ' | invoices_driver_name_set=' || (select count(*) from invoices where driver_name is not null and driver_name <> '')
    || ' | invoices_driver_phone_set=' || (select count(*) from invoices where driver_phone is not null and driver_phone <> '')
    || ' | invoices_with_farmer_id=' || (select count(*) from invoices where farmer_id is not null)
    || ' | invoices_exit=' || (select count(*) from invoices where type = 'exit')
    || ' | drivers_total=' || (select count(*) from drivers)
    || ' | drivers_phone_set=' || (select count(*) from drivers where phone is not null and phone <> '')
    || ' | farmers_phone_set=' || (select count(*) from farmers where phone is not null and phone <> '')
    || ' | wb_total=' || (select count(*) from weighbridge_records)
    || ' | wb_mapped=' || (select count(*) from weighbridge_records where mapped_remittance_id is not null)
    || ' | wb_two_weighings=' || (select count(*) from weighbridge_records where gross_weight > 0 and tare_weight > 0);
'@
$q | & $pg $url -At

"---- NAME-MATCH JOIN RISK (invoice.driver_name distinct vs drivers.name) ----"
$q2 = @'
select 'distinct_invoice_driver_names=' || (select count(distinct driver_name) from invoices where driver_name is not null and driver_name <> '')
    || ' | of_those_matching_a_driver_row=' ||
       (select count(distinct i.driver_name) from invoices i join drivers d on d.name = i.driver_name where i.driver_name is not null and i.driver_name <> '');
'@
$q2 | & $pg $url -At

"---- wb mapping coverage vs invoices ----"
$q3 = @'
select 'wb_mapped_distinct_invoices=' || (select count(distinct mapped_remittance_id) from weighbridge_records where mapped_remittance_id is not null)
    || ' | wb_mapped_pointing_to_existing_invoice=' ||
       (select count(distinct w.mapped_remittance_id) from weighbridge_records w join invoices i on i.id = w.mapped_remittance_id)
    || ' | wb_direction_values=' || (select string_agg(distinct coalesce(direction, 'null'), ',' ) from weighbridge_records);
'@
$q3 | & $pg $url -At

"---- running node processes (which env serves dev) ----"
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Select-Object ProcessId, @{n='cmd';e={$_.CommandLine}} | Format-List
