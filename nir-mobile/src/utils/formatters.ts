/**
 * Persian number, currency, weight and date formatters for NIR Mobile Client.
 */

import { jalaliText } from './jalali';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * Converts Latin / ASCII digits in a string or number to Persian digits.
 */
export const toPersianDigits = (value: unknown): string => {
  const str = String(value ?? '');
  return str.replace(/\d/g, (d) => PERSIAN_DIGITS[parseInt(d, 10)] ?? d);
};

/**
 * Formats a number with standard 3-digit comma separators.
 */
export const formatNumberWithCommas = (value: number | string): string => {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '۰';

  const parts = num.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

/**
 * Formats weight values with comma separation and optional unit.
 * Example: `formatWeight(12450)` -> `۱۲,۴۵۰ کیلوگرم` (or `12,450 کیلوگرم`)
 */
export const formatWeight = (
  kg: number | string,
  includeUnit = true,
  persianDigits = true
): string => {
  const formattedNum = formatNumberWithCommas(kg);
  const result = persianDigits ? toPersianDigits(formattedNum) : formattedNum;
  return includeUnit ? `${result} کیلوگرم` : result;
};

/**
 * Formats currency values in Rials or Tomans.
 * Example: `formatCurrency(1500000)` -> `۱,۵۰۰,۰۰۰ ریال`
 */
export const formatCurrency = (
  amount: number | string,
  unit = 'ریال',
  persianDigits = true
): string => {
  const formattedNum = formatNumberWithCommas(amount);
  const result = persianDigits ? toPersianDigits(formattedNum) : formattedNum;
  return unit ? `${result} ${unit}` : result;
};

/**
 * Formats a date into Persian Jalali string.
 */
export const formatJalaliDate = (
  date: Date | string | number | null | undefined,
  persianDigits = true
): string => {
  const txt = jalaliText(date);
  return persianDigits ? toPersianDigits(txt) : txt;
};
