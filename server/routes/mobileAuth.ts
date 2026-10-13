import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { db } from '../db';
import { drivers, farmers, otp_codes, users } from '../db/schema';
import { createDBSession, deleteDBSession, findDBSession } from '../repositories/sessionRepository';
import { getJwtSecret, getSessionToken, type AuthUser } from '../middleware/auth';
import { verifyTotp } from '../services/totp';
import { isValidIranianMobile, normalizeIranianPhone, sendOtpSms } from '../services/smsService';
import { toAsciiDigits } from '../../shared/persianText';
import { describeMobileOtpDebug, isMobileOtpDebugEnabled } from '../services/mobileOtpDebug';

const router = Router();

/**
 * POST /api/mobile/auth/otp/request
 * Receives mobile phone, generates 6-digit OTP code, stores in DB, sends SMS (or logs mock)
 */
router.post('/otp/request', async (req: Request, res: Response) => {
  try {
    const rawPhone = req.body?.phone;
    const phone = normalizeIranianPhone(rawPhone);

    if (!isValidIranianMobile(phone)) {
      return res.status(400).json({ error: 'شماره تلفن همراه نامعتبر است. لطفاً شماره ۱۱ رقمی صحیح وارد کنید.' });
    }

    // Generate secure 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes TTL

    await db.insert(otp_codes).values({
      phone,
      code,
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    const smsResult = await sendOtpSms(phone, code);

    const isNonProd = process.env.NODE_ENV !== 'production' || process.env.AI_STUDIO_PREVIEW === 'true';
    // Dev-only opt-in (C:\Servers\NIR\dev\.env): MOBILE_OTP_DEBUG=true + NIR_ENV=dev. A production
    // deployment carries neither flag, so a debug code cannot leave the dev tree (see
    // server/services/mobileOtpDebug.ts for the full policy).
    const debugOtpAllowed = isNonProd || isMobileOtpDebugEnabled();
    if (debugOtpAllowed) {
      console.warn(
        `[MOBILE AUTH OTP DEBUG] ${
          isNonProd
            ? `NODE_ENV=${process.env.NODE_ENV ?? 'unset'} (non-production runtime) -> debugCode returned`
            : describeMobileOtpDebug()
        }`
      );
    }

    return res.json({
      success: true,
      message: smsResult.message,
      expiresIn: 120,
      ...(debugOtpAllowed ? { debugCode: code } : {}),
    });
  } catch (err: any) {
    console.error('[MOBILE AUTH OTP REQUEST ERROR]:', err);
    return res.status(500).json({ error: 'خطا در صدور و ارسال کد تایید.' });
  }
});

/**
 * POST /api/mobile/auth/otp/verify
 * Validates OTP code, resolves Driver/Farmer/User identity, issues accessToken & refreshToken
 */
router.post('/otp/verify', async (req: Request, res: Response) => {
  try {
    const rawPhone = req.body?.phone;
    const rawCode = req.body?.code;

    const phone = normalizeIranianPhone(rawPhone);
    const code = toAsciiDigits(String(rawCode || '')).trim();

    if (!isValidIranianMobile(phone) || !code || code.length !== 6) {
      return res.status(400).json({ error: 'شماره تلفن یا کد ۶ رقمی تایید نامعتبر است.' });
    }

    // Look for matching valid unused OTP code
    const otpRecords = await db
      .select()
      .from(otp_codes)
      .where(
        and(
          eq(otp_codes.phone, phone),
          eq(otp_codes.code, code),
          eq(otp_codes.used, false),
          gte(otp_codes.expiresAt, new Date())
        )
      )
      .orderBy(desc(otp_codes.createdAt))
      .limit(1);

    if (!otpRecords || otpRecords.length === 0) {
      return res.status(400).json({ error: 'کد تایید وارد شده نامعتبر یا منقضی شده است.' });
    }

    const otpRecord = otpRecords[0];

    // Mark OTP as used immediately
    await db.update(otp_codes).set({ used: true }).where(eq(otp_codes.id, otpRecord.id));

    // Resolve Identity: Check Drivers first, then Farmers
    const allDrivers = await db.select().from(drivers).where(isNull(drivers.deletedAt));
    const matchedDriver = allDrivers.find((d: any) => normalizeIranianPhone(d.phone) === phone);

    let role = 'DRIVER';
    let fullName = '';
    let driverId: string | null = null;
    let farmerId: string | null = null;

    if (matchedDriver) {
      role = 'DRIVER';
      fullName = matchedDriver.name;
      driverId = matchedDriver.id;
    } else {
      const allFarmers = await db.select().from(farmers).where(isNull(farmers.deletedAt));
      const matchedFarmer = allFarmers.find((f: any) => normalizeIranianPhone(f.phone) === phone);

      if (matchedFarmer) {
        role = 'FARMER';
        fullName = matchedFarmer.name;
        farmerId = matchedFarmer.id;
      } else {
        // Check if an existing manager/admin user has this phone number
        const existingUsers = await db
          .select()
          .from(users)
          .where(or(eq(users.phone, phone), eq(users.username, phone)))
          .limit(1);

        if (existingUsers.length > 0) {
          const u = existingUsers[0];
          role = u.role;
          fullName = u.fullName || u.username;
          driverId = u.driverId;
          farmerId = u.farmerId;
        } else {
          return res.status(404).json({
            error: 'شماره همراه شما در سامانه یافت نشد. لطفاً با مدیر کارخانه جهت ثبت شماره تماس بگیرید.',
          });
        }
      }
    }

    // Find or create matching user row in users table
    let userRow: any = null;
    if (driverId) {
      const u = await db
        .select()
        .from(users)
        .where(or(eq(users.driverId, driverId), eq(users.phone, phone), eq(users.username, phone)))
        .limit(1);
      userRow = u[0];
    } else if (farmerId) {
      const u = await db
        .select()
        .from(users)
        .where(or(eq(users.farmerId, farmerId), eq(users.phone, phone), eq(users.username, phone)))
        .limit(1);
      userRow = u[0];
    } else {
      const u = await db
        .select()
        .from(users)
        .where(or(eq(users.phone, phone), eq(users.username, phone)))
        .limit(1);
      userRow = u[0];
    }

    if (!userRow) {
      const newId = randomUUID();
      await db.insert(users).values({
        id: newId,
        username: phone,
        passwordHash: '',
        role,
        fullName,
        driverId,
        farmerId,
        phone,
        is2faEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      userRow = {
        id: newId,
        username: phone,
        role,
        fullName,
        driverId,
        farmerId,
        phone,
      };
    } else {
      // Ensure linkages are updated if previously unset or re-assigned
      const updates: any = {};
      if (driverId && userRow.driverId !== driverId) updates.driverId = driverId;
      if (farmerId && userRow.farmerId !== farmerId) updates.farmerId = farmerId;
      if (!userRow.phone) updates.phone = phone;
      if (!userRow.fullName && fullName) updates.fullName = fullName;

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db.update(users).set(updates).where(eq(users.id, userRow.id));
        userRow = { ...userRow, ...updates };
      }
    }

    const authUser: AuthUser = {
      id: userRow.id,
      username: userRow.username,
      role: userRow.role || role,
      fullName: userRow.fullName || fullName,
      driverId: userRow.driverId || driverId,
      farmerId: userRow.farmerId || farmerId,
      phone: userRow.phone || phone,
    };

    const ip = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || 'NIR-Mobile';
    const sessionToken = await createDBSession(authUser, ip, userAgent, 30);

    const secret = getJwtSecret();
    const accessToken = jwt.sign(authUser, secret, {
      algorithm: 'HS256',
      expiresIn: '7d',
      issuer: 'nir-app',
      subject: authUser.id,
    });

    const refreshToken = jwt.sign(
      { id: authUser.id, typ: 'refresh', sessionToken },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '30d',
        issuer: 'nir-app',
      }
    );

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: authUser,
    });
  } catch (err: any) {
    console.error('[MOBILE AUTH OTP VERIFY ERROR]:', err);
    return res.status(500).json({ error: 'خطا در اعتبارسنجی کد و ورود به سامانه.' });
  }
});

