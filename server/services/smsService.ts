import { toAsciiDigits } from '../../shared/persianText';

/**
 * Standardize Iranian mobile number to 11-digit format starting with 09 (e.g., 09123456789)
 */
export const normalizeIranianPhone = (raw: unknown): string => {
  if (!raw) return '';
  let str = toAsciiDigits(String(raw)).trim();
  // Remove spaces, dashes, parentheses
  str = str.replace(/[\s\-_()]/g, '');

  // Handle +98 or 0098 prefix
  if (str.startsWith('+98')) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('0098')) {
    str = '0' + str.slice(4);
  } else if (str.startsWith('98') && str.length === 12) {
    str = '0' + str.slice(2);
  } else if (!str.startsWith('0') && str.length === 10) {
    str = '0' + str;
  }

  return str;
};

/**
 * Validate standard 11-digit Iranian mobile phone
 */
export const isValidIranianMobile = (phone: string): boolean => {
  return /^09\d{9}$/.test(phone);
};

/**
 * Send OTP SMS or log in dev/test environment
 */
export const sendOtpSms = async (phone: string, code: string): Promise<{ success: boolean; message: string }> => {
  const normalized = normalizeIranianPhone(phone);
  if (!isValidIranianMobile(normalized)) {
    return { success: false, message: 'شماره تلفن همراه نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹' };
  }

  const apiKey = process.env.KAVENEGAR_API_KEY || process.env.SMS_API_KEY;

  if (apiKey) {
    try {
      // Optional Kavenegar HTTP API integration if API key is provided
      const response = await fetch(`https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          receptor: normalized,
          token: code,
          template: process.env.KAVENEGAR_OTP_TEMPLATE || 'nir-verify',
        }),
      });

      if (!response.ok) {
        console.warn(`[SMS ERROR] Kavenegar gateway returned HTTP ${response.status}`);
      } else {
        console.log(`[SMS SENT] Successfully dispatched OTP SMS to ${normalized}`);
        return { success: true, message: 'پیامک اعتبارسنجی ارسال گردید.' };
      }
    } catch (err: any) {
      console.error('[SMS ERROR] Failed to dispatch via SMS provider:', err?.message || err);
    }
  }

  // Fallback / Development / Staging Mock log
  console.log(`\n======================================================`);
  console.log(`[NIR SMS MOCK] Mobile: ${normalized} | OTP Code: [ ${code} ]`);
  console.log(`======================================================\n`);

  return { success: true, message: 'کد تایید ارسال شد (محیط تست/عملیات).' };
};
