# فاز ۰ — گزارش تحلیل جامع سورس‌کد و شکاف‌ها برای اپلیکیشن موبایل NIR

> **وضعیت:** فاز ۰ (تحلیل) — فقط خواندن؛ هیچ کدی در بک‌اند/وب/دیتابیس تغییر داده نشد.
> **دامنه تحلیل:** مخزن `nirv2` (Node.js 20 + Express 5 + Drizzle ORM + PostgreSQL 18 | React 18 + Vite + Tailwind) و کلاینت موجود `nir-mobile` (Expo SDK 51 / React Native 0.74).
> **محیط هدف:** `dev.artadan.ir` (پورت داخلی 3001، دیتابیس `nir_dev`) — نمونه تولید روی همان VPS در `C:\Servers\NIR\app` با پورت 3000 اجرا می‌شود و **بی‌تأثیر** از این کار است.
> **تاریخ تحلیل:** 1405/07/21 (2026-10-13)

---

## ۰. خلاصه مدیریتی (بخوانید)

سه واقعیت کلیدی که مسیر فاز ۱ را تعیین می‌کند:

1. **اپ موبایل از صفر لازم نیست.** در همین مخزن یک کلاینت کامل Expo با ناوبری نقش‌محور، ۱۴ صفحه، موتور آفلاین MMKV، امضای لمسی، GPS، تاریخ شمسی و ۸ مجموعه تست وجود دارد (`nir-mobile/`). کار واقعی «تکمیل و اتصال» است، نه «ساخت از صفر».
2. **۱۶ شکاف شناسایی شد که ۴ مورد آن بحرانی است** و باعث می‌شود اپ امروز روی داده واقعی ناقص یا با داده جعلی کار کند؛ از جمله: مسیر اشتباه `POST /api/mobile/driver/proof` (سرور: `/delivery-receipt`)، عدم وجود ۳ اندپوینت کارتابل مدیر، و **fallback خودکار داده‌ی ماک** روی هر خطای شبکه/۴۰۴ که در محیط واقعی «موفقیت جعلی» تولید می‌کند.
3. **ورود دو نقش کلیدی امروز روی `nir_dev` عملاً ناممکن است:** هیچ مرغداری شماره تلفن ثبت‌شده ندارد (۰ از ۱۴۶) و هیچ کاربر `DRIVER`/`FARMER` وجود ندارد (۲ کاربر: ADMIN + VIEWER). همچنین `NODE_ENV=production` روی dev یعنی کد OTP نه پیامک می‌شود و نه در پاسخ API برمی‌گردد.

---

## ۱. تأیید خواندن سورس (شواهد)

فایل‌هایی که واقعاً خوانده و مبنای این گزارش شده‌اند:

| لایه | فایل‌ها |
|---|---|
| بوت و مسیرها | `server.ts` (mountهای `/api/*`)، `server/middleware/auth.ts`، `server/middleware/cors.ts`، `server/middleware/rateLimit.ts` |
| اندپوینت‌ها | `server/routes/{auth,users,farmers,drivers,origins,invoices,inventory,production,formulas,warehouses,weighbridge,reports,audit,settings,sync,uploads,backup,mobile,mobileAuth}.ts` |
| داده | `server/db/schema.ts`، `migrations/0004_mobile_support.sql` + بازخوانی زنده‌ی `nir_dev` (۲۴ جدول، ستون‌ها و تعداد رکورد) |
| وب | `App.tsx`، `components/MainLayout.tsx`، `components/Sidebar.tsx`، `pages/*` (اسامی و مسیرها)، `contexts/AuthContext.tsx` |
| موبایل | `nir-mobile/App.tsx`، `app.config.js`، `app.json`، `eas.json`، `src/api/client.ts`، `src/contexts/AuthContext.tsx`، `src/navigation/*`، `src/screens/**`، `src/services/*`، `tests/*` |
| مستندات موجود | `docs/ANDROID-APPS-PLAN.md`، `PHASE_4_MOBILE_DEPLOYMENT_REPORT.md`، `docs/DEV-ENVIRONMENT.md` |

**زنده (تأیید HTTP):** `https://dev.artadan.ir/api/health` → 200، `https://dev.artadan.ir/api/mobile/meta` → 200 (`todayJalali=1405/07/21`).

---

## ۲. معماری موجود و مدل امنیت

```
BROWSER (web app)                          MOBILE (Expo RN)
  │ cookie nir_session (HttpOnly)            │  Authorization: Bearer <accessToken>
  ▼                                          ▼
Nginx dev (127.0.0.1:8081) ──► node dist-dev/server.cjs  (dev, PORT 3001)
Nginx prod (443)           ──► node app/server.cjs      (prod, PORT 3000)
                                   │
                     Express 5 ────┼── rateLimit → requireAuth → requireRole → route
                                   ├── Drizzle ORM ──► PostgreSQL (nir_dev / nir_db)
                                   └── weighbridge-worker.cjs ──► MSSQL WeightTable (sync هر N ساعت)
```

- **احراز هویت وب:** کوکی `nir_session` + جدول `sessions` (با fallback به JWT امضاشده HS256، `issuer: nir-app`).
- **احراز هویت موبایل:** `POST /api/mobile/auth/*` → `accessToken` (۷ روز) + `refreshToken` (۳۰ روز) با `typ:'refresh'` (چرخش توکن). توکن در `expo-secure-store` نگه‌داری می‌شود.
- **نقش‌ها (کد بک‌اند):** `ADMIN` (ابرکاربر، همه‌چیز)، `MANAGER`، `OPERATOR`، `ACCOUNTING`، `VIEWER` (فقط خواندن — `blockViewerWrites`) + دو نقش **موبایلی** `DRIVER` و `FARMER` که فقط در `mobileAuth.ts` ساخته می‌شوند.
- **دامنه‌ی داده‌ی نقش‌محور سمت سرور:** راننده با `users.driver_id`، مرغدار با `users.farmer_id` / تطبیق `phone`؛ مدیر می‌تواند با `?driverId=` یا `?farmerId=` داده‌ی نقش دیگر را ببیند (`server/routes/mobile.ts:147,367,521`).

