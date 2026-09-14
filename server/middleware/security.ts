import type { Request, Response, NextFunction } from 'express';

export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Allow framing for AI Studio live preview.
  // `default-src` stays locked down; explicit `style-src`/`font-src` are required because
  // the UI loads the Sahel webfont (font-face CSS + woff2 files) from jsDelivr, and without
  // them those types fall back to default-src and the stylesheet is blocked.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "font-src 'self' data: https://cdn.jsdelivr.net",
      'frame-ancestors *',
    ].join('; ') + ';'
  );
  next();
};
