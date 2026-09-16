import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';

// otplib v13 (functional API). TOTP parameters are pinned explicitly so that
// generation and verification always agree regardless of future library defaults:
//   algorithm sha1, 6 digits, 30s step.
// `epochTolerance: 30` accepts the previous/next 30s step (±1 window), tolerating
// small clock skew between the server and the authenticator app.
const TOTP_ALGORITHM = 'sha1' as const;
const TOTP_DIGITS = 6 as const;
const TOTP_PERIOD = 30;
const TOTP_EPOCH_TOLERANCE = 30;

/**
 * Generate a fresh base32 TOTP secret (random, cryptographically secure, 160-bit).
 */
export const generateTotpSecret = (): string => generateSecret({ length: 20 });

/**
 * Build a standard otpauth:// provisioning URI for authenticator apps.
 * e.g. otpauth://totp/NIR:admin?secret=***&issuer=NIR
 */
export const buildOtpauthUrl = (secret: string, username: string, issuer = 'NIR'): string =>
  generateURI({
    strategy: 'totp',
    issuer,
    label: username,
    secret,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });

/**
 * Verify a 6-digit TOTP code against a stored secret, allowing a ±1 step window.
 * Never throws: an invalid/absent code or secret returns false.
 */
export const verifyTotp = (code: string, secret: string): boolean => {
  if (!code || !secret) return false;
  const token = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = verifySync({
      strategy: 'totp',
      secret,
      token,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      epochTolerance: TOTP_EPOCH_TOLERANCE,
    });
    return result.valid === true;
  } catch {
    return false;
  }
};

/**
 * Render an otpauth:// URI to a PNG data URL (data:image/png;base64,...).
 * Fully local: QR encoding happens in-process via the `qrcode` package, so no
 * external API/CDN is contacted and the secret never leaves the server.
 */
export const generateQrDataUrl = async (otpauthUrl: string): Promise<string> =>
  QRCode.toDataURL(otpauthUrl);
