import express, { type Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { clearSessionCookie, getJwtSecret, requireAuth, setSessionCookie } from '../middleware/auth';
import { buildOtpauthUrl, generateQrDataUrl, generateTotpSecret, verifyTotp } from '../services/totp';

const router = express.Router();

// ---------------------------------------------------------------------------
// Trusted-device ("remember this device for 30 days") cookie helpers.
// The token is a stateless signed JWT; the cookie mirrors the SameSite/Secure
// policy of the session cookie builder in server/middleware/auth.ts so both
// cookies behave identically behind HTTP/HTTPS and cross-site deployments.
// ---------------------------------------------------------------------------
const TRUSTED_DEVICE_COOKIE = 'nir_trusted_device';
const TRUSTED_DEVICE_MAX_AGE_SECONDS = 2592000; // 30 days

const buildTrustedDeviceCookieHeader = (req: Request, token: string, maxAgeSeconds: number = TRUSTED_DEVICE_MAX_AGE_SECONDS): string => {
  const isHttps = req.secure ||
                  req.headers['x-forwarded-proto'] === 'https' ||
                  req.protocol === 'https';

  const crossSiteRequested = process.env.CROSS_SITE_COOKIE !== undefined
    ? ['true', '1'].includes(String(process.env.CROSS_SITE_COOKIE).toLowerCase().trim())
    : false;

  let sameSite = 'Lax';
  let securePart = '';

  // RFC 6265bis: SameSite=None is ONLY valid with Secure over HTTPS.
  if (isHttps) {
    securePart = '; Secure';
    if (crossSiteRequested) {
      sameSite = 'None';
    }
  }

  return `${TRUSTED_DEVICE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${securePart}`;
};

const readCookie = (req: Request, name: string): string | null => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
};

const signTrustedDeviceToken = (userId: string): string =>
  jwt.sign(
    { id: userId, typ: 'trusted_device' },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '30d', issuer: 'nir-app' }
  );

const isTrustedDevice = (req: Request, userId: string): boolean => {
  const token = readCookie(req, TRUSTED_DEVICE_COOKIE);
  if (!token) return false;
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], issuer: 'nir-app' }) as any;
    return payload?.typ === 'trusted_device' && payload?.id === userId;
  } catch {
    return false;
  }
};

router.get('/status', async (_req, res) => {
  try {
    const rows = await db.select({ id: users.id }).from(users).limit(1);
    res.json({ setup: rows && rows.length > 0 });
  } catch (error: any) {
    // Gracefully handle uninitialized database or missing schema
    res.json({ setup: false });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length) return res.status(409).json({ error: 'Initial setup has already been completed.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();
    await db.insert(users).values({ id, username: 'admin', passwordHash, role: 'ADMIN' });
    const token = await setSessionCookie(req, res, { id, username: 'admin', role: 'ADMIN' });
    res.json({ success: true, token, user: { id, username: 'admin', role: 'ADMIN' } });
  } catch (error) {
    console.error('Auth setup error:', error);
    res.status(500).json({ error: 'Could not complete setup.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || 'admin').trim();
    const password = String(req.body?.password || '');
    const totp = req.body?.totp != null ? String(req.body.totp).trim() : '';
    const rememberDevice = req.body?.rememberDevice === true || String(req.body?.rememberDevice ?? '').toLowerCase() === 'true';
    if (!password) {
      return res.status(400).json({ error: 'رمز عبور الزامی است.' });
    }
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور نامعتبر است.' });
    }

    // Two-factor gate: only enforced when the account has 2FA enabled and this
    // browser is not already a trusted device.
    if (user.is2faEnabled) {
      const trustedDevice = isTrustedDevice(req, user.id);
      if (!trustedDevice) {
        if (!totp) {
          // Password was correct, but a TOTP code is still required. No session yet.
          return res.status(200).json({ success: false, twoFactorRequired: true });
        }
        if (!verifyTotp(totp, user.totpSecret || '')) {
          return res.status(401).json({ error: 'INVALID_TOTP' });
        }
      }
    }

    const token = await setSessionCookie(req, res, { id: user.id, username: user.username, role: user.role });

    if (user.is2faEnabled && rememberDevice) {
      // Append (not overwrite) so the session cookie set above is preserved.
      res.append('Set-Cookie', buildTrustedDeviceCookieHeader(req, signTrustedDeviceToken(user.id)));
    }

    res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('Auth login error:', error);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  let is2faEnabled = false;
  try {
    const userId = req.user?.id;
    if (userId) {
      const rows = await db.select({ is2faEnabled: users.is2faEnabled }).from(users).where(eq(users.id, userId)).limit(1);
      is2faEnabled = Boolean(rows[0]?.is2faEnabled);
    }
  } catch {
    is2faEnabled = false;
  }
  res.json({ authenticated: true, user: { ...req.user, is2faEnabled } });
});

router.post('/logout', async (req, res) => { await clearSessionCookie(req, res); res.json({ success: true }); });

// ---------------------------------------------------------------------------
// TOTP (2FA) management
// ---------------------------------------------------------------------------

router.get('/2fa/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const rows = await db.select({ is2faEnabled: users.is2faEnabled }).from(users).where(eq(users.id, userId)).limit(1);
    res.json({ enabled: Boolean(rows[0]?.is2faEnabled) });
  } catch (error) {
    console.error('2FA status error:', error);
    res.status(500).json({ error: 'Could not load 2FA status.' });
  }
});

router.post('/2fa/generate', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const userRows = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
    const username = userRows[0]?.username || req.user?.username || 'user';

    // Persist the new secret but DO NOT enable 2FA yet — that only happens in /2fa/verify.
    const secret = generateTotpSecret();
    await db.update(users).set({ totpSecret: secret, updatedAt: new Date() }).where(eq(users.id, userId));

    const otpauthUrl = buildOtpauthUrl(secret, username);
    const qrDataUrl = await generateQrDataUrl(otpauthUrl);

    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (error) {
    console.error('2FA generate error:', error);
    res.status(500).json({ error: 'Could not generate 2FA secret.' });
  }
});

router.post('/2fa/verify', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'کد تأیید الزامی است.' });

    const rows = await db.select({ totpSecret: users.totpSecret }).from(users).where(eq(users.id, userId)).limit(1);
    const secret = rows[0]?.totpSecret;
    if (!secret) return res.status(400).json({ error: 'ابتدا باید کد QR را تولید کنید.' });

    if (!verifyTotp(code, secret)) {
      return res.status(400).json({ error: 'کد تأیید نامعتبر است.' });
    }

    await db.update(users).set({ is2faEnabled: true, updatedAt: new Date() }).where(eq(users.id, userId));
    res.json({ success: true });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Could not verify 2FA code.' });
  }
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ error: 'رمز عبور الزامی است.' });

    const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(400).json({ error: 'رمز عبور نامعتبر است.' });
    }

    await db.update(users).set({ totpSecret: null, is2faEnabled: false, updatedAt: new Date() }).where(eq(users.id, userId));
    res.json({ success: true });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Could not disable 2FA.' });
  }
});

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد.' });
    }

    const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'رمز عبور فعلی نامعتبر است.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

export default router;
