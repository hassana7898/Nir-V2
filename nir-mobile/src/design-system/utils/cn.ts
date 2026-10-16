/**
 * cn() - ساخت-classes مشابه Shadcn/RN Reusables
 * 입력 Class‌ها/بسته‌ها را از NativeWind و Tailwindwise مخلوط می‌کند
 * برایReact Native - NativeWind
 */

import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type { ClassValue };