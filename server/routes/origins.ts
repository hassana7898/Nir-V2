import express from 'express';
import { db } from '../db';
import { origins } from '../db/schema';
import { eq, isNull, asc } from 'drizzle-orm';
import { requireRole } from '../middleware/auth';

const router = express.Router();

// GET /api/origins - Get all active origins
router.get('/', async (_req, res) => {
  try {
    const list = await db
      .select()
      .from(origins)
      .where(isNull(origins.deletedAt))
      .orderBy(asc(origins.name));
    res.json({ data: list });
  } catch (error: any) {
    console.error('Fetch origins error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch origins.' });
  }
});

// POST /api/origins - Add an origin
router.post('/', requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Origin name is required.' });
    }

    const trimmed = String(name).trim();
    const id = trimmed;

    await db
      .insert(origins)
      .values({
        id,
        name: trimmed,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: origins.id,
        set: {
          name: trimmed,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });

    res.status(201).json({ success: true, name: trimmed });
  } catch (error: any) {
    console.error('Create origin error:', error);
    res.status(400).json({ error: error.message || 'Failed to add origin.' });
  }
});

// DELETE /api/origins/:name - Soft delete an origin
router.delete('/:name', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const name = decodeURIComponent(String(req.params.name));
    await db
      .update(origins)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(origins.name, name));

    res.json({ success: true, name });
  } catch (error: any) {
    console.error('Delete origin error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete origin.' });
  }
});

export default router;
