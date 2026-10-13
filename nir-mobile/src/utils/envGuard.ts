/**
 * Environment guard: a dev build must never be able to talk to production, and vice versa.
 *
 * The app ships as one codebase with two variants (`app.config.js`: APP_VARIANT=dev ->
 * package ir.artadan.nir.dev + https://dev.artadan.ir; otherwise the production app). The login
 * screen also lets an operator override the server address (LAN/VPS testing), which is exactly how
 * a dev APK could silently start writing to the production database.
 *
 * Rules enforced here (pure, unit-tested):
 *   * a build may talk to its own environment  -> allowed
 *   * a build may talk to any OTHER host (LAN IP, localhost, custom VPS) -> allowed (explicit
 *     operator action, needed for field testing)
 *   * a build may NOT talk to the opposite artadan.ir environment -> refused
 */

export type AppVariant = 'dev' | 'production';
export type TargetEnvironment = 'dev' | 'production' | 'other';

export const ARTADAN_HOSTS: Record<AppVariant, string> = {
  dev: 'dev.artadan.ir',
  production: 'app.artadan.ir',
};

export const hostOf = (url: string): string => {
  const raw = String(url || '').trim();
  if (!raw) return '';

  // A scheme-less "host:port/path" is parsed by WHATWG URL as protocol "host:" (hostname empty!),
  // so never hand it straight to `new URL` - a "dev.artadan.ir:3001" would silently become "".
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const candidate = hasScheme ? raw : `http://${raw.replace(/^\/+/, '')}`;

  try {
    const host = new URL(candidate).hostname.toLowerCase();
    if (host) return host;
  } catch {
    // Fall through to the manual parse below (malformed URLs must not defeat the guard).
  }

  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const host = withoutScheme.split('/')[0].split('?')[0].split('@').pop() || '';
  return host.split(':')[0].toLowerCase();
};

export const detectTargetEnvironment = (url: string): TargetEnvironment => {
  const host = hostOf(url);
  if (!host) return 'other';
  if (host === ARTADAN_HOSTS.dev || host.endsWith(`.${ARTADAN_HOSTS.dev}`)) return 'dev';
  if (host === ARTADAN_HOSTS.production || host.endsWith(`.${ARTADAN_HOSTS.production}`)) return 'production';
  return 'other';
};

/** The variant of a build, derived from the API URL baked into the bundle by eas.json/app.config.js. */
export const resolveAppVariant = (buildDefaultUrl: string): AppVariant =>
  detectTargetEnvironment(buildDefaultUrl) === 'production' ? 'production' : 'dev';

export interface BaseUrlDecision {
  allowed: boolean;
  /** URL that must actually be used (the build default when the request is refused). */
  url: string;
  reason?: string;
}

export const evaluateBaseUrl = (
  variant: AppVariant,
  requestedUrl: string,
  buildDefaultUrl: string
): BaseUrlDecision => {
  const target = detectTargetEnvironment(requestedUrl);

  if (target === 'other' || target === variant) {
    return { allowed: true, url: requestedUrl };
  }

  return {
    allowed: false,
    url: buildDefaultUrl,
    reason:
      variant === 'dev'
        ? 'این نسخه‌ی آزمایشی (NIR Dev) مجاز به اتصال به سرور عملیاتی نیست. آدرس سرور توسعه استفاده می‌شود.'
        : 'نسخه‌ی عملیاتی مجاز به اتصال به سرور آزمایشی نیست. آدرس سرور اصلی استفاده می‌شود.',
  };
};

export const variantLabel = (variant: AppVariant): string =>
  variant === 'dev' ? 'نسخه آزمایشی (Dev)' : 'نسخه عملیاتی';
