import express from 'express';
import { db } from '../db';
import { drivers } from '../db/schema';
import { eq, isNull, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireRole } from '../middleware/auth';

const router = express.Router();

// GET /api/drivers - Get all active drivers
router.get('/', async (_req, res) => {
  try {
    const list = await db
      .select()
      .from(drivers)
      .where(isNull(drivers.deletedAt))
      .orderBy(asc(drivers.name));
    res.json({ data: list });
  } catch (error: any) {
    console.error('Fetch drivers error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch drivers.' });
  }
});

// POST /api/drivers - Add a driver
router.post('/', requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  try {
    const { name, phone, iban } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Driver name is required.' });
    }

    const trimmed = String(name).trim();
    const id = trimmed;

    await db
      .insert(drivers)
      .values({
        id,
        name: trimmed,
        phone: phone ? String(phone) : null,
        iban: iban ? String(iban) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: drivers.id,
        set: {
          name: trimmed,
          phone: phone ? String(phone) : null,
          iban: iban ? String(iban) : null,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });

    res.status(201).json({ success: true, name: trimmed });
  } catch (error: any) {
    console.error('Create driver error:', error);
    res.status(400).json({ error: error.message || 'Failed to add driver.' });
  }
});

// DELETE /api/drivers/:name - Soft delete a driver
router.delete('/:name', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const name = decodeURIComponent(String(req.params.name));
    await db
      .update(drivers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(drivers.name, name));

    res.json({ success: true, name });
  } catch (error: any) {
    console.error('Delete driver error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete driver.' });
  }
});

export default router;
