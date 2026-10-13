# گزارش جامع فاز ۴ و نهایی: سامانه موبایل چندنقشی NIR
**نسخه:** 1.0.0  
**تاریخ گزارش:** ۱۴۰۵/۰۷/۱۹ (2026-10-10)  
**معماری:** Cross-Platform React Native (Expo SDK 51) + Offline-First Engine + Role-Based Dynamic Navigation + Node.js/PostgreSQL Backend

---

## ۱. خلاصه اجرایی پروژه (Executive Summary)

پروژه سامانه موبایل NIR با موفقیت کامل در ۴ فاز متوالی طراحی، پیاده‌سازی و تست گردید:

1. **فاز اول (زیرساخت دیتابیس و اندپوینت‌های بک‌اند):**
   - مایگریشن کامپتیبل `migrations/0004_mobile_support.sql` (جداول `otp_codes`, `device_tokens`, `delivery_proofs`, `farmer_orders` و ستون‌های افزایشی راننده و مرغدار).
   - اندپوینت‌های احراز هویت پیامکی (OTP) و ورود مستقیم، رفرش توکن، متادیتا و کنترل نسخه، کارتابل راننده، فاکتورهای مرغدار، مانیتورینگ باسکول و KPI مدیر.
   - رعایت قانون تغییرات ایمن (Zero Breaking Changes) نسبت به سامانه تحت وب، ورکر باسکول (`weighbridge-worker.cjs`) و پایگاه داده.

2. **فاز دوم (موتور آفلاین و زیرساخت کلاینت موبایل `nir-mobile`):**
   - انتقال و بازاستفاده از الگوریتم‌های تقویم شمسی جلالی (`jalali.ts`) و نرمال‌سازی متون و پلاک فارسی (`persianText.ts`).
   - سرویس احراز هویت امن با `expo-secure-store` و اینترسپتور هوشمند Axios با مکانیزم بازپخش درخواست‌ها و رفرش توکن خودکار در خطای ۴۰۱.
   - موتور صف آفلاین پایدار بر پایه MMKV با قرنطینه خطاهای ۴۰۰/۴۲۲ (Dead-Letter) و صف‌بندی ایمن عملیات رانندگان در نقاط کور جاده‌ای.

3. **فاز سوم (شل‌های چندنقشی و ناوبری پویا):**
   - ساختار ناوبری شرطی و هوشمند (`RootNavigator` -> `AuthNavigator`, `DriverNavigator`, `FarmerNavigator`, `ManagerNavigator`).
   - کامپوننت‌های اشتراکی رابط کاربری با NativeWind و تایپوگرافی فارسی وزیرمتن (`Vazirmatn`).
   - صفحات اختصاصی راننده (کارت‌های بار، بارگذاری رسید و بارنامه، بوم امضای لمسی، مختصات خودکار GPS).
   - صفحات اختصاصی مرغدار (پایش دوره پرورش فعال، مقایسه وزن فاکتور با خالص باسکول و تشخیص مغایرت بالای ۵۰ کیلوگرم، ثبت سفارش دانه).
   - صفحات اختصاصی مدیر (شاخص‌های کلیدی ورود/خروج و موجودی انبار، مانیتورینگ زنده باسکول، کارتابل تایید سفارشات و اسناد تخلیه).

4. **فاز چهارم (تنظیمات استقرار، پوش نوتیفیکیشن، پکیجینگ و بیلد موفق):**
   - ایجاد دارایی‌های بصری برندینگ کارخانه آرادان (`icon.png`, `adaptive-icon.png`, `splash.png`, `favicon.png`).
   - پیاده‌سازی سرویس پوش نوتیفیکیشن (`notificationService.ts`) با ایجاد کانال اندروید اختصاصی و ثبت خودکار توکن در سرور.
   - اتصال پروژه به حساب رسمی EAS کاربری `artadan` (`@artadan/nir-mobile`).
   - تولید موفقیت‌آمیز فایل APK مستقیم جهت پایلوت و مارکت‌های داخلی (کافه‌بازار و مایکت).
   - تولید موفقیت‌آمیز پکیج استاندارد گوگل‌پلی (Android App Bundle - AAB).

---

## ۲. خروجی بیلدهای رسمی تولیدشده (Production & Preview Build Artifacts)

