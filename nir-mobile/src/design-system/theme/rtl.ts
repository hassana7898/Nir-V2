/**
 * RTL Configuration
 * فعال‌سازی راست‌چین برای تمام صفحات (مدیر، مرغدار، راننده، اپراتور)
 * فراخوانی در ریشه اپلیکیشن (Layout/App)
 */

import { I18nManager } from 'react-native';

export const isRTL = true;

export function setupRTL(): void {
  // forceRTL باید قبل از رندر ریشه صدا شود
  const shouldForce = !I18nManager.isRTL;
  if (shouldForce) {
    I18nManager.forceRTL(true);
  }
}

export const rtlDirections = {
  // margin/padding mirrored utilities برای NativeWind (rtl:mx-4 و غیره در tailwind.config)
  start: 'rtl:ml-auto rtl:mr-0',
  end: 'rtl:mr-auto rtl:ml-0',
} as const;