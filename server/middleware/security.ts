import type { Request, Response, NextFunction } from 'express';

export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Allow framing for AI Studio live preview.
  // `default-src` stays locked down; explicit `style-src`/`font-src` are required because
  // the UI ships its own font-face CSS and woff2 assets. The Sahel webfont is now served
  // self-hosted from /fonts/sahel/ (no external CDN), so no jsDelivr origin is allow-listed.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      'frame-ancestors *',
    ].join('; ') + ';'
  );
  next();
};
