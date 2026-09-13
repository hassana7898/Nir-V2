import express from 'express';
import { getInventoryStockByDate, performInventoryAdjustment } from '../services/inventoryService';
import { getInventoryTransactionsPaginated } from '../repositories/inventoryRepository';
import { requireRole } from '../middleware/auth';

const router = express.Router();

// GET /api/inventory/status - Get stock balance per product until date
router.get('/status', async (req, res) => {
  try {
    const until = typeof req.query.until === 'string' ? req.query.until : undefined;
    const stockMap = await getInventoryStockByDate(until);
    res.json({ stock: stockMap, date: until || new Date().toISOString() });
  } catch (error: any) {
    console.error('Inventory status error:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate inventory.' });
  }
});

// GET /api/inventory/transactions - Paginated inventory ledger transactions
router.get('/transactions', async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const limit = parseInt(String(req.query.limit || '50'), 10) || 50;
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const result = await getInventoryTransactionsPaginated({
      page,
      limit,
      productId,
      type,
      startDate,
      endDate,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Inventory transactions error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventory ledger.' });
  }
});

// POST /api/inventory/adjust - Perform inventory adjustment inside transaction
router.post('/adjust', requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  try {
    const { date, productId, newQuantity, reason } = req.body;
    if (!date || !productId || newQuantity === undefined) {
      return res.status(400).json({ error: 'date, productId, and newQuantity are required.' });
    }

    const id = await performInventoryAdjustment({
      date: String(date),
      productId: String(productId),
      newQuantity: parseFloat(String(newQuantity)),
      reason: reason ? String(reason) : undefined,
    });

    res.status(201).json({ success: true, id });
  } catch (error: any) {
    console.error('Inventory adjust error:', error);
    res.status(400).json({ error: error.message || 'Failed to adjust inventory.' });
  }
});

export default router;
