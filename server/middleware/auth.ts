import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createDBSession, findDBSession, deleteDBSession } from '../repositories/sessionRepository';

export interface AuthUser { id: string; username: string; role: string; }

declare global { namespace Express { interface Request { user?: AuthUser; sessionToken?: string; } } }

const SESSION_COOKIE = 'nir_session';

export const getJwtSecret = (): string => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[NIR AUTH FATAL] JWT_SECRET is strictly required in production mode. Please set JWT_SECRET in .env');
    }
    console.warn('[NIR AUTH WARN] JWT_SECRET is not set in development. Using development fallback secret.');
    return 'nir-dev-fallback-secret-key-change-in-production';
  }
  return secret;
};

export const buildSessionCookieHeader = (req: Request, token: string, maxAgeSeconds: number = 2592000): string => {
  const isHttps = req.secure ||
                  req.headers['x-forwarded-proto'] === 'https' ||
                  req.protocol === 'https';

  const crossSiteRequested = process.env.CROSS_SITE_COOKIE !== undefined
    ? ['true', '1'].includes(String(process.env.CROSS_SITE_COOKIE).toLowerCase().trim())
    : false;

  let sameSite = 'Lax';
  let securePart = '';

  // RFC 6265bis: SameSite=None is ONLY valid with Secure over HTTPS.
  // Over HTTP (localhost, factory LAN 192.168.x.x, Windows standalone), browsers reject Secure cookies.
  if (isHttps) {
    securePart = '; Secure';
    if (crossSiteRequested) {
      sameSite = 'None';
    }
  }

  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${securePart}`;
};

export const getSessionToken = (req: Request): string | null => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`));
  if (match) return decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));

  // Also support Authorization: Bearer <token> header for API calls
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const dbUser = await findDBSession(token);
    if (dbUser) {
      req.user = dbUser;
      req.sessionToken = token;
      return next();
    }

    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'nir-app' }) as AuthUser;
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    req.sessionToken = token;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid.' });
  }
};

export const setSessionCookie = async (req: Request, res: Response, user: AuthUser): Promise<string> => {
  let token: string;
  try {
    const ip = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    token = await createDBSession(user, ip, userAgent);
  } catch (err) {
    console.warn('Failed to create DB session, falling back to JWT:', err);
    const secret = getJwtSecret();
    token = jwt.sign(user, secret, { algorithm: 'HS256', expiresIn: '30d', issuer: 'nir-app', subject: user.id });
  }

  res.setHeader('Set-Cookie', buildSessionCookieHeader(req, token, 2592000));
  return token;
};

export const clearSessionCookie = async (req: Request, res: Response): Promise<void> => {
  const token = getSessionToken(req);
  if (token) await deleteDBSession(token).catch(() => {});
  res.setHeader('Set-Cookie', buildSessionCookieHeader(req, '', 0));
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'احراز هویت انجام نشده است.' });
    const userRole = (req.user.role || '').toUpperCase();
    if (userRole === 'ADMIN') return next();
    if (allowedRoles.map(r => r.toUpperCase()).includes(userRole)) return next();
    return res.status(403).json({ error: 'عدم دسترسی: شما مجوز لازم برای این عملیات را ندارید.' });
  };
};