/**
 * POST /api/mobile/auth/login
 * Standard login for managers/operators with username/password and TOTP support
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const rawUsername = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const totp = req.body?.totp != null ? toAsciiDigits(String(req.body.totp)).trim() : '';

    if (!rawUsername || !password) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
    }

    const normalizedPhone = normalizeIranianPhone(rawUsername);
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.username, rawUsername), eq(users.phone, normalizedPhone)))
      .limit(1);

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور نامعتبر است.' });
    }

    // 2FA check
    if (user.is2faEnabled) {
      if (!totp) {
        return res.json({ success: false, twoFactorRequired: true });
      }
      if (!verifyTotp(totp, user.totpSecret || '')) {
        return res.status(401).json({ error: 'کد اعتبارسنجی دو مرحله‌ای (۲FA) نامعتبر است.' });
      }
    }

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || null,
      driverId: user.driverId || null,
      farmerId: user.farmerId || null,
      phone: user.phone || null,
    };

    const ip = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || 'NIR-Mobile';
    const sessionToken = await createDBSession(authUser, ip, userAgent, 30);

    const secret = getJwtSecret();
    const accessToken = jwt.sign(authUser, secret, {
      algorithm: 'HS256',
      expiresIn: '7d',
      issuer: 'nir-app',
      subject: authUser.id,
    });

    const refreshToken = jwt.sign(
      { id: authUser.id, typ: 'refresh', sessionToken },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '30d',
        issuer: 'nir-app',
      }
    );

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: authUser,
    });
  } catch (err: any) {
    console.error('[MOBILE AUTH LOGIN ERROR]:', err);
    return res.status(500).json({ error: 'ورود ناموفق بود.' });
  }
});

/**
 * POST /api/mobile/auth/refresh
 * Refresh expired access token with valid refreshToken
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
      return res.status(400).json({ error: 'ارائه رفرش توکن الزامی است.' });
    }

    const secret = getJwtSecret();
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, secret, { algorithms: ['HS256'], issuer: 'nir-app' });
    } catch {
      return res.status(401).json({ error: 'رفرش توکن نامعتبر یا منقضی شده است.' });
    }

    if (payload?.typ !== 'refresh' || !payload?.id) {
      return res.status(401).json({ error: 'فرمت توکن نامعتبر است.' });
    }

    // Verify sessionToken in DB if provided
    if (payload.sessionToken) {
      const activeSession = await findDBSession(payload.sessionToken);
      if (!activeSession) {
        return res.status(401).json({ error: 'نشست کاربری باطل شده است. لطفاً مجدداً وارد شوید.' });
      }
    }

    const userRows = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
    const user = userRows[0];
    if (!user) {
      return res.status(401).json({ error: 'کاربر مربوطه یافت نشد.' });
    }

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || null,
      driverId: user.driverId || null,
      farmerId: user.farmerId || null,
      phone: user.phone || null,
    };

    const newAccessToken = jwt.sign(authUser, secret, {
      algorithm: 'HS256',
      expiresIn: '7d',
      issuer: 'nir-app',
      subject: authUser.id,
    });

    const newRefreshToken = jwt.sign(
      { id: authUser.id, typ: 'refresh', sessionToken: payload.sessionToken },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '30d',
        issuer: 'nir-app',
      }
    );

    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err: any) {
    console.error('[MOBILE AUTH REFRESH ERROR]:', err);
    return res.status(500).json({ error: 'خطا در تمدید توکن.' });
  }
});

/**
 * POST /api/mobile/auth/logout
 * Revokes mobile session
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      await deleteDBSession(token).catch(() => {});
    }

    // The access token is a JWT while the DB session is keyed by the opaque token carried inside
    // the refresh token, so the line above alone leaves the session alive: a stolen refresh token
    // would survive a logout. Revoke the session that the refresh token points at as well.
    // Failures are ignored on purpose - logout must always succeed locally.
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (refreshToken) {
      try {
        const payload: any = jwt.verify(refreshToken, getJwtSecret(), {
          algorithms: ['HS256'],
          issuer: 'nir-app',
          ignoreExpiration: true,
        });
        if (payload?.sessionToken) {
          await deleteDBSession(payload.sessionToken).catch(() => {});
        }
      } catch {
        // Foreign or malformed refresh token: nothing to revoke.
      }
    }
    return res.json({ success: true, message: 'خروج با موفقیت انجام شد.' });
  } catch (err: any) {
    console.error('[MOBILE AUTH LOGOUT ERROR]:', err);
    return res.status(500).json({ error: 'خطا در خروج از حساب کاربری.' });
  }
});

export default router;