---

## ۳. فهرست کامل APIهای فعال (استخراج‌شده از `server.ts` + فایل‌های route)

`server.ts:84-104` همه‌ی گروه‌ها را یکسان mount می‌کند: `apiRateLimiter → requireAuth → blockViewerWrites → route` (به‌جز `/api/auth` و `/api/mobile*` که rate-limit مخصوص دارند). همه‌ی پاسخ‌های `/api` با `Cache-Control: no-store` برمی‌گردند (`server.ts:54-59`).

### ۳-۱. احراز هویت / کاربران

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/api/health` | عمومی | سلامت سرویس + دیتابیس |
| GET | `/api/auth/status` | عمومی | آیا رمز مدیر تعیین شده است؟ |
| POST | `/api/auth/setup` | عمومی (یک‌بار) | تعیین رمز اولیه |
| POST | `/api/auth/login` | عمومی | ورود وب → کوکی نشست |
| GET | `/api/auth/me` · POST `/api/auth/logout` | ورود/عمومی | کاربر جاری / ابطال نشست |
| GET | `/api/auth/2fa/status` · POST `2fa/generate` · `2fa/verify` · `2fa/disable` | ورود | TOTP |
| POST | `/api/auth/change-password` | ورود | تغییر رمز |
| GET | `/api/users` | ADMIN, MANAGER | فهرست کاربران |
| POST | `/api/users` | ADMIN | ایجاد کاربر (نقش + اتصال driver/farmer + phone) |
| PATCH | `/api/users/:id` | ADMIN | ویرایش (نقش/اتصال/تلفن/۲FA) |
| PUT | `/api/users/:id/password` · DELETE `/api/users/:id` | ADMIN | بازنشانی رمز / حذف |
| POST | `/api/mobile/auth/otp/request` | عمومی (rate-limit) | OTP ۶رقمی، TTL ۲ دقیقه در `otp_codes` |
| POST | `/api/mobile/auth/otp/verify` | عمومی | اعتبارسنجی → توکن + حل هویت راننده/مرغدار |
| POST | `/api/mobile/auth/login` | عمومی | ورود مدیر/اپراتور (username+password+TOTP) |
| POST | `/api/mobile/auth/refresh` · `/logout` | عمومی | چرخش توکن / ابطال نشست |

### ۳-۲. حواله‌ها (هسته‌ی کسب‌وکار) و باسکول

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/api/invoices` | ورود | `page/limit/type/search/startDate/endDate/farmerId/productId` |
| POST | `/api/invoices` | ADMIN, MANAGER, ACCOUNTING, OPERATOR | ثبت حواله ورود/خروج |
| PUT | `/api/invoices/:id` | ADMIN, MANAGER, ACCOUNTING | ویرایش |
| DELETE | `/api/invoices/:id` | ADMIN, MANAGER | حذف |
| POST | `/api/invoices/bulk-move` | ADMIN, MANAGER, ACCOUNTING, OPERATOR | جابه‌جایی گروهی |
| PUT | `/api/invoices/order` | ADMIN, MANAGER, ACCOUNTING, OPERATOR | ترتیب چاپ روز (`orderedIds`) |
| GET | `/api/weighbridge/records` · `/records/:id` · `/records/:id/candidates` | ورود | فهرست/جزئیات/کاندید تطبیق |
| GET | `/api/weighbridge/stats` · `/report` · `/report/daily` | ورود | آمار و گزارش باسکول |
| POST | `/api/weighbridge/records/:id/map` · `/unmap` | ADMIN, MANAGER | اتصال/فصل قبض به حواله |
| PATCH | `/api/weighbridge/records/:id/direction` | ADMIN, MANAGER | تعیین ورود/خروج قبض |
| POST | `/api/weighbridge/records/:id/create-remittance` | ADMIN, MANAGER | ساخت حواله از قبض |
| POST | `/api/weighbridge/sync` | ADMIN, MANAGER | سینک دستی با `WeightTable` (MSSQL) |

### ۳-۳. مرغداری، انبار، تولید و گزارش

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/api/farmers` | ورود | فهرست مرغداران + `broods` (JSONB دوره‌ها) |
| POST | `/api/farmers` · PUT `/:id` · DELETE `/:id` | نوشتن: ADMIN/MANAGER (حذف: ADMIN) | مدیریت پرونده |
| POST | `/api/farmers/merge` · `/:id/adopt-invoices` | ADMIN, MANAGER | ادغام / الحاق حواله‌های بی‌مالک |
| DELETE | `/api/farmers/:id/broods/:broodId` · PUT `.../restore` | ADMIN, MANAGER | آرشیو/بازگردانی دوره |
| GET/POST/DELETE | `/api/drivers` (`/:name`) | خواندن: ورود · نوشتن: ADMIN/MANAGER/OPERATOR | نام، تلفن، IBAN |
| GET/POST/DELETE | `/api/origins` (`/:name`) | خواندن: ورود · نوشتن: ADMIN/MANAGER/OPERATOR | مبدأها |
| GET | `/api/inventory/status` · `/transactions` | ورود | موجودی جاری + ریز تراکنش |
| POST | `/api/inventory/adjust` | ADMIN, MANAGER, OPERATOR | اصلاح موجودی |
| GET/POST/DELETE | `/api/production` (`/:id`) | خواندن: ورود · نوشتن: ADMIN/MANAGER/OPERATOR | ثبت تولید |
| GET/POST/PUT/DELETE | `/api/formulas` (`/:id`) | نوشتن: ADMIN/MANAGER | فرمول‌ها |
| GET/POST/PUT/DELETE | `/api/warehouses` (`/:id`) | نوشتن: ADMIN/MANAGER | انبارها/سیلوها |
| GET | `/api/reports/summary` | ADMIN, MANAGER, ACCOUNTING | خلاصه گزارش‌ها |
| GET | `/api/audit` | ADMIN, MANAGER | لاگ رخدادها |
| GET/PUT | `/api/settings` | ورود | تنظیمات کارخانه (نام، منوهای فعال، محصولات) |
| GET | `/api/sync/state` · POST `/api/sync` | POST: ADMIN/MANAGER/ACCOUNTING/OPERATOR | زنجیره‌ی آفلاین وب (`sync_mutations`) |

### ۳-۴. فایل، پشتیبان، موبایل و کمکی

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| POST | `/api/uploads` · GET `/api/uploads/:filename` · GET `/uploads/*` | ورود (سرو استاتیک: عمومی) | آپلود/دانلود فایل |
| POST | `/api/backup` · GET `/export` · GET `/download/:filename` · POST `/restore` · `/restore-legacy` · `/import-legacy` · GET `/server-list` · POST `/restore-server-file` | ADMIN | پشتیبان‌گیری/بازیابی |
| POST | `/api/extract` | ورود | استخراج هوشمند (Gemini) — روی dev کلید خالی است |
| GET | `/api/mobile/meta` | عمومی | `minAppVersion`, `currentAppVersion`, `maintenanceMode`, تاریخ شمسی |
| POST | `/api/mobile/device-token` | ورود | ثبت توکن پوش در `device_tokens` |
| GET | `/api/mobile/driver/loads` | ورود | بارهای فعال/تحویل‌شده + قبض باسکول + POD |
| POST | `/api/mobile/driver/delivery-receipt` | ورود | عکس بارنامه/باسکول/امضا + GPS (multipart یا base64) |
| GET | `/api/mobile/farmer/dashboard` | ورود | دوره‌ی فعال، سن گله، دان مصرفی، آخرین تحویل |
| GET | `/api/mobile/farmer/invoices` | ورود | حواله‌های خروج + مقایسه وزن بارنامه/باسکول (تلورانس ۵۰kg) |
| POST | `/api/mobile/farmer/orders` | ورود | ثبت درخواست دان (`farmer_orders`, status=pending) |
| GET | `/api/mobile/manager/kpi` | ADMIN, MANAGER | تناژ امروز، تعداد قبض، موجودی زنده‌ی انبار |
| GET | `/api/mobile/manager/weighbridge` | ADMIN, MANAGER | مانیتور قبوض («خالص‌شده» فقط پس از دو توزین) |

**جمع:** ۲۸ گروه mount‌شده، ~۹۵ اندپوینت فعال.

---

## ۴. نقش‌ها و تفکیک امکانات (استخراج‌شده از کد، نه فرض)

### ۴-۱. نقش‌های واقعی در سیستم

| نقش | منبع در کد | دامنه‌ی مجاز | وضعیت در `nir_dev` |
|---|---|---|---|
| `ADMIN` | `users.role` default · `requireRole` ابرکاربر (`auth.ts:168`) | همه‌چیز + `/api/users` + `/api/backup` | ۱ کاربر |
| `MANAGER` | `requireRole('ADMIN','MANAGER')` | تأییدها، باسکول، گزارش، مرغداران، انبار/تولید/فرمول | ۰ |
| `OPERATOR` | `requireRole(...,'OPERATOR')` | حواله، اصلاح انبار، تولید، مبدأ/راننده | ۰ |
| `ACCOUNTING` | `requireRole(...,'ACCOUNTING')` | حواله، ترتیب چاپ، گزارش مالی | ۰ |
| `VIEWER` | `blockViewerWrites` (`auth.ts:178`) | فقط GET | ۱ کاربر |
| `DRIVER` | فقط `mobileAuth.ts` | بارهای خودش، رسید تحویل | **۰** |
| `FARMER` | فقط `mobileAuth.ts` | دوره/حواله/سفارش خودش | **۰** |

### ۴-۲. ماتریس امکانات وب → موبایل

`components/Sidebar.tsx` + `components/MainLayout.tsx:84-100` فهرست رسمی امکانات وب است. ستون وضعیت موبایل از کد فعلی `nir-mobile` است.

| امکان وب | مسیر وب | صفحه‌ی موبایل امروز | وضعیت |
|---|---|---|---|
| داشبورد | `/dashboard` | `ManagerKpiScreen` (شاخص‌ها) | ✅ متصل (`/api/mobile/manager/kpi`) |
| حواله ورود | `/entry` | «حواله‌ها» فقط خواندنی (`RemittancesScreen`) | ⚠️ ثبت/ویرایش ندارد |
| حواله خروج | `/exit` | همان بالا | ⚠️ ثبت/ویرایش ندارد |
| مدیریت مرغداران | `/farmers` | `FarmersDirectoryScreen` (خواندنی) | ⚠️ فقط فهرست |
| مدیریت دوره‌ها | `/broods` | داخل `FarmerDashboardScreen` (سمت مرغدار) | ⚠️ سمت مدیر ندارد |
| انبارداری | `/inventory` | `InventoryMonitorScreen` | ⚠️ اصلاح موجودی ندارد |
| آنالیز انبار | `/inventory-analysis` | — | ❌ |
| تولید | `/production` | — | ❌ |
| مدیریت باسکول | `/weighbridge` | `WeighbridgeMonitorScreen` | ⚠️ map/unmap/create-remittance/گزارش ندارد |
| جستجوی سراسری | `/global-search` | — | ❌ |
| گزارش‌گیری | `/reports` | — | ❌ |
| داشبورد گزارش‌گیری | `/reports-dashboard` | — | ❌ |
| ردپای کاربران | `/log` | — | ❌ |
| تنظیمات | `/settings` | — (فقط تعویض آدرس سرور در `MoreMenuScreen`) | ❌ |
| — (موبایل‌محور) | — | راننده: `DriverLoads`/`LoadDetail`/`DeliveryProof` | ⚠️ جزئیات در بخش ۶ |
| — (موبایل‌محور) | — | مرغدار: `FarmerDashboard`/`FarmerInvoices`/`OrderFeedModal` | ⚠️ |
| — (موبایل‌محور) | — | مدیر: `Approvals`/`MoreMenu` | ❌ تکیه بر داده ماک |

### ۴-۳. آنچه در اپ موبایل امروز وجود دارد (واقعیت، نه فرض)

```
nir-mobile/
├─ App.tsx                    خطای‌گیر ریشه + فونت وزیرمتن + React Query + صف آفلاین
├─ app.config.js              دو حالت dev/prod (package مستقل ir.artadan.nir.dev)  ✅
├─ eas.json                   ۴ پروفایل بیلد (dev/preview/production-apk/production) ✅
└─ src/
   ├─ api/client.ts           Axios + Bearer + صف رفرش ۴۰۱ + (خطر) fallback ماک
   ├─ contexts/AuthContext.tsx OTP/پسورد/آفلاین + (خطر) admin/admin123 هاردکد
   ├─ navigation/             RootNavigator → Auth|Driver|Farmer|Manager
   ├─ screens/{auth,driver,farmer,manager}/  ۱۴ صفحه
   ├─ services/               secureStore, offlineQueue (MMKV), notificationService, mockDataService
   ├─ components/             MetricCard, StatusBadge, ScreenContainer, PersianDatePicker, SignaturePad, ImagePickerAction
   └─ utils/                  jalali.ts, persianText.ts, formatters.ts  (هم‌راستا با shared/ سرور)
```
تست‌های موجود: `nir-mobile/tests/*` (۸ فایل) + `tests/mobileApi.test.ts` در ریشه.

---

## ۵. وضعیت واقعی دیتابیس `nir_dev` (خوانده‌شده زنده، فقط خواندن)

`nir_dev` روی `127.0.0.1:5432` (پورت داخلی همان VPS؛ اپ dev با `PORT=3001`) — **۲۴ جدول**:

| جدول | ستون | رکورد | جدول | ستون | رکورد |
|---|:--:|--:|---|:--:|--:|
| `invoices` | 31 | **3,123** | `weighbridge_records` | 23 | **1,454** |
| `inventory_transactions` | 13 | 3,299 | `logs` | 9 | 3,505 |
| `sync_mutations` | 11 | 1,087 | `drivers` | 8 | 460 |
| `farmers` | 9 | 146 | `products` | 13 | 68 |
| `origins` | 6 | 62 | `formula_items` | 8 | 20 |
| `audit_logs` | 12 | 13 | `inventory_adjustments` | 9 | 8 |
| `sessions` | 7 | 3 | `users` | 12 | **2** |
| `batches` | 13 | 1 | `formulas` | 8 | 1 |
| `production_records` | 10 | 1 | `settings` | 3 | 1 |
| `otp_codes` | 6 | **0** | `device_tokens` | 5 | **0** |
| `delivery_proofs` | 10 | **0** | `farmer_orders` | 9 | **0** |
| `product_categories` | 6 | 0 | `warehouses` | 9 | 0 |

### ۵-۱. سه عدد حیاتی برای طراحی موبایل

| سنجه | مقدار در `nir_dev` | پیامد |
|---|--:|---|
| `farmers` با شماره تلفن | **۰ از ۱۴۶** | ورود مرغدار با OTP **امکان‌پذیر نیست** (هویت با `phone` حل می‌شود) |
| `users` با نقش `DRIVER`/`FARMER` | **۰ از ۲** (فقط ADMIN + VIEWER) | هیچ حساب موبایلی وجود ندارد؛ `users.driver_id`/`farmer_id`/`phone` همه NULL |
| `weighbridge_records` متصل به حواله (`mapped_remittance_id`) | **۳ از ۱,۴۵۴** | پنل «وزن باسکول» در اپ راننده تقریباً همیشه خالی می‌ماند |
| `invoices` با نام راننده / با تلفن راننده | 3,087 / 316 | اتصال بار به راننده **با نام رشته‌ای** است، نه کلید خارجی |
| نام‌های راننده‌ی حواله‌ها که ردیف متناظر در `drivers` دارند | **403 از 474 (~۸۵٪)** | ~۱۵٪ رانندگان بارهایشان را در اپ **نمی‌بینند** |
| `weighbridge_records` با دو توزین معتبر | 851 از 1,454 | ۶۰۳ قبض هنوز «خالص‌نشده» است (منطق درست سرور) |

**تطبیق قبض باسکول با بار راننده** (`server/routes/mobile.ts:205-215`) فقط از راه `weighbridge_records.mapped_remittance_id ∈ invoiceIds` انجام می‌شود؛ یعنی تا قبض در وب «map» نشود، راننده هیچ وزنی نمی‌بیند.

### ۵-۲. پرچم‌های مهم محیط dev (`C:\Servers\NIR\dev\.env`)

| کلید | مقدار | اثر بر موبایل |
|---|---|---|
| `NODE_ENV` | **production** | `debugCode` در پاسخ OTP برنمی‌گردد (`mobileAuth.ts:43`) |
| `KAVENEGAR_API_KEY`/`SMS_API_KEY` | تنظیم نشده | OTP فقط در لاگ کنسول سرور چاپ می‌شود (`smsService.ts:69-71`) |
| `PORT` / `HOST` | 3001 / 127.0.0.1 | ایزوله از prod (3000) ✅ |
| `PG_BIN` | `C:\Servers\PostgreSQL\bin` | مسیر درست در dev (در prod اشتباه است) |
| `WEIGHBRIDGE_SYNC_ENABLED` | true | سینک با `WeightTable` فعال |
| `GEMINI_API_KEY` | خالی | `/api/extract` روی dev کار نمی‌کند |

> ⚠️ **دو اثر مستقیم:** (۱) امروز ورود OTP روی dev نه پیامک می‌شود و نه کد را برمی‌گرداند → تست end-to-end ورود راننده/مرغدار **بلاک** است. (۲) `minAppVersion`/`currentAppVersion` روی dev هر دو `1.0.0` هستند در حالی که APK dev نسخه‌ی `1.0.2 (versionCode 4)` است.

---

## ۶. تحلیل شکاف (Gap Analysis) — با شاهد کد و داده

### 🔴 G-1 · داده‌ی ماک به‌جای خطا در محیط واقعی (بحرانی)
`nir-mobile/src/api/client.ts:150-162` روی هر خطای شبکه/`ERR_NETWORK`/`ECONNREFUSED`/`404` برای هر مسیر شامل `/api/mobile/` پاسخ **ماک** برمی‌گرداند و `204/200` جعلی می‌سازد. `handleMockRoute` ۱۴ مسیر را می‌پوشاند. یعنی: قطعی سرور = «اپ کار می‌کند» با اعداد ساختگی؛ و هر مسیر اشتباه (۴۰۴) هم با ماک پنهان می‌شود.
**اقدام فاز ۱:** fallback فقط با `__DEV__`/`EXPO_PUBLIC_ALLOW_MOCK=1` و هرگز روی `dev.artadan.ir`/`app.artadan.ir`.

### 🔴 G-2 · ورود آفلاین و اعتبارنامه هاردکد (بحرانی أمنیتی)
- `nir-mobile/src/contexts/AuthContext.tsx:237-246`: با هر خطای شبکه، `admin/admin123` (یا `admin`, `123456`) کاربر را به‌عنوان **MANAGER** وارد می‌کند.
- `LoginScreen.tsx:32,253`: رمز به‌صورت پیش‌فرض `admin123` در فرم و در متن راهنما.
- `LoginScreen.tsx:158-182`: سه دکمه «دسترسی سریع آفلاین» برای DRIVER/FARMER/MANAGER بدون هیچ احراز هویت.
**اقدام فاز ۱:** حذف کامل در مسیرهای غیر-dev؛ در dev فقط با پرچم صریح بیلد و برچسب بزرگ «حالت توسعه».

### 🔴 G-3 · مسیر اشتباه رسید تحویل راننده (قطعی)
کلاینت: `POST /api/mobile/driver/proof` (`DeliveryProofScreen.tsx:88,100,111`) — سرور فقط `POST /api/mobile/driver/delivery-receipt` دارد (`mobile.ts:284`). نتیجه: ۴۰۴ → می‌افتد در تله‌ی G-1 و «موفق» گزارش می‌شود، اما **هیچ رسیدی در دیتابیس ثبت نمی‌شود** (`delivery_proofs` = ۰).
**اقدام فاز ۲:** یکسان‌سازی مسیر + حذف وابستگی ماک + تست یکپارچه روی dev.

### 🔴 G-4 · کارتابل تأییدها روی سرور وجود ندارد (قطعی)
`ApprovalsScreen.tsx` این‌ها را صدا می‌زند: `GET /api/mobile/manager/orders`، `GET /api/mobile/manager/proofs`، `PATCH /api/mobile/manager/orders/:id`. هیچ‌کدام در `mobile.ts` نیستند (فقط `kpi` و `weighbridge`).
**اقدام فاز ۴:** پیاده‌سازی سه اندپوینت + منطق approve/reject روی `farmer_orders.status` و بازبینی `delivery_proofs`.

### 🟠 G-5 · ثبت توکن نوتیفیکیشن به مسیر غلط می‌رود
`notificationService.ts:45,91` روی `'/mobile/device-token'` پست می‌کند؛ با `baseURL` بدون `/api` نتیجه `https://host/mobile/device-token` → ۴۰۴ → ماک. مسیر صحیح `/api/mobile/device-token` است (`device_tokens` = ۰). به‌علاوه توکن شبیه‌سازی‌شده (`sim-dev-token-…`) هم ثبت می‌شود و روی `app.json` هیچ `googleServicesFile`/کلید FCM وجود ندارد → پوش واقعی امروز کار نمی‌کند.

### 🟠 G-6 · ورود نقش راننده/مرغدار در dev عملاً بلاک است
- `NODE_ENV=production` روی dev ⇒ `debugCode` در پاسخ OTP نیست (`mobileAuth.ts:43`) و کلید پیامک هم تنظیم نشده ⇒ کد فقط در **لاگ کنسول سرور** چاپ می‌شود.
- `LoginScreen.tsx:58`: در نبود `debugCode` مقدار `'123456'` را پیش‌فرض می‌گذارد که با کد واقعی DB نمی‌خواند ⇒ پیام «کد نامعتبر».
- `farmers.phone` = ۰ از ۱۴۶ و `users.role ∈ {DRIVER,FARMER}` = ۰ ⇒ حتی با کد درست، هویت مرغدار حل نمی‌شود.
**اقدام فاز ۱ (پیش‌شرط سخت):** یا `NODE_ENV=development` روی dev + نمایش کد در پاسخ/لاگ، یا افزودن فلگ اختصاصی `MOBILE_OTP_DEBUG=true` فقط در dev؛ + seed کاربران تستی راننده/مرغدار و شماره‌گذاری مرغداران (حداقل ۵ مرغدار نمونه).

### 🟠 G-7 · اتصال بار به راننده با «نام رشته‌ای» است، نه کلید
`mobile.ts:174-187`: بارهای راننده با `invoices.driver_name = drivers.name` یا `driver_phone` پیدا می‌شود. داده: ۴۷۴ نام متمایز که ۴۰۳ مورد به یک ردیف `drivers` می‌چسبد (**~۱۵٪ ناموفق**)، و فقط ۳۱۶ از ۳,۰۸۷ حواله تلفن راننده دارند. تشابه اسمی/فاصله‌ی عربی‑فارسی/القاب این اتصال را شکننده می‌کند.
**اقدام فاز ۲:** افزودن `invoices.driver_id` (کلید خارجی) با مهاجرت additive + backfill با نرمال‌سازی `shared/persianText.ts`، و اولویت‌دادن به `driver_id` در کوئری‌ها.

### 🟠 G-8 · گردش کار وضعیت بار راننده وجود ندارد
سرور فقط `delivered` / `in_transit` را از «وجود POD» می‌سازد (`mobile.ts:242`). وضعیت‌های درخواستی شما (رسیدم مبدأ، بارگیری شد، رسیدم مقصد، تخلیه شد) نه ستون دارند و نه اندپوینت. `invoices.status` وجود دارد (متن) ولی در این گردش کار استفاده نمی‌شود.
**اقدام فاز ۲:** ستون `driver_status` (+`driver_status_at`) روی `invoices` + `POST /api/mobile/driver/loads/:id/status` با اعتبارسنجی ترتیب انتقال‌ها + نمایش تایم‌لاین در اپ مدیر.

### 🟠 G-9 · چرخه‌ی سفارش مرغدار نیمه‌کاره است
`POST /api/mobile/farmer/orders` سفارش را با `status='pending'` می‌سازد، اما: فهرست سفارش‌های خود مرغدار (`GET`)، تغییر وضعیت (approve/reject/complete)، و اتصال سفارش تأییدشده به حواله‌ی واقعی **وجود ندارد**. `farmer_orders` = ۰ رکورد. مرغدار در اپ فقط یک «فرم ثبت» دارد و بازخوردی نمی‌بیند.

### 🟠 G-10 · پوشش تطبیق باسکول↔حواله تقریباً صفر است
فقط **۳ از ۱٤۵۴** قبض `mapped_remittance_id` دارند؛ در نتیجه پنل وزن/قبض در اپ راننده و مرغدار عملاً خالی است، در حالی که ۸۵۱ قبض دو توزین کامل دارند (یعنی داده موجود است، فقط وصل نیست). علاوه بر این، اندپوینت تطبیق خودکار/کاندید برای موبایل وجود ندارد و `create-remittance` هم فقط مدیر وب است.
**اقدام فاز ۲/۴:** افزودن «کاندیدهای قبض برای این بار» در اپ راننده (خواندنی) و دکمه تأیید تطبیق برای مدیر با همان منطق وب.

### 🟡 G-11 · پیش‌فرض آدرس سرور روی کد، production است
`api/client.ts:20`: `DEFAULT_API_URL = EXPO_PUBLIC_API_URL || 'https://app.artadan.ir'`. پروفایل dev این مقدار را تزریق می‌کند (✅ درست است)، اما اگر متغیر جا بیفتد، اپ dev به prod وصل می‌شود. به‌علاوه `MoreMenuScreen` امکان تغییر آدرس سرور را به کاربر می‌دهد (`setApiBaseUrl`) — در بیلد عملیاتی باید قفل/مخفی شود و تطبیق دامنه با `extra.appVariant` اعتبارسنجی شود.

### 🟡 G-12 · نبود idempotency در مسیرهای موبایل
`executeIdempotentOperation` فقط در `invoices.ts` استفاده می‌شود؛ `delivery-receipt` و `farmer/orders` کلید idempotency نمی‌پذیرند و `delivery_proofs` هیچ قید یگانگی روی `invoice_id` ندارد (فقط ایندکس). با صف آفلاین (که retry دارد) امکان **ثبت تکراری رسید/سفارش** وجود دارد.

### 🟡 G-13 · نسخه‌بندی اجباری به‌روزرسانی ناهمگون است
`/api/mobile/meta` مقادیر `MIN_MOBILE_APP_VERSION`/`CURRENT_MOBILE_APP_VERSION` را از env می‌خواند؛ روی dev هر دو `1.0.0` است و در کد کلاینت هیچ‌جا **جلوی اجرای نسخه قدیمی گرفته نمی‌شود** (فقط برگردانده می‌شود). APK فعلی `1.0.2 (versionCode 4)` است.

### 🟡 G-14 · امنیت OTP
کد ۶رقمی به‌صورت **متن ساده** در `otp_codes` است، شمارنده‌ی تلاش ناموفق ندارد (فقط rate-limit عمومی گروهی)، محدودیت درخواست مجدد برای یک شماره (cooldown) ندارد و کار پاک‌سازی رکوردهای منقضی دیده نمی‌شود.

### 🟡 G-15 · شکاف پوشش تست روی مسیرهای واقعی
`tests/mobileApi.test.ts` ده سنجه را می‌پوشاند (meta، OTP، refresh، loads، login مدیر، kpi، device-token) اما: POD، سفارش مرغدار، بارهای مرغدار، مانیتور باسکول و سه اندپوینت کارتابل تست ندارند. تست‌های `nir-mobile/tests/*` صرفاً واحدی‌اند و هیچ‌کدام به dev واقعی وصل نمی‌شوند.

### 🟡 G-16 · سقف‌ها و برش‌های نادرست
`driver/loads` حداکثر ۱۰۰ حواله برمی‌گرداند و «تحویل‌شده» را از وجود POD می‌سازد؛ برای راننده‌ی پرکار (۳٬۱۲۳ حواله در dev) تاریخچه ناقص می‌شود. `manager/weighbridge` حداکثر ۱۰۰ قبض.

---

## ۷. ساختار پوشه‌ی پیشنهادی (بر پایه‌ی همین مخزن، نه از صفر)

اپ **یکتا با سه حالت نقش** (تصمیم قبلی خودتان و همان چیزی که کد امروز پیاده کرده)؛ مخزن فعلی monorepo سبک است: وب در ریشه، موبایل در `nir-mobile/`.

```
nir-mobile/
├─ App.tsx                       # Providers، ErrorBoundary، فونت، bootstrap صف آفلاین
├─ app.config.js / app.json      # حالت dev|prod (package/name/api)      [موجود ✅]
├─ eas.json                      # پروفایل‌های بیلد dev/preview/prod    [موجود ✅]
├─ src/
│  ├─ api/
│  │  ├─ client.ts               # axios + Bearer + صف refresh ۴۰۱       [بازنویسی: حذف ماک]
│  │  ├─ endpoints.ts            # ★جدید: تنها منبع حقیقت مسیرهای API (بدون رشته‌ی جادویی)
│  │  └─ types.ts                # ★جدید: قرارداد پاسخ/درخواست (مشترک با server)
│  ├─ contexts/AuthContext.tsx   # ★پاک‌سازی: حذف اعتبارنامه هاردکد و ورود آفلاین
│  ├─ navigation/                # RootNavigator → Auth|Driver|Farmer|Manager
│  │  └─ {Auth,Driver,Farmer,Manager}Navigator.tsx
│  ├─ screens/
│  │  ├─ auth/                   # LoginScreen, OtpVerifyScreen
│  │  ├─ driver/                 # DriverLoads, LoadDetail, DeliveryProof
│  │  │                          # ★افزودن: StatusTimelineScreen (رسیدم مبدأ/…/تخلیه)
│  │  ├─ farmer/                 # FarmerDashboard, FarmerInvoices, OrderFeedModal
│  │  │                          # ★افزودن: MyOrdersScreen (وضعیت سفارش‌ها)
│  │  ├─ operator/               # ★جدید: ورود سریع حواله/توزین برای اپراتور باسکول
│  │  └─ manager/                # Kpi, Remittances, Weighbridge, Inventory,
│  │                             #   Approvals, FarmersDirectory, MoreMenu
│  │                             # ★افزودن: ReportsScreen, ProductionScreen, SettingsScreen
│  ├─ features/                  # ★جدید: منطق دامنه‌ی هر نقش (hooks + query keys)
│  │  ├─ driver/{useLoads,useStatusTransition,usePodSubmit}.ts
│  │  ├─ farmer/{useDashboard,useInvoices,useOrders}.ts
│  │  └─ manager/{useKpi,useWeighbridge,useApprovals}.ts
│  ├─ services/                  # secureStore, offlineQueue (MMKV), notificationService
│  │  └─ mockDataService.ts      # ★فقط dev؛ خارج از باندل تولید
│  ├─ components/
│  │  ├─ common/                 # MetricCard, StatusBadge, ScreenContainer, EmptyState
│  │  ├─ data/                   # ★جدید: DataCard/FilterSheet/InfiniteList (جای جداول وب)
│  │  └─ hardware/               # ImagePickerAction, SignaturePad, (★) BarcodeScanner
│  ├─ hooks/                     # useAuth, useNetworkStatus, useOfflineQueue
│  ├─ utils/                     # jalali, persianText, formatters, ★validators
│  └─ types/                     # auth, offline, ★invoice, ★weighbridge, ★order
└─ tests/                        # ★افزودن: integration/ مقابل dev.artadan.ir
```
**سرور (افزوده‌ها):** `server/routes/mobile.ts` (تکمیل‌شده) + `server/routes/mobileManager.ts` (کارتابل) + `migrations/0005_driver_status_and_link.sql`.

**قواعد UX که در کد رعایت شود:** RTL کامل (`flexDirection: 'row-reverse'` مثل `MoreMenuScreen`)، فونت وزیرمتن (بارگذاری‌شده در `App.tsx`)، تاریخ شمسی از `utils/jalali.ts` (هم‌راستا با `shared/jalali.ts` سرور)، و **ممنوعیت جدول**: هر داده‌ی جدولی وب → کارت قابل Expand + فیلتر Bottom‑Sheet + لیست بی‌نهایت.

---

## ۸. برنامه‌ی اجرایی فازبندی‌شده (با پیش‌شرط و معیار پذیرش)

### فاز ۱ — پایه، احراز هویت، ایمن‌سازی و قابلیت تست روی dev
**کارها:** (۱) حذف/دروازه‌بندی fallback ماک و ورود آفلاین و اعتبارنامه هاردکد (G-1، G-2)؛ (۲) `api/endpoints.ts` به‌عنوان منبع واحد مسیرها + اصلاح مسیرها (G-3، G-5)؛ (۳) رفع بلاک OTP روی dev (G-6): فلگ `MOBILE_OTP_DEBUG` فقط در dev یا `NODE_ENV=development` + نمایش کد در پاسخ؛ (۴) seed کاربران تستی `DRIVER`/`FARMER` و اتصال `users.driver_id`/`farmer_id`؛ (۵) شماره‌گذاری نمونه‌ی مرغداران؛ (۶) اعتبارسنجی `extra.appVariant` ↔ دامنه در استارت اپ.
**معیار پذیرش:** روی گوشی، ورود OTP راننده و مرغدار **بدون داده ماک** موفق شود و `delivery_proofs`/`farmer_orders` در `nir_dev` صفر بماند تا زمانی که عملیات واقعی انجام شود.

### فاز ۲ — راننده (کم‌پیچیده‌ترین UI، بیشترین ارزش میدانی)
**کارها:** گردش کار وضعیت‌ها (G-8) + اتصال کلیدی راننده↔حواله (G-7 با backfill) + ثبت رسید تحویل سالم (G-3) + idempotency (G-12) + نمایش قبض باسکول/کاندیدها (G-10) + تاریخچه‌ی صفحه‌بندی‌شده (G-16).
**معیار پذیرش:** یک سفر کامل روی dev: تخصیص بار → رسیدم مبدأ → بارگیری → رسیدم مقصد → تخلیه → رسید با عکس/امضا/GPS؛ همه در DB با ترتیب صحیح و بدون تکرار در حالت آفلاین.

### فاز ۳ — مرغدار و اپراتور باسکول
**مرغدار:** چرخه‌ی کامل سفارش (GET + وضعیت) (G-9)، مغایرت وزن، صورتحساب/مانده.
**اپراتور:** صفحه‌ی ورود سریع حواله + مشاهده‌ی قبض باسکول ورود/خروج (نقش `OPERATOR` امروز در `requireRole` هست ولی هیچ صفحه‌ای ندارد).

### فاز ۴ — مدیر و گزارش‌گیری
**کارها:** سه اندپوینت کارتابل (G-4)، map/unmap جهت قبض، ساخت حواله از قبض، گزارش‌های نموداری (روی `/api/reports/summary` و `/api/weighbridge/report/daily`)، تولید/انبار (ثبت)، تنظیمات (فقط خواندن)، ردپای کاربران.
**معیار پذیرش:** مدیر بتواند بدون وب، تأیید سفارش، تأیید رسید، و مشاهده‌ی گزارش روز را انجام دهد.

### فاز ۵ — اعلان، نسخه‌بندی، انتشار
FCM واقعی (`googleServicesFile` + کلید روی EAS)، اجرای اجباری `minAppVersion` (G-13)، سخت‌سازی OTP (G-14: هش کد، شمارش تلاش، cooldown)، پایلوت APK و سپس AAB.

### پیش‌شرط‌های مسدودکننده که **باید** قبل از فاز ۱ حل شوند
1. تصمیم درباره‌ی مکانیزم OTP در dev (فلگ debug یا NODE_ENV=development یا کلید پیامک واقعی).
2. اجازه‌ی افزودن داده‌ی آزمون به `nir_dev` (کاربر راننده/مرغدار، شماره‌ی مرغداران نمونه، `invoices.driver_id`) — **روی prod هیچ تغییری داده نمی‌شود**.
3. تصمیم درباره‌ی سرنوشت بیلدهای قبلی که به prod وصل می‌شدند (`preview`/`production-apk` در `eas.json` امروز `APP_VARIANT=dev`/`dev.artadan.ir` دارند → برای بیلد عملیاتی فردا باید صریح تفکیک شوند).

---

## ۹. تصمیم‌های مورد نیاز اپراتور (پیش از فاز ۱)

| # | تصمیم | پیشنهاد من |
|---|---|---|
| ۱ | مکانیزم تست OTP روی dev | افزودن `MOBILE_OTP_DEBUG=true` **فقط** در `C:\Servers\NIR\dev\.env` (بدون لمس prod) |
| ۲ | دسترسی به داده‌ی آزمون در `nir_dev` | مجاز: ساخت ۲ کاربر تستی (۱ راننده، ۱ مرغدار) + شماره برای ۵ مرغدار نمونه |
| ۳ | مهاجرت `invoices.driver_id` | انجام با مهاجرت additive + backfill نام‌محور (بدون حذف ستون `driver_name`) |
| ۴ | حذف mock/offline-login | حذف کامل از بیلدهای `dev`/`production`؛ نگه‌داشتن فقط برای `development` |
| ۵ | اپراتور باسکول در موبایل | تأیید افزودن نقش/صفحه‌ی اپراتور در فاز ۳ |
| ۶ | آدرس پیش‌فرض بیلدعملیاتی | `production*` باید `APP_VARIANT=production` داشته باشد (اکنون دارد ✅) — تأیید سیاست: هیچ بیلد عملیاتی تا پایان فاز ۴ ساخته نشود |

---

## ۱۰. کارهایی که در این فاز انجام **نشد** (شفافیت)

- هیچ تغییری در کد بک‌اند، کلاینت، دیتابیس، nginx یا prod داده نشد. تنها فایل‌های افزوده‌شده در این فاز: این سند + سه اسکریپت **فقط-خواندن** بازرسی (`psremoting/inspect-dev-db*.ps1`, `psremoting/_dev-db-query*.ps1`).
- هیچ مهاجرت/seed اجرا نشد؛ هیچ کاربری ساخته نشد؛ هیچ رکوردی در `nir_dev` نوشته نشد.
- تست‌های موجود اجرا و وضعیت آن‌ها گزارش شد؛ اما هیچ تست جدیدی در این فاز نوشته نشد (طبق تعریف فاز ۰).

**اعتبارسنجی انجام‌شده در همین فاز (برای اطمینان از پایداری پایه):**

| مجموعه تست | نتیجه | جزئیات |
|---|---|---|
| `npm test` (ریشه، بک‌اند/شبکه) | ✅ **۱۰ suite / ۱۰۰ تست / ۰ خطا** | `tests/*.test.ts` — خروجی کامل: `logs/repo-tests-phase0.txt` |
| `npm test` در `nir-mobile` | ✅ **۸ suite / ۳۸ تست / ۰ خطا** | خروجی کامل: `logs/mobile-tests.txt` |
| بازرسی زنده‌ی dev | ✅ 200 روی `/api/health` و `/api/mobile/meta` | دو محیط dev و prod مستقل پاسخ می‌دهند |
| بازرسی فقط-خواندن DB | ✅ `nir_dev` (۲۴ جدول) | خروجی: `logs/inspect-dev-db3.txt` و `logs/probe2.txt` |

**آماده‌ی تأیید شما برای ورود به فاز ۱.**