### ۱. پکیج APK نصب مستقیم (جهت پایلوت، رانندگان و کافه‌بازار/مایکت):
- **پروفایل بیلد:** `preview` (فرمت APK)
- **لینک دانلود مستقیم و لاگ بیلد:** [صفحه بیلد APK در EAS](https://expo.dev/accounts/artadan/projects/nir-mobile/builds/84dae607-de39-40c1-9f73-cdbe393bdcd6)
- **شناسه پکیج:** `ir.artadan.nir`
- **نسخه:** `1.0.0`

### ۲. پکیج نهایی مارکت‌ها (Android App Bundle - AAB):
- **پروفایل بیلد:** `production` (فرمت AAB)
- **لینک مستقیم آرتیفکت AAB:** [دانلود فایل uZRjWlVHLbJUPSzLoeUKI5iNDut4_zEecMHyWEryKBI.aab](https://expo.dev/artifacts/eas/uZRjWlVHLbJUPSzLoeUKI5iNDut4_zEecMHyWEryKBI.aab)
- **لینک لاگ و جزییات بیلد در EAS:** [صفحه بیلد AAB در EAS](https://expo.dev/accounts/artadan/projects/nir-mobile/builds/1d8fbfc3-dea2-4a03-8fff-694f36543af0)

---

## ۳. ماتریس اعتبارسنجی و تست‌های تضمین کیفیت (Test Matrix)

تمام لایه‌های سیستم به صورت ۱۰۰٪ موفق تست شده و به پایداری کامل رسیده‌اند:

| ردیف | نام مجموعه تست | فایل منبع | تعداد تست | وضعیت |
|:---:|:---|:---|:---:|:---:|
| ۱ | تست‌های رگرسیون صف سینک و سورتینگ سامانه وب | `tests/syncQueue.test.ts`, `tests/multiSort.test.ts`, `tests/tableSortEdges.test.ts` | ۲۸ | **PASS** |
| ۲ | تست‌های یکپارچه‌سازی و مرج مرغداران و دوره‌ها | `tests/farmerNames.test.ts`, `tests/broodMerge.test.ts`, `tests/farmerMerge.test.ts` | ۳۰ | **PASS** |
| ۳ | تست‌های جامع اندپوینت‌های بک‌اند موبایل | `tests/mobileApi.test.ts` | ۱۰ | **PASS** |
| ۴ | تست‌های زیرساخت کلاینت، جلالی و فرمترها | `nir-mobile/tests/mobileInfra.test.ts` | ۷ | **PASS** |
| ۵ | تست‌های اینترسپتور شبکه و صف آفلاین MMKV | `nir-mobile/tests/networkAndOffline.test.ts` | ۴ | **PASS** |
| ۶ | تست‌های جریان احراز هویت و OTP موبایل | `nir-mobile/tests/authFlow.test.ts` | ۳ | **PASS** |
| ۷ | تست‌های روتینگ و ناوبری پویا بر اساس نقش | `nir-mobile/tests/navigationFlow.test.ts` | ۶ | **PASS** |
| ۸ | تست‌های ثبت تحویل بار در حالت آفلاین راننده | `nir-mobile/tests/driverOfflineProof.test.ts` | ۳ | **PASS** |
| ۹ | تست‌های ارزیابی تلورانس باسکول مرغدار (<= 50kg) | `nir-mobile/tests/farmerDiscrepancy.test.ts` | ۵ | **PASS** |
| ۱۰ | تست‌های ثبت توکن اعلان‌ها و کانال نوتیفیکیشن | `nir-mobile/tests/notifications.test.ts` | ۳ | **PASS** |
| **جمع** | **مجموع تست‌های موفق پاس‌شده** | **کل سیستم NIR** | **۹۹ / ۹۹** | **۱۰۰٪ PASS** |

- بررسی تایپ‌های تایپ‌اسکریپت (`tsc --noEmit`): **۰ خطا (Zero Errors)**
- بیلد سرور و وب کلاینت (`npm run build`): **موفقیت‌آمیز (dist/server.cjs)**

---

## ۴. دستورات خط فرمان جهت تکرار بیلد

در صورت نیاز به ایجاد بیلد‌های جدید در آینده:
```bash
# رفتن به پوشه کلاینت موبایل
cd nir-mobile

# بیلد نسخه APK (نصب مستقیم):
npx eas-cli build -p android --profile preview

# بیلد نسخه AAB (گوگل‌پلی و مارکت‌ها):
npx eas-cli build -p android --profile production
```
