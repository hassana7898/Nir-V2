import express from 'express';
import { db } from '../db';
import { formulas, formula_items } from '../db/schema';
import { eq, isNull, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireRole } from '../middleware/auth';

const router = express.Router();

const normalizeItems = (items: any) => Array.isArray(items) ? items.map((item: any) => ({
  id: item.id || randomUUID(),
  productId: String(item.productId || ''),
  percentage: item.percentage !== undefined && item.percentage !== null ? String(item.percentage) : null,
  quantity: item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : null,
})).filter((item: any) => item.productId) : [];

const replaceFormulaItems = async (tx: any, formulaId: string, items: any[]) => {
  await tx.delete(formula_items).where(eq(formula_items.formulaId, formulaId));
  const normalized = normalizeItems(items);
  if (!normalized.length) return;
  await tx.insert(formula_items).values(normalized.map((item: any) => ({
    ...item,
    formulaId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })));
};

router.get('/', async (_req, res) => {
  try {
    const list = await db.select().from(formulas).where(isNull(formulas.deletedAt)).orderBy(desc(formulas.createdAt));
    const result = await Promise.all(list.map(async (formula: any) => {
      const items = await db.select().from(formula_items).where(eq(formula_items.formulaId, formula.id));
      return { ...formula, items };
    }));
    res.json({ data: result });
  } catch (error: any) {
    console.error('Fetch formulas error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch formulas.' });
  }
});

router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { id, name, finishedGoodId, items } = req.body;
    if (!name || !finishedGoodId) return res.status(400).json({ error: 'name and finishedGoodId are required.' });

    const formulaId = id || randomUUID();
    const normalized = normalizeItems(items);
    const newFormula = {
      id: formulaId,
      name: String(name).trim(),
      finishedGoodId: String(finishedGoodId),
      items: normalized,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    await db.transaction(async (tx: any) => {
      await tx.insert(formulas).values(newFormula).onConflictDoUpdate({
        target: formulas.id,
        set: {
          name: newFormula.name,
          finishedGoodId: newFormula.finishedGoodId,
          items: normalized,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
      await replaceFormulaItems(tx, formulaId, normalized);
    });

    res.status(201).json({ success: true, formula: newFormula });
  } catch (error: any) {
    console.error('Create formula error:', error);
    res.status(400).json({ error: error.message || 'Failed to create formula.' });
  }
});

router.put('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name, finishedGoodId, items } = req.body;
    const normalized = normalizeItems(items);

    await db.transaction(async (tx: any) => {
      const payload: any = { updatedAt: new Date() };
      if (name !== undefined) payload.name = String(name).trim();
      if (finishedGoodId !== undefined) payload.finishedGoodId = String(finishedGoodId);
      if (items !== undefined) payload.items = normalized;

      await tx.update(formulas).set(payload).where(eq(formulas.id, id));
      if (items !== undefined) await replaceFormulaItems(tx, id, normalized);
    });

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Update formula error:', error);
    res.status(400).json({ error: error.message || 'Failed to update formula.' });
  }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = String(req.params.id);
    await db.update(formulas).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(formulas.id, id));
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete formula error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete formula.' });
  }
});

export default router;
