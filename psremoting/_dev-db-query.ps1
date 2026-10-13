# Remote (VPS) script: read-only inventory of the DEV database nir_dev.
# Sent over WinRM with `Invoke-Command -FilePath`. Contains NO writes.
$envPath = "C:\Servers\NIR\dev\.env"
$url = (Select-String -Path $envPath -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches[0].Groups[1].Value.Trim().Trim([char]34)
$env:PGPASSWORD = ([regex]::Match($url, "://[^:]+:([^@]+)@")).Groups[1].Value
$pg = "C:\Servers\PostgreSQL\bin\psql.exe"
"ENDPOINT: " + ($url -replace "://[^:]+:[^@]+@", "://***:***@")

"---- TABLES (name | cols | live_rows) ----"
$q1 = @'
select t.table_name || ' | ' || count(c.column_name) || ' cols | ' || coalesce(s.n_live_tup, 0) || ' rows'
from information_schema.tables t
join information_schema.columns c on c.table_name = t.table_name and c.table_schema = t.table_schema
left join pg_stat_user_tables s on s.relname = t.table_name
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
group by t.table_name, s.n_live_tup
order by t.table_name;
'@
$q1 | & $pg $url -At

"---- USERS BY ROLE (role | total | driver | farmer | phone) ----"
$q2 = @'
select role || ' | total=' || count(*) || ' | driver=' || count(driver_id) || ' | farmer=' || count(farmer_id) || ' | phone=' || count(phone)
from users group by role order by 1;
'@
$q2 | & $pg $url -At

"---- MOBILE COUNTS ----"
$q3 = @'
select 'otp=' || (select count(*) from otp_codes) || ' device_tokens=' || (select count(*) from device_tokens) ||
       ' delivery_proofs=' || (select count(*) from delivery_proofs) || ' farmer_orders=' || (select count(*) from farmer_orders) ||
       ' wb_records=' || (select count(*) from weighbridge_records) || ' invoices=' || (select count(*) from invoices) ||
       ' farmers=' || (select count(*) from farmers) || ' drivers=' || (select count(*) from drivers);
'@
$q3 | & $pg $url -At

foreach ($tbl in @('invoices', 'weighbridge_records', 'delivery_proofs', 'farmer_orders', 'farmers', 'drivers', 'users')) {
  "---- COLUMNS: $tbl ----"
  "select column_name || ' : ' || data_type from information_schema.columns where table_name = '$tbl' order by ordinal_position;" | & $pg $url -At
}
