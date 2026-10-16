/**
 * Card - کامپوننت بستر (سطح)
 * الگو Shadcn/RN Reusables: base class + cva variants
 * RTL-ready (rtl:ml-auto و ...) وваزیرمتن
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const cardVariants = cva(
  [
    'bg-surface',
    'border border-border',
    'rounded-lg',
    'shadow-base',
    'rtl', // جهت راست‌چین (پشتیبانی NativeWind rtl:*)
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface border-border',
        elevated: 'bg-surfaceElevated shadow-lg border-border',
        outline: 'bg-transparent border-border-2',
        ghost: 'bg-transparent',
      },
      size: {
        sm: 'p-3',
        default: 'p-4',
        lg: 'p-6',
      },
      radius: {
        none: 'rounded-none',
        sm: 'rounded-sm',
        default: 'rounded-lg',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        full: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      radius: 'default',
    },
  }
);

export interface CardProps
  extends React.ComponentPropsWithRef<typeof View>,
    VariantProps<typeof cardVariants> {
  children?: React.ReactNode;
  className?: string;
}

export const Card = React.forwardRef<View, CardProps>(({ className, variant, size, radius, children, style, ...props }, ref) => {
  return (
    <View
      ref={ref}
      style={[StyleSheet.flatten([style]) as ViewStyle]}
      {...props}
      className={cn(cardVariants({ variant, size, radius, className }))}
    >
      {children}
    </View>
  );
});

Card.displayName = 'Card';

/**
 * CardHeader - سربرگ کارت
 */
export interface CardHeaderProps extends React.ComponentPropsWithRef<typeof View> {
  className?: string;
}
export const CardHeader = React.forwardRef<View, CardHeaderProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('flex-row items-center space-x-3', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

/**
 * CardTitle - عنوان کارت (فونت Vazirmatn،伯特 )
 */
export interface CardTitleProps extends React.ComponentPropsWithRef<typeof Text> {
  className?: string;
}
export const CardTitle = React.forwardRef<Text, CardTitleProps>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn('font-vazirmatn text-base font-semibold text-foreground', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

/**
 * CardDescription - توضیح کارت
 */
export interface CardDescriptionProps extends React.ComponentPropsWithRef<typeof Text> {
  className?: string;
}
export const CardDescription = React.forwardRef<Text, CardDescriptionProps>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn('font-vazirmatn text-sm text-mutedForeground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

/**
 * CardContent - محتوای اصلی کارت
 */
export interface CardContentProps extends React.ComponentPropsWithRef<typeof View> {
  className?: string;
}
export const CardContent = React.forwardRef<View, CardContentProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('mt-2', className)} {...props} />
));
CardContent.displayName = 'CardContent';

/**
 * CardFooter - پاورقی کارت
 */
export interface CardFooterProps extends React.ComponentPropsWithRef<typeof View> {
  className?: string;
}
export const CardFooter = React.forwardRef<View, CardFooterProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('flex-row items-center justify-between mt-4', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';