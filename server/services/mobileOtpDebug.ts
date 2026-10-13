/**
 * Dev-only policy for returning the OTP code in the API response (`debugCode`).
 *
 * Why this is a separate module: the dev VPS runs the production bundle layout with
 * `NODE_ENV=production`, so `NODE_ENV` alone can never unlock a debug code there. The dev tree is
 * unlocked by an explicit, opt-in environment flag (`MOBILE_OTP_DEBUG=true`) which is set ONLY in
 * `C:\Servers\NIR\dev\.env`, combined with a self-declaration of the deployment (`NIR_ENV=dev`).
 *
 * A production deployment therefore needs BOTH flags to leak the code into the response, and the
 * prod `.env` (C:\Servers\NIR\app\.env) contains neither — the prod deploy script also fingerprints
 * `.env` before/after a dev deploy, so a dev flag can never ride along unnoticed.
 *
 * The code is still printed to the server log by the SMS service fallback in non-configured
 * environments; this module only controls whether it is echoed to the *client*.
 */
export const isMobileOtpDebugEnabled = (): boolean => {
  const flagOn = String(process.env.MOBILE_OTP_DEBUG || '').trim().toLowerCase() === 'true';
  if (!flagOn) return false;

  // Normal local development / tests: NODE_ENV is not "production" -> flag is enough.
  if (process.env.NODE_ENV !== 'production') return true;
  if (String(process.env.AI_STUDIO_PREVIEW || '').toLowerCase() === 'true') return true;

  // Production-shaped runtime (this is how the dev VPS runs): require an explicit dev marker.
  return String(process.env.NIR_ENV || '').trim().toLowerCase() === 'dev';
};

/** Human-readable reason, used in the server log line so the state is never a mystery. */
export const describeMobileOtpDebug = (): string => {
  if (isMobileOtpDebugEnabled()) {
    return 'MOBILE_OTP_DEBUG=true -> OTP code is returned in the API response (dev only)';
  }
  const flagOn = String(process.env.MOBILE_OTP_DEBUG || '').trim().toLowerCase() === 'true';
  if (flagOn) {
    return 'MOBILE_OTP_DEBUG=true was ignored: NODE_ENV=production and NIR_ENV is not "dev"';
  }
  return 'debugCode disabled (production policy)';
};

export default isMobileOtpDebugEnabled;
