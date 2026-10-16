/**
 * cva() - Class Variants Authority (شبیه Shadcn-ui)
 * ساخت batch کلاس‌ها بر اساس variant و state
 */

import { type VariantProps, cva as _cva } from 'class-variance-authority';
import { type ClassValue } from 'clsx';
import { cn } from './cn';

export function cva(className: ClassValue, opts?: VariantProps<any>) {
  return _cva(className, opts as any);
}

export { cn };