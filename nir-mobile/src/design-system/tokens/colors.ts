/**
 * Design Tokens - Colors
 * 팔ت Slate (بستر/متن) + Emerald (اقدام/برند)
 * کنتراست بالا برای دسترسی‌پذیری (WCAG AA/AAA)
 * تمام مقادیر هگز برای React Native و NativeWind
 */

export const colors = {
  // ---------- Slate (بستر / background & surface) ----------
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  // ---------- Emerald (برند / primary & accent) ----------
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#022c22',
  },
} as const;

/**
 * Palette معنایی (semantic) برای استفاده در کامپوننت‌ها
 * manija / morghdar / ranande / boscall operator همه از یک منبع رنگی استفاده می‌کنند
 */
export const semanticColors = {
  // بسترها
  background: colors.slate[50],
  backgroundInverse: colors.slate[950],
  surface: '#ffffff',
  surfaceInverse: colors.slate[900],
  surfaceElevated: colors.slate[100],

  // متن
  foreground: colors.slate[900],
  foregroundInverse: '#ffffff',
  mutedForeground: colors.slate[500],
  mutedForegroundInverse: colors.slate[400],

  // برند / اقدام اولیه
  primary: colors.emerald[600],
  primaryForeground: '#ffffff',
  primaryHover: colors.emerald[700],
  primaryActive: colors.emerald[800],
  primaryLight: colors.emerald[50],

  // ثانویه
  secondary: colors.slate[200],
  secondaryForeground: colors.slate[900],
  secondaryHover: colors.slate[300],
  secondaryActive: colors.slate[400],

  // حاشیه / dividing
  border: colors.slate[300],
  borderInverse: colors.slate[700],
  input: colors.slate[300],
  ring: colors.emerald[500],

  // استرس / خطا / موفقیت / هشدار
  destructive: '#dc2626',
  destructiveForeground: '#ffffff',
  success: colors.emerald[600],
  successForeground: '#ffffff',
  warning: '#d97706',
  warningForeground: '#ffffff',

  // نوارکسره / skeleton
  skeleton: colors.slate[200],
  skeletonHighlight: colors.slate[300],
} as const;

export type ColorScale = keyof typeof colors.slate;