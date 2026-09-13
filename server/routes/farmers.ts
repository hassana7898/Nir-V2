import express from 'express';
import { db } from '../db';
import { farmers } from '../db/schema';
import { eq, isNull, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireRole } from '../middleware/auth';

const router = express.Router();

// GET /api/farmers - Get all active farmers
router.get('/', async (_req, res) => {
  try {
    const list = await db
      .select()
      .from(farmers)
      .where(isNull(farmers.deletedAt))
      .orderBy(asc(farmers.name));
    res.json({ data: list });
  } catch (error: any) {
    console.error('Fetch farmers error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch farmers.' });
  }
});

// POST /api/farmers - Create a new farmer
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { id, name, phone, broods, isHidden } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Farmer name is required.' });
    }

    const farmerId = id || randomUUID();
    const newFarmer = {
      id: farmerId,
      name: String(name).trim(),
      phone: phone ? String(phone) : null,
      broods: Array.isArray(broods) ? broods : [],
      isHidden: Boolean(isHidden),
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    await db.insert(farmers).values(newFarmer).onConflictDoUpdate({
      target: farmers.id,
      set: {
        name: newFarmer.name,
        phone: newFarmer.phone,
        broods: newFarmer.broods,
        isHidden: newFarmer.isHidden,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });

    res.status(201).json({ success: true, farmer: newFarmer });
  } catch (error: any) {
    console.error('Create farmer error:', error);
    res.status(400).json({ error: error.message || 'Failed to create farmer.' });
  }
});

// PUT /api/farmers/:id - Update an existing farmer
router.put('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name, phone, broods, isHidden } = req.body;

    const updatePayload: any = { updatedAt: new Date() };
    if (name !== undefined) updatePayload.name = String(name).trim();
    if (phone !== undefined) updatePayload.phone = phone ? String(phone) : null;
    if (broods !== undefined) updatePayload.broods = Array.isArray(broods) ? broods : [];
    if (isHidden !== undefined) updatePayload.isHidden = Boolean(isHidden);

    await db.update(farmers).set(updatePayload).where(eq(farmers.id, id));

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Update farmer error:', error);
    res.status(400).json({ error: error.message || 'Failed to update farmer.' });
  }
});

// DELETE /api/farmers/:id - Soft delete a farmer
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = String(req.params.id);
    await db
      .update(farmers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(farmers.id, id));

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete farmer error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete farmer.' });
  }
});

export default router;
