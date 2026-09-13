import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const router = express.Router();

const uploadsDir = path.resolve(process.env.UPLOAD_DIR || process.env.NIR_UPLOADS_PATH || path.join(process.cwd(), 'data', 'uploads'));
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

// POST /api/uploads - Upload single file
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.status(201).json({
    success: true,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    url: fileUrl,
  });
});

// GET /api/uploads/:filename - Serve uploaded file directly
router.get('/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.sendFile(safeFilename, { root: uploadsDir });
});

export default router;
