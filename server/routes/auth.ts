import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth';

const router = express.Router();

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
    if (!password) {
      return res.status(400).json({ error: 'رمز عبور الزامی است.' });
    }
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور نامعتبر است.' });
    }
    const token = await setSessionCookie(req, res, { id: user.id, username: user.username, role: user.role });
    res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('Auth login error:', error);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ authenticated: true, user: req.user }));
router.post('/logout', async (req, res) => { await clearSessionCookie(req, res); res.json({ success: true }); });

export default router;
