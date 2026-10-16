/**
 * Button - دمه principale/action
 * شادcn/ RN Reusables: base + cva، Ripple (Android) و Pressable
 * RTL-aware (direction via tailwind rtl:*)
 */

import React from 'react';
import { Pressable, PressableProps, Text, TextStyle, StyleSheet, ViewStyle } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const buttonVariants = cva(
  [
    'font-vazirmatn',
    'font-semibold',
    'rounded-lg',
    'text-center',
    'items-center',
    'justify-center',
    'rtl',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primaryForeground shadow-md shadow-primary/20 active:scale-[0.98]',
        secondary:
          'bg-secondary text-secondaryForeground border border-border shadow-sm active:scale-[0.98]',
        outline:
          'bg-transparent border border-border text-foreground shadow-none active:scale-[0.98]',
        ghost: 'bg-transparent text-foreground shadow-none active:scale-[0.98]',
        destructive:
          'bg-destructive text-destructiveForeground shadow-md shadow-destructive/20 active:scale-[0.98]',
        success:
          'bg-success text-successForeground shadow-md shadow-success/20 active:scale-[0.98]',
      },
      size: {
        sm: 'h-8 px-2 text-[11px]',
        default: 'h-10 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
        icon: 'h-10 w-10 p-0',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
      fullWidth: false,
    },
  }
);

export interface ButtonProps extends PressableProps, VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  className?: string;
}

type PressableRef = React.ComponentRef<typeof Pressable>;

export const Button = React.forwardRef<PressableRef, ButtonProps>(
  ({ className, variant, size, fullWidth, children, style, ...props }, ref) => {
    return (
      <Pressable
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        style={[StyleSheet.flatten([style]) as ViewStyle]}
        {...props}
      >
        <Text
          className={cn(
            size === 'icon' ? '' : 'font-vazirmatn',
            'text-center'
          )}
        >
          {children}
        </Text>
      </Pressable>
    );
  }
);

Button.displayName = 'Button';