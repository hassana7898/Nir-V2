# Live verification of the Phase 2 mobile API against the DEV deployment (https://dev.artadan.ir).
#
# This is a LOCAL script: it talks to the public dev host with the same endpoints the APK uses, so it
# proves the deployed server (not a local build). It writes logs\dev-verify-phase2.json as UTF-8 so
# the Persian payloads stay readable.
#
# What it proves, in order:
#   1. the seeded manager number still logs in by OTP and resolves to role MANAGER;
#   2. the manager's waybill listing (the web /api/invoices the app reuses) is paginated and filtered;
#   3. the new manager unmatched-driver report returns real groups and is 403 for a driver token;
#   4. the driver's load history is paged and carries tripStatus;
#   5. a trip report moves forward, is stored, and a backwards report is refused (409).
#
# Run: .\psremoting\dev-verify-mobile-phase2.ps1
$ErrorActionPreference = 'Stop'
$base = 'https://dev.artadan.ir'
$logPath = Join-Path $PSScriptRoot '..\logs\dev-verify-phase2.json'

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Token, $Body)
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$base$Path"; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Compress) }
  try {
    $response = Invoke-RestMethod @params
    return @{ status = 200; body = $response }
  } catch {
    $status = $null
    $payload = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object IO.StreamReader($stream)
      $payload = $reader.ReadToEnd()
    } catch {}
    return @{ status = $status; body = $payload }
  }
}

$results = [ordered]@{ runAt = (Get-Date).ToString('s'); base = $base }

# ---------------------------------------------------------------- 1) manager OTP login
$managerPhone = '09120000003'
$otp = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/request' -Body @{ phone = $managerPhone }
$code = $otp.body.debugCode
$verify = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/verify' -Body @{ phone = $managerPhone; code = $code }
$managerToken = $verify.body.accessToken
$results.managerLogin = [ordered]@{
  otpRequestStatus = $otp.status
  otpVerifyStatus  = $verify.status
  role             = $verify.body.user.role
  fullName         = $verify.body.user.fullName
  hasToken         = [bool]$managerToken
}

# ---------------------------------------------------------------- 2) manager waybill list (web API the app reuses)
$exitList = Invoke-Api -Method 'GET' -Path '/api/invoices?type=exit&limit=3&page=1' -Token $managerToken
$entryList = Invoke-Api -Method 'GET' -Path '/api/invoices?type=entry&limit=3&page=1' -Token $managerToken
$results.managerWaybills = [ordered]@{
  exitStatus  = $exitList.status
  exitTotal   = $exitList.body.total
  exitPages   = $exitList.body.totalPages
  exitRows    = @($exitList.body.data).Count
  entryStatus = $entryList.status
  entryTotal  = $entryList.body.total
  entryPages  = $entryList.body.totalPages
}

# ---------------------------------------------------------------- 3) unmatched drivers report
$unmatched = Invoke-Api -Method 'GET' -Path '/api/mobile/manager/unmatched-drivers?limit=5' -Token $managerToken
$results.unmatchedDrivers = [ordered]@{
  status        = $unmatched.status
  totalGroups   = $unmatched.body.totalGroups
  totalInvoices = $unmatched.body.totalInvoices
  scanned       = $unmatched.body.scannedInvoices
  truncated     = $unmatched.body.truncated
  exitOnly      = (Invoke-Api -Method 'GET' -Path '/api/mobile/manager/unmatched-drivers?type=exit&limit=5' -Token $managerToken).body.totalGroups
  entryOnly     = (Invoke-Api -Method 'GET' -Path '/api/mobile/manager/unmatched-drivers?type=entry&limit=5' -Token $managerToken).body.totalGroups
  topGroups     = @($unmatched.body.groups | Select-Object -First 5 | ForEach-Object {
      [ordered]@{ name = $_.driverName; count = $_.count; exitCount = $_.exitCount; entryCount = $_.entryCount
                  newestDate = $_.newestDate; suggestion = $_.suggestedDriverName; reason = $_.suggestionReason }
    })
}

# ---------------------------------------------------------------- 4) driver loads + trip status
$driverPhone = '09120000001'
$dOtp = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/request' -Body @{ phone = $driverPhone }
$dVerify = Invoke-Api -Method 'POST' -Path '/api/mobile/auth/otp/verify' -Body @{ phone = $driverPhone; code = $dOtp.body.debugCode }
$driverToken = $dVerify.body.accessToken

$results.unmatchedForbiddenForDriver = (Invoke-Api -Method 'GET' -Path '/api/mobile/manager/unmatched-drivers' -Token $driverToken).status

$active = Invoke-Api -Method 'GET' -Path '/api/mobile/driver/loads?scope=active&limit=3&page=1' -Token $driverToken
$results.driverLoads = [ordered]@{
  role          = $dVerify.body.user.role
  status        = $active.status
  scope         = $active.body.scope
  total         = $active.body.total
  totalPages    = $active.body.totalPages
  hasMore       = $active.body.hasMore
  activeRows    = @($active.body.activeLoads).Count
  completedRows = @($active.body.completedLoads).Count
  firstLoads    = @($active.body.activeLoads | Select-Object -First 3 | ForEach-Object {
      [ordered]@{ id = $_.id; date = $_.date; product = $_.productName; tripStatus = $_.tripStatus }
    })
}

$firstLoad = @($active.body.activeLoads)[0]
if ($firstLoad) {
  $forward = Invoke-Api -Method 'PATCH' -Path "/api/mobile/driver/loads/$($firstLoad.id)/trip-status" -Token $driverToken -Body @{ status = 'at_origin' }
  $results.tripStatusForward = [ordered]@{ status = $forward.status; body = $forward.body }
  $backward = Invoke-Api -Method 'PATCH' -Path "/api/mobile/driver/loads/$($firstLoad.id)/trip-status" -Token $driverToken -Body @{ status = 'assigned' }
  $results.tripStatusBackwards = [ordered]@{ status = $backward.status; body = $backward.body }
  $reload = Invoke-Api -Method 'GET' -Path '/api/mobile/driver/loads?scope=active&limit=20&page=1' -Token $driverToken
  $results.tripStatusAfterReload = @($reload.body.activeLoads | Where-Object { $_.id -eq $firstLoad.id } | ForEach-Object { $_.tripStatus })
}

$results | ConvertTo-Json -Depth 8 | Set-Content -Path $logPath -Encoding UTF8
"written: $logPath"
$results.managerLogin | ConvertTo-Json -Compress
$results.managerWaybills | ConvertTo-Json -Compress
"unmatched: groups=$($results.unmatchedDrivers.totalGroups) invoices=$($results.unmatchedDrivers.totalInvoices) exitOnly=$($results.unmatchedDrivers.exitOnly) entryOnly=$($results.unmatchedDrivers.entryOnly) forbiddenForDriver=$($results.unmatchedForbiddenForDriver)"
$results.driverLoads | ConvertTo-Json -Compress
"forward=$($results.tripStatusForward.status) backwards=$($results.tripStatusBackwards.status) after=$($results.tripStatusAfterReload -join ',')"

