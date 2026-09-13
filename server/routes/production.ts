import express from 'express';
import { createProductionRecordWithTransaction, deleteProductionRecordWithTransaction } from '../services/productionService';
import { db } from '../db';
import { production_records, batches } from '../db/schema';
import { isNull, desc } from 'drizzle-orm';
import { requireRole } from '../middleware/auth';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const records = await db
      .select()
      .from(production_records)
      .where(isNull(production_records.deletedAt))
      .orderBy(desc(production_records.date), desc(production_records.createdAt));
    res.json({ data: records });
  } catch (error: any) {
    console.error('Fetch production error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch production records.' });
  }
});

router.post('/', requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  try {
    const { date, finishedGoodId, formulaId, quantityProduced, batchNumber } = req.body;
    if (!date || !finishedGoodId || quantityProduced === undefined) {
      return res.status(400).json({ error: 'date, finishedGoodId, and quantityProduced are required.' });
    }

    const id = await createProductionRecordWithTransaction({
      date: String(date),
      finishedGoodId: String(finishedGoodId),
      formulaId: formulaId ? String(formulaId) : undefined,
      quantityProduced: parseFloat(String(quantityProduced)),
      batchNumber: batchNumber ? String(batchNumber) : undefined,
    });

    res.status(201).json({ success: true, id });
  } catch (error: any) {
    console.error('Create production error:', error);
    res.status(400).json({ error: error.message || 'Failed to record production.' });
  }
});

router.delete('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = String(req.params.id);
    await deleteProductionRecordWithTransaction(id);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete production error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete production record.' });
  }
});

export default router;
