import express from 'express';
import path from 'path';
import fs from 'fs';
import { backupDatabase, exportSnapshot, restoreDatabase } from '../services/backup';
import { requireRole } from '../middleware/auth';

const router = express.Router();

// POST /api/backup - Generate backup
router.post('/', requireRole('ADMIN'), async (_req, res) => {
  try {
    const result = await backupDatabase();
    res.json({
      success: true,
      file: result.filePath,
      fileName: result.fileName,
      format: result.format,
      sizeBytes: result.sizeBytes,
      downloadUrl: `/api/backup/download/${result.fileName}`,
    });
  } catch (error: any) {
    console.error('Backup error:', error);
    res.status(500).json({ error: error.message || 'Backup failed.' });
  }
});

// GET /api/backup/export - Complete, self-contained JSON snapshot (used by Settings -> Export)
router.get('/export', requireRole('ADMIN'), async (_req, res) => {
  try {
    const snapshot = await exportSnapshot();
    res.json(snapshot);
  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message || 'Export failed.' });
  }
});

// GET /api/backup/download/:filename - Download backup
router.get('/download/:filename', requireRole('ADMIN'), (req, res) => {
  const safeFilename = path.basename(String(req.params.filename));
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups'));
  const filePath = path.join(backupDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup file not found.' });
  }

  res.download(safeFilename, safeFilename, { root: backupDir });
});

// POST /api/backup/restore - Restore from JSON backup payload
router.post('/restore', requireRole('ADMIN'), async (req, res) => {
  try {
    const backupData = req.body;
    if (!backupData) {
      return res.status(400).json({ error: 'No backup data provided.' });
    }

    const result = await restoreDatabase(backupData);
    res.json({
      success: true,
      restoredTables: result.restoredTables,
      verifiedCounts: result.verifiedCounts,
      skippedTables: result.skippedTables,
      totalRows: result.totalRows,
    });
  } catch (error: any) {
    console.error('Restore error:', error);
    res.status(500).json({ error: error.message || 'Restore failed.' });
  }
});

export default router;
