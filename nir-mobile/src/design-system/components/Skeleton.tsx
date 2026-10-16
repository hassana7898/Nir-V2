/**
 * Skeleton - لودر استخوانی برای صفحات مدیر/مرغدار/راننده/اپراتور
 * انیمیشن pulse با NativeWind (animate-pulse) و رنگ slate-200
 */

import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { cn } from '../utils/cn';

export interface SkeletonProps extends React.ComponentPropsWithRef<typeof View> {
  className?: string;
  width?: number | string;
  height?: number | string;
  borderRadius?: string;
}

export const Skeleton = React.forwardRef<View, SkeletonProps>(
  ({ className, width, height, borderRadius = 'rounded-lg', style, ...props }, ref) => {
    return (
      <View
        ref={ref}
        className={cn(
          'bg-skeleton animate-pulse overflow-hidden',
          width ? `w-[${typeof width === 'number' ? width + 'px' : width}]` : '',
          height ? `h-[${typeof height === 'number' ? height + 'px' : height}]` : '',
          borderRadius,
          className
        )}
        style={[StyleSheet.flatten([style]) as ViewStyle]}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

/**
 * SkeletonText - خط متنیPlaceHolder
 */
export const SkeletonText = ({ lines = 3, className }: { lines?: number; className?: string }) => {
  return (
    <View className={cn('flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} className={cn(i === lines - 1 ? 'w-2/3' : 'full', 'h-4 rounded-full')} />
      ))}
    </View>
  );
};