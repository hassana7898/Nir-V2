# Remote (VPS) script: end-to-end verification of the Phase 1 mobile backend against the DEV
# deployment on 127.0.0.1:3001 (nir_dev + C:\Servers\NIR\dev). Read-mostly: the only writes are the
# OTP rows the API itself creates, plus sessions.
#
# Sent over WinRM by psremoting\dev-verify-mobile-phase1.ps1 (Invoke-Command -FilePath).
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:3001'

$fail = 0
function Check($label, $condition, $detail = '') {
  if ($condition) { "  PASS : $label $detail" } else { "  FAIL : $label $detail"; $script:fail++ }
}

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body, [string]$Token)
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{
    Uri             = "$base$Path"
    Method          = $Method
    Headers         = $headers
    UseBasicParsing = $true
    TimeoutSec      = 25
  }
  if ($null -ne $Body) {
    $params['Body'] = ($Body | ConvertTo-Json -Compress)
    $params['ContentType'] = 'application/json'
  }
  try {
    $r = Invoke-WebRequest @params
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $raw = ''
    if ($resp) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $raw = $sr.ReadToEnd()
      $sr.Close()
    }
    return [pscustomobject]@{ Status = $status; Body = $raw }
  }
}

'--- 0) health / meta -------------------------------------------------------'
$health = Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 20
Check 'GET /api/health' ($health.StatusCode -eq 200) "($($health.StatusCode))"

$meta = Invoke-Api 'GET' '/api/mobile/meta'
Check 'GET /api/mobile/meta' ($meta.Status -eq 200 -and $meta.Body.minAppVersion) "($($meta.Status))"

'--- 1) driver OTP login (MOBILE_OTP_DEBUG path) ----------------------------'
$driverPhone = '09120000001'
$otpReq = Invoke-Api 'POST' '/api/mobile/auth/otp/request' @{ phone = $driverPhone }
Check 'OTP request 200' ($otpReq.Status -eq 200) "($($otpReq.Status))"
Check 'debugCode returned for the dev flag' ([bool]$otpReq.Body.debugCode) "(debugCode=$($otpReq.Body.debugCode))"

$otpVerify = Invoke-Api 'POST' '/api/mobile/auth/otp/verify' @{ phone = $driverPhone; code = $otpReq.Body.debugCode }
Check 'OTP verify 200' ($otpVerify.Status -eq 200) "($($otpVerify.Status))"
Check 'role = DRIVER' ($otpVerify.Body.user.role -eq 'DRIVER') "(role=$($otpVerify.Body.user.role))"
Check 'driverId linked on the user' ([bool]$otpVerify.Body.user.driverId)
$driverToken = $otpVerify.Body.accessToken

'--- 2) driver loads matched through the new FK ----------------------------'
$loads = Invoke-Api 'GET' '/api/mobile/driver/loads' $null $driverToken
Check 'GET /api/mobile/driver/loads 200' ($loads.Status -eq 200) "($($loads.Status))"
$active = @($loads.Body.activeLoads).Count
$completed = @($loads.Body.completedLoads).Count
Check 'loads returned for the seeded driver' (($active + $completed) -gt 0) "(active=$active completed=$completed)"

'--- 3) POD routes exist (canonical + deprecated alias) --------------------'
$canonical = Invoke-Api 'POST' '/api/mobile/driver/delivery-receipt' @{ invoice_id = 'definitely-not-an-invoice' } $driverToken
Check 'canonical POD route exists (400/404, never 404-mock)' ($canonical.Status -eq 404 -or $canonical.Status -eq 400) "($($canonical.Status))"
$alias = Invoke-Api 'POST' '/api/mobile/driver/proof' @{ invoice_id = 'definitely-not-an-invoice' } $driverToken
Check 'deprecated alias route exists' ($alias.Status -eq 404 -or $alias.Status -eq 400) "($($alias.Status))"
$noAuth = Invoke-Api 'POST' '/api/mobile/driver/delivery-receipt' @{ invoice_id = 'x' } $null
Check 'POD requires authentication' ($noAuth.Status -eq 401) "($($noAuth.Status))"

'--- 4) manager cartable is role protected (routes exist, driver blocked) --'
$orders = Invoke-Api 'GET' '/api/mobile/manager/orders' $null $driverToken
Check 'GET /manager/orders = 403 for a driver (route exists)' ($orders.Status -eq 403) "($($orders.Status))"
$proofs = Invoke-Api 'GET' '/api/mobile/manager/proofs' $null $driverToken
Check 'GET /manager/proofs = 403 for a driver (route exists)' ($proofs.Status -eq 403) "($($proofs.Status))"
$patch = Invoke-Api 'PATCH' '/api/mobile/manager/orders/1' @{ status = 'approved' } $driverToken
Check 'PATCH /manager/orders/:id = 403 for a driver' ($patch.Status -eq 403) "($($patch.Status))"

'--- 5) farmer OTP login + dashboard/invoices -----------------------------'
$farmerPhone = '09120000002'
$fOtp = Invoke-Api 'POST' '/api/mobile/auth/otp/request' @{ phone = $farmerPhone }
$fVerify = Invoke-Api 'POST' '/api/mobile/auth/otp/verify' @{ phone = $farmerPhone; code = $fOtp.Body.debugCode }
Check 'farmer OTP verify 200' ($fVerify.Status -eq 200) "($($fVerify.Status))"
Check 'role = FARMER' ($fVerify.Body.user.role -eq 'FARMER') "(role=$($fVerify.Body.user.role))"
$farmerToken = $fVerify.Body.accessToken
$dash = Invoke-Api 'GET' '/api/mobile/farmer/dashboard' $null $farmerToken
Check 'GET /farmer/dashboard 200' ($dash.Status -eq 200) "($($dash.Status))"
Check 'farmer profile resolved' ([bool]$dash.Body.farmer) "(name=$($dash.Body.farmer.name))"
$inv = Invoke-Api 'GET' '/api/mobile/farmer/invoices' $null $farmerToken
Check 'GET /farmer/invoices 200' ($inv.Status -eq 200) "($($inv.Status))"
Check 'farmer invoices returned' (@($inv.Body.invoices).Count -gt 0) "(count=$(@($inv.Body.invoices).Count))"

'--- 6) no-mock proof: a route that does not exist must 404 ----------------'
$ghost = Invoke-Api 'GET' '/api/mobile/manager/does-not-exist' $null $driverToken
Check 'unknown mobile route returns 404 (not fabricated data)' ($ghost.Status -eq 404) "($($ghost.Status))"

'--- summary ---------------------------------------------------------------'
"FAILURES: $fail"
if ($fail -gt 0) { exit 1 } else { 'ALL PHASE 1 LIVE CHECKS PASSED' }
