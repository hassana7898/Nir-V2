/**
 * Tailwind Config Extension برای NativeWind
 * توکن‌ها را به کلاس‌های کاربردی تبدیل می‌کند
 * در tailwind.config.js پروژه اصلی import شود
 */

import type { Config } from 'tailwindcss';
import { colors, semanticColors } from '../tokens/colors';
import { fontFamily, fontSize, lineHeight, fontWeight, letterSpacing } from '../tokens/typography';
import { spacing } from '../tokens/spacing';
import { radii } from '../tokens/radii';
import { shadows } from '../tokens/shadows';

export const nirDesignSystemConfig: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        slate: colors.slate,
        emerald: colors.emerald,
        // semantic
        background: semanticColors.background,
        surface: semanticColors.surface,
        foreground: semanticColors.foreground,
        mutedForeground: semanticColors.mutedForeground,
        border: semanticColors.border,
        primary: semanticColors.primary,
        primaryForeground: semanticColors.primaryForeground,
        secondary: semanticColors.secondary,
        secondaryForeground: semanticColors.secondaryForeground,
        destructive: semanticColors.destructive,
        destructiveForeground: semanticColors.destructiveForeground,
        success: semanticColors.success,
        successForeground: semanticColors.successForeground,
        ring: semanticColors.ring,
        input: semanticColors.input,
      },
      fontFamily: {
        vazirmatn: [fontFamily.vazirmatn, 'sans-serif'],
        sans: [fontFamily.vazirmatn, 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
      fontSize,
      lineHeight,
      fontWeight,
      letterSpacing,
      spacing,
      borderRadius: radii,
      boxShadow: {
        sm: [shadows.sm.shadowColor || '#000', shadows.sm.shadowOffset, shadows.sm.shadowOpacity, shadows.sm.shadowRadius].join(' '),
        md: [shadows.md.shadowColor || '#000', shadows.md.shadowOffset, shadows.md.shadowOpacity, shadows.md.shadowRadius].join(' '),
        lg: [shadows.lg.shadowColor || '#000', shadows.lg.shadowOffset, shadows.lg.shadowOpacity, shadows.lg.shadowRadius].join(' '),
        xl: [shadows.xl.shadowColor || '#000', shadows.xl.shadowOffset, shadows.xl.shadowOpacity, shadows.xl.shadowRadius].join(' '),
      },
    },
  },
  // RTL direction utilities (rtl:ml-auto و غیره)
  important: false,
} as unknown as Config;

export default nirDesignSystemConfig;