import express from 'express';
import { db } from '../db';
import { settings, products } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

// GET /api/settings - Retrieve global application settings
router.get('/', async (_req, res) => {
  try {
    const row = await db.select().from(settings).where(eq(settings.id, 'default')).limit(1);
    res.json({ settings: row[0]?.data ?? null });
  } catch (error: any) {
    console.error('Fetch settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch settings.' });
  }
});

// PUT /api/settings - Save application settings and sync products definition
router.put('/', async (req, res) => {
  try {
    const settingsData = req.body;
    if (!settingsData || typeof settingsData !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload.' });
    }

    await db.transaction(async (tx) => {
      // 1. Save settings JSON
      await tx
        .insert(settings)
        .values({ id: 'default', data: settingsData, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.id,
          set: { data: settingsData, updatedAt: new Date() },
        });

      // 2. Sync products table if products array is present in settings
      if (Array.isArray(settingsData.products)) {
        for (const p of settingsData.products) {
          if (!p.id || !p.name) continue;
          await tx
            .insert(products)
            .values({
              id: p.id,
              name: p.name,
              type: p.type || 'rawMaterial',
              isActive: !p.isDeleted,
              deletedAt: p.isDeleted ? new Date() : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: products.id,
              set: {
                name: p.name,
                type: p.type || 'rawMaterial',
                isActive: !p.isDeleted,
                deletedAt: p.isDeleted ? new Date() : null,
                updatedAt: new Date(),
              },
            });
        }
      }
    });

    res.json({ success: true, settings: settingsData });
  } catch (error: any) {
    console.error('Save settings error:', error);
    res.status(400).json({ error: error.message || 'Failed to save settings.' });
  }
});

export default router;
