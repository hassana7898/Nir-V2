import express from 'express';
import path from 'path';
import fs from 'fs';
import { backupDatabase, exportSnapshot, restoreDatabase, restoreLegacySnapshot, isLegacySnapshot, listAutoBackups, restoreFromServerFile } from '../services/backup';
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

// POST /api/backup/restore-legacy  |  POST /api/backup/import-legacy
// Restore a pre-V2 (flat poultryApp* map) backup. Accepts either the raw payload or
// `{ data, options: { wipe } }` (or `?wipe=true`). With wipe=true the business tables
// are TRUNCATEd first (users/sessions/settings are always preserved) so a corrupted
// ledger is replaced by a clean, fully-typed import in one transaction.
const handleLegacyRestore = async (req: any, res: any) => {
  try {
    const body = req.body;
    const payload = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : body;
    if (!isLegacySnapshot(payload)) {
      return res.status(400).json({ error: 'Fingerprint does not match a legacy NIR backup.' });
    }
    const wipe = String(req.query.wipe ?? '') === 'true'
      || body?.options?.wipe === true
      || body?.wipe === true;
    const result = await restoreLegacySnapshot(payload, { wipe });
    res.json({
      success: true,
      wiped: result.wiped,
      restoredTables: result.restoredTables,
      verifiedCounts: result.restoredTables,
      skippedKeys: result.skippedKeys,
      warnings: result.warnings,
      totalRows: result.totalRows,
    });
  } catch (error: any) {
    console.error('Legacy restore error:', error);
    res.status(500).json({ error: error.message || 'Legacy restore failed.' });
  }
};

router.post('/restore-legacy', requireRole('ADMIN'), handleLegacyRestore);
router.post('/import-legacy', requireRole('ADMIN'), handleLegacyRestore);

// GET /api/backup/server-list - List scheduled backups on the server (newest first)
router.get('/server-list', requireRole('ADMIN'), (_req, res) => {
  try {
    res.json({ success: true, files: listAutoBackups() });
  } catch (error: any) {
    console.error('Backup list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list backups.' });
  }
});

// POST /api/backup/restore-server-file - 1-click restore from a server-side backup file
router.post('/restore-server-file', requireRole('ADMIN'), async (req, res) => {
  const filename = String(req.body?.filename ?? '').trim();
  const safeName = path.basename(filename);
  if (!safeName || !/^auto-backup-.*\.json$/.test(safeName)) {
    return res.status(400).json({ error: 'نام فایل پشتیبان نامعتبر است.' });
  }

  try {
    const result = await restoreFromServerFile(safeName);
    res.json({
      success: true,
      restoredTables: result.restoredTables,
      verifiedCounts: result.verifiedCounts,
      skippedTables: result.skippedTables,
      totalRows: result.totalRows,
    });
  } catch (error: any) {
    console.error('Server-file restore error:', error);
    res.status(500).json({ error: error.message || 'Restore failed.' });
  }
});

export default router;
