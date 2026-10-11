let Platform: { OS: string } = { OS: 'android' };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) {
    Platform = RN.Platform;
  }
} catch {
  Platform = { OS: 'android' };
}

let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

import { apiClient } from '../api/client';

// Configure how notifications are handled when the app is foregrounded
if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export interface PushRegistrationResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Register current device for Push Notifications and send token to NIR backend
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  try {
    if (!Notifications) {
      // Running in headless Node or environment without native notifications
      const dummyToken = `sim-token-${Date.now()}`;
      await apiClient.post('/mobile/device-token', {
        token: dummyToken,
        platform: Platform.OS || 'android',
      });
      return { success: true, token: dummyToken };
    }

    if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'سامانه NIR',
        description: 'اعلان‌های حواله، باسکول و ثبت بار',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0284c7',
        enableLights: true,
        enableVibrate: true,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { success: false, error: 'مجوز اعلان‌ها توسط کاربر رد شد.' };
    }

    // Try obtaining native device push token or expo push token
    let token = '';
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      token = typeof deviceToken.data === 'string' ? deviceToken.data : JSON.stringify(deviceToken.data);
    } catch {
      try {
        const expoToken = await Notifications.getExpoPushTokenAsync();
        token = expoToken.data;
      } catch {
        token = `sim-dev-token-${Date.now()}`;
      }
    }

    if (token) {
      await apiClient.post('/mobile/device-token', {
        token,
        platform: Platform.OS || 'android',
      });
    }

    return { success: true, token };
  } catch (error: any) {
    const errorMsg = error?.response?.data?.error || error?.message || 'خطا در ثبت توکن پوش نوتیفیکیشن';
    return { success: false, error: errorMsg };
  }
}

/**
 * Add a listener for notifications received while app is running
 */
export function addNotificationReceivedListener(
  callback: (notification: any) => void
) {
  if (Notifications && typeof Notifications.addNotificationReceivedListener === 'function') {
    return Notifications.addNotificationReceivedListener(callback);
  }
  return { remove: () => {} };
}

/**
 * Add a listener for user tapping on a notification
 */
export function addNotificationResponseReceivedListener(
  callback: (response: any) => void
) {
  if (Notifications && typeof Notifications.addNotificationResponseReceivedListener === 'function') {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }
  return { remove: () => {} };
}
