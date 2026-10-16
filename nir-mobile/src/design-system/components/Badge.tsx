/**
 * Badge - برچسب وضعیت (وضعیت سفارش، نوع مرغ، وضعیت راننده و ...)
 * Shadcn-style: base + cva variants
 */

import React from 'react';
import { Text, TextStyle, View, ViewStyle, StyleSheet } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const badgeVariants = cva(
  [
    'font-vazirmatn',
    'text-xs',
    'font-medium',
    'rounded-full',
    'px-2',
    'py-0.5',
    'leading-tight',
    'rtl',
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface text-foreground border border-border',
        primary: 'bg-primary text-primaryForeground',
        secondary: 'bg-secondary text-secondaryForeground',
        success: 'bg-success text-successForeground',
        destructive: 'bg-destructive text-destructiveForeground',
        warning: 'bg-warning/10 text-warning border border-warning/30',
        outline: 'bg-transparent text-foreground border border-border',
      },
      size: {
        sm: 'px-1.5 py-0 text-[10px]',
        default: 'px-2 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.ComponentPropsWithRef<typeof Text>,
    VariantProps<typeof badgeVariants> {
  className?: string;
}

export const Badge = React.forwardRef<Text, BadgeProps>(({ className, variant, size, style, ...props }, ref) => {
  return (
    <Text
      ref={ref}
      style={[StyleSheet.flatten([style]) as TextStyle]}
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  );
});

Badge.displayName = 'Badge';