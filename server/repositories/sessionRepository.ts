import { eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import type { AuthUser } from '../middleware/auth';

export const createDBSession = async (
  user: AuthUser,
  ipAddress = '',
  userAgent = '',
  expiryDays = 30
): Promise<string> => {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const id = randomUUID();

  await db.insert(sessions).values({
    id,
    userId: user.id,
    token,
    expiresAt,
    ipAddress,
    userAgent,
    createdAt: new Date(),
  });

  return token;
};

export const findDBSession = async (token: string): Promise<AuthUser | null> => {
  try {
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!sessionRows || sessionRows.length === 0) return null;
    const session = sessionRows[0];

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      // Session expired, remove it
      await db.delete(sessions).where(eq(sessions.id, session.id));
      return null;
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!userRows || userRows.length === 0) return null;
    const user = userRows[0];

    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  } catch (err) {
    console.error('findDBSession error:', err);
    return null;
  }
};

export const deleteDBSession = async (token: string): Promise<void> => {
  try {
    await db.delete(sessions).where(eq(sessions.token, token));
  } catch (err) {
    console.error('deleteDBSession error:', err);
  }
};
