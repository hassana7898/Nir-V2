/**
 * Design Tokens - Typography
 * فونت فارسی Vazirmatn (Vazirmatn-FD.ttf و أبناء آن)
 * completamente RTL-friendly
 */

export const fontFamily = {
  // فونت فارسی اصلی (باید در assets/fonts و react-native.config.js ثبت شود)
  vazirmatn: 'Vazirmatn',
  vazirmatnBold: 'Vazirmatn-Bold',
  vazirmatnMedium: 'Vazirmatn-Medium',
  vazirmatnSemiBold: 'Vazirmatn-SemiBold',
  vazirmatnLight: 'Vazirmatn-Light',

  // Fallback برای Android / iOS
  system: 'System',
  systemBold: 'System Bold',
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  '4xl': 30,
} as const;

export const lineHeight = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const;

export const fontWeight = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

export const letterSpacing = {
  tighter: -0.5,
  tight: -0.25,
  normal: 0,
  wide: 0.25,
  wider: 0.5,
  widest: 1,
} as const;