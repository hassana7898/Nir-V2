import cors from 'cors';

export const parseAllowedOrigins = (envVal?: string): string[] => {
  const val = (envVal !== undefined ? envVal : (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')).trim();
  if (!val) return [];
  return val.split(',').map(o => o.trim()).filter(Boolean);
};

export const isOriginAllowed = (origin: string | undefined, configuredOrigins?: string[]): boolean => {
  // Same-origin, curl, server-to-server have no Origin header
  if (!origin) return true;

  const allowed = configuredOrigins !== undefined ? configuredOrigins : parseAllowedOrigins();

  if (allowed.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    }
    return true;
  }

  if (allowed.includes('*')) {
    return true;
  }

  if (allowed.includes(origin)) {
    return true;
  }

  return false;
};

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
});
