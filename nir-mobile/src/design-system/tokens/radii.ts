/**
 * Design Tokens - Border Radius
 * الصناعية / مدرن: لبه‌های نرم اما مشخص
 */

export const radii = {
  none: 0,
  sm: 4,
  base: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  full: 9999,
} as const;

export type RadiusScale = keyof typeof radii;