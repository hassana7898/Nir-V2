const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function createPng(width, height, getPixel) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a !== undefined ? a : 255;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflated),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Color palettes
const BG_DARK = [15, 23, 42];      // #0f172a
const BG_BRAND = [2, 132, 199];    // #0284c7 (sky-600)
const ACCENT_SKY = [56, 189, 248];  // #38bdf8 (sky-400)
const WHITE = [255, 255, 255];
const SILVER = [226, 232, 240];    // #e2e8f0

// 1. Generate icon.png (512x512)
console.log('Generating assets/icon.png...');
const iconPng = createPng(512, 512, (x, y) => {
  // Normalize to [-1, 1]
  const nx = (x - 256) / 256;
  const ny = (y - 256) / 256;

  // Outer rounded squircle background
  const distSquircle = Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 4);
  if (distSquircle > 0.85) {
    return [0, 0, 0, 0]; // Transparent outer edge
  }

  // Gradient background from primary blue to dark slate
  const grad = (ny + 1) / 2;
  const bgR = Math.round(BG_BRAND[0] * (1 - grad * 0.4) + BG_DARK[0] * (grad * 0.4));
  const bgG = Math.round(BG_BRAND[1] * (1 - grad * 0.4) + BG_DARK[1] * (grad * 0.4));
  const bgB = Math.round(BG_BRAND[2] * (1 - grad * 0.4) + BG_DARK[2] * (grad * 0.4));

  // Logo Drawing: Central Factory / Silo & Weighbridge emblem
  // Silo 1 (left)
  if (x >= 140 && x <= 210 && y >= 170 && y <= 350) {
    if (y < 200) {
      // Dome
      const domeDx = (x - 175) / 35;
      const domeDy = (y - 200) / 30;
      if (domeDx * domeDx + domeDy * domeDy <= 1) return WHITE;
    } else {
      return WHITE;
    }
  }

  // Silo 2 (center)
  if (x >= 220 && x <= 292 && y >= 140 && y <= 350) {
    if (y < 170) {
      // Dome
      const domeDx = (x - 256) / 36;
      const domeDy = (y - 170) / 30;
      if (domeDx * domeDx + domeDy * domeDy <= 1) return ACCENT_SKY;
    } else {
      return ACCENT_SKY;
    }
  }

  // Silo 3 (right)
  if (x >= 302 && x <= 372 && y >= 170 && y <= 350) {
    if (y < 200) {
      // Dome
      const domeDx = (x - 337) / 35;
      const domeDy = (y - 200) / 30;
      if (domeDx * domeDx + domeDy * domeDy <= 1) return WHITE;
    } else {
      return WHITE;
    }
  }

  // Horizontal Weighbridge Platform Base
  if (x >= 110 && x <= 402 && y >= 356 && y <= 376) {
    return SILVER;
  }

  // Scale ramp beams
  if (x >= 150 && x <= 180 && y >= 376 && y <= 396) return SILVER;
  if (x >= 332 && x <= 362 && y >= 376 && y <= 396) return SILVER;

  return [bgR, bgG, bgB, 255];
});
fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng);

// 2. Generate adaptive-icon.png (Android adaptive foreground)
console.log('Generating assets/adaptive-icon.png...');
const adaptivePng = createPng(512, 512, (x, y) => {
  // Center logo scaled to safe zone
  if (x >= 160 && x <= 220 && y >= 180 && y <= 330) return WHITE;
  if (x >= 226 && x <= 286 && y >= 150 && y <= 330) return ACCENT_SKY;
  if (x >= 292 && x <= 352 && y >= 180 && y <= 330) return WHITE;
  if (x >= 130 && x <= 382 && y >= 336 && y <= 356) return SILVER;
  return [0, 0, 0, 0]; // Transparent background for adaptive icon
});
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptivePng);

// 3. Generate splash.png (1080x1920)
console.log('Generating assets/splash.png...');
const splashPng = createPng(540, 960, (x, y) => {
  // Brand blue background
  const ny = y / 960;
  const bgR = Math.round(BG_BRAND[0] * (1 - ny * 0.3) + BG_DARK[0] * (ny * 0.3));
  const bgG = Math.round(BG_BRAND[1] * (1 - ny * 0.3) + BG_DARK[1] * (ny * 0.3));
  const bgB = Math.round(BG_BRAND[2] * (1 - ny * 0.3) + BG_DARK[2] * (ny * 0.3));

  // Centered logo in the middle (x around 270, y around 440)
  const cx = 270;
  const cy = 420;

  // Emblem
  if (x >= cx - 60 && x <= cx - 15 && y >= cy - 60 && y <= cy + 60) return WHITE;
  if (x >= cx - 10 && x <= cx + 35 && y >= cy - 85 && y <= cy + 60) return ACCENT_SKY;
  if (x >= cx + 40 && x <= cx + 85 && y >= cy - 60 && y <= cy + 60) return WHITE;
  if (x >= cx - 90 && x <= cx + 115 && y >= cy + 66 && y <= cy + 80) return SILVER;

  return [bgR, bgG, bgB, 255];
});
fs.writeFileSync(path.join(assetsDir, 'splash.png'), splashPng);

// 4. Generate favicon.png (48x48)
console.log('Generating assets/favicon.png...');
const favPng = createPng(48, 48, (x, y) => {
  if (x >= 12 && x <= 18 && y >= 15 && y <= 32) return WHITE;
  if (x >= 21 && x <= 27 && y >= 11 && y <= 32) return ACCENT_SKY;
  if (x >= 30 && x <= 36 && y >= 15 && y <= 32) return WHITE;
  if (x >= 8 && x <= 40 && y >= 33 && y <= 36) return SILVER;
  return [BG_BRAND[0], BG_BRAND[1], BG_BRAND[2], 255];
});
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favPng);

console.log('All mobile assets generated successfully in assets/ !');
