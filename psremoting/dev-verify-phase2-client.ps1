# Live verification of the PHASE 2 CLIENT contract against the DEV deployment (https://dev.artadan.ir).
#
# Local script (no WinRM): it calls the public dev host with the same endpoints the APK uses, so the
# answer proves the deployed server, not a local build. It checks the fields the new mobile screens
# depend on:
#   1. the manager number (your own) still logs in by OTP and resolves to MANAGER;
#   2. `GET /api/invoices` carries the additive `masterProductName` for rows whose stored
#      `product_name` is empty (the reason the remittance list used to read «نامشخص»);
#   3. `GET /api/mobile/manager/kpi` returns the live inventory rows the «انبار و سیلو» tab renders;
#   4. `GET /api/mobile/driver/loads` returns a real product name taken from the product master.
#
# Run: .\psremoting\dev-verify-phase2-client.ps1 [-ManagerPhone 09XXXXXXXXX] [-DriverPhone 09XXXXXXXXX]
[CmdletBinding()]
param(
  [string] $ManagerPhone = '09392893377',
  [string] $DriverPhone = '09120000001',
  [string] $Base = 'https://dev.artadan.ir'
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'logs\dev-verify-phase2-client.json'

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Token, $Body)
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$Base$Path"; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Compress) }
  try {
    return @{ status = 200; body = (Invoke-RestMethod @params) }
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    return @{ status = $status; body = $null }
  }
}

function Get-OtpToken {
  param([string]$Phone)
  $request = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/request' -Body @{ phone = $Phone }
  $code = $request.body.debugCode
  if (-not $code) { throw "no debugCode for $Phone on $Base (is the dev OTP debug switch on?)" }
  $verify = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/verify' -Body @{ phone = $Phone; code = $code }
  return $verify.body
}

$results = [ordered]@{ runAt = (Get-Date).ToString('s'); base = $Base; managerPhone = $ManagerPhone }

# ---------------------------------------------------------------- 1) manager login
$manager = Get-OtpToken -Phone $ManagerPhone
$managerToken = $manager.accessToken
$results.managerLogin = [ordered]@{ role = $manager.user.role; userId = $manager.user.id; hasToken = [bool]$managerToken }

# ---------------------------------------------------------------- 2) invoice list: product name fallback
$invoices = Invoke-Api -Method 'GET' -Path '/api/invoices?type=exit&limit=10&page=1' -Token $managerToken
$rows = @($invoices.body.data)
$withStoredName = @($rows | Where-Object { $_.productName }).Count
$withResolvedName = @($rows | Where-Object { -not $_.productName -and $_.masterProductName }).Count
$withoutAnyName = @($rows | Where-Object { -not $_.productName -and -not $_.masterProductName }).Count

# ---------------------------------------------------------------- 3) KPI inventory (the silo tab)
$kpi = Invoke-Api -Method 'GET' -Path '/api/mobile/manager/kpi' -Token $managerToken
$inventory = @($kpi.body.inventory)
$productMasterNames = @($inventory | ForEach-Object { $_.name })

$results.invoiceList = [ordered]@{
  status              = $invoices.status
  total               = $invoices.body.total
  rowsChecked         = $rows.Count
  rowsWithStoredName  = $withStoredName
  rowsResolvedName    = $withResolvedName
  rowsWithoutAnyName  = $withoutAnyName
}

$results.managerKpi = [ordered]@{
  status          = $kpi.status
  todayJalali     = $kpi.body.todayJalali
  entryTonnageKg  = $kpi.body.entryTonnageKg
  exitTonnageKg   = $kpi.body.exitTonnageKg
  invoicesToday   = $kpi.body.todayInvoicesCount
  weighbridgeToday = $kpi.body.weighbridgeTicketsToday
  inventoryItems  = $inventory.Count
  lowOrOutItems   = @($inventory | Where-Object { [double]$_.currentStock -le 0 -or ($null -ne $_.minStock -and [double]$_.currentStock -lt [double]$_.minStock) }).Count
}

# ---------------------------------------------------------------- 4) driver loads: real product name
$driver = Get-OtpToken -Phone $DriverPhone
$driverToken = $driver.accessToken
$loads = Invoke-Api -Method 'GET' -Path '/api/mobile/driver/loads?scope=active&limit=10&page=1' -Token $driverToken
$activeLoads = @($loads.body.activeLoads)
$namedFromMaster = @($activeLoads | Where-Object { $productMasterNames -contains $_.productName }).Count
$tripStatuses = @($activeLoads | ForEach-Object { $_.tripStatus } | Sort-Object -Unique)

$results.driverLoads = [ordered]@{
  role             = $driver.user.role
  status           = $loads.status
  total            = $loads.body.total
  rowsChecked      = $activeLoads.Count
  namedFromMaster  = $namedFromMaster
  tripStatusesSeen = $tripStatuses
  sample           = @($activeLoads | Select-Object -First 3 | ForEach-Object {
      [ordered]@{ id = $_.id; productName = $_.productName; tripStatus = $_.tripStatus; hasProof = $_.hasProofOfDelivery }
    })
}

$results | ConvertTo-Json -Depth 8 | Set-Content -Path $logPath -Encoding UTF8
"written: $logPath"
"manager: status=$($invoices.status) role=$($results.managerLogin.role) exitTotal=$($results.invoiceList.total)"
"invoice rows: checked=$($rows.Count) storedName=$withStoredName resolvedFromMaster=$withResolvedName none=$withoutAnyName"
"kpi: inventoryItems=$($inventory.Count) lowOrOut=$($results.managerKpi.lowOrOutItems) entryKg=$($kpi.body.entryTonnageKg) exitKg=$($kpi.body.exitTonnageKg)"
"driver loads: rows=$($activeLoads.Count) namedFromMaster=$namedFromMaster tripStatuses=$($tripStatuses -join ',')"
