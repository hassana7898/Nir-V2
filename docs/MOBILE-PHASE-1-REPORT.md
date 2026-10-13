# گزارش فاز ۱ — اصلاحات زیرساختی، Auth و Navigation (NIR Mobile)

**تاریخ اجرا:** ۱۴۰۵/۰۷/۲۱ (2026-10-13) · **محیط‌های لمس‌شده:** `nir_dev` + `C:\Servers\NIR\dev` + کد مخزن · **prod: صفر تغییر (اثبات هش در ادامه)**

فاز ۱ در چهار گامِ تأییدشده‌ی شما اجرا و در پایان روی **dev واقعی** اعتبارسنجی شد: ۲۲ بررسی زنده (پایان‌به‌پایان از طریق API مستقر روی `dev.artadan.ir`) بدون هیچ خطا.

---

## ۱. خلاصه اجرایی

| # | کار | وضعیت | شاهد |
|---|---|---|---|
| ۱ | مهاجرت `invoices.driver_id` + Backfill نام‌محور روی `nir_dev` | ✅ | ۳٬۱۲۳ حواله، **۲٬۸۵۵** دارای FK (پیش‌تر ۰) |
| ۲ | داده‌ی تستی: ۱ راننده + ۱ مرغدار + ۵ شماره‌ی نمونه | ✅ | کاربر `09120000001` (۵۲۶ بار) و `09120000002` (۱۳۶ حواله) |
| ۳ | فلگ OTP فقط در `.env` محیط dev | ✅ | `MOBILE_OTP_DEBUG=true` + `NIR_ENV=dev`؛ prod هر دو را ندارد |
| ۴ | حذف کامل Mock/Fake login از کلاینت | ✅ | `mockDataService.ts` حذف شد؛ تست نگهبان جدید |
| ۵ | حذف داده‌ی جعلی دیگر (امضا، عکس، GPS، هویت مدیر) | ✅ | `SignaturePadModal`، `ImagePickerAction`، `DeliveryProofScreen`، `MoreMenuScreen` |
| ۶ | تک‌منبع‌حقیقت مسیرهای API (`api/endpoints.ts`) | ✅ | هیچ رشته‌ی `'/api/…'` در `screens/` و `services/` نمانده (تست خودکار) |
| ۷ | اصلاح مسیر و **قرارداد payload** رسید تحویل (POD) | ✅ | `invoice_id` + `photo_bill/photo_scale/signature` یا `*_base64` |
| ۸ | ساخت ۳ اندپوینت کارتابل مدیر | ✅ | `GET /manager/orders`، `PATCH /manager/orders/:id`، `GET /manager/proofs` |
| ۹ | Idempotency رسید تحویل + اصلاح FK خراب `driver_id` | ✅ | ارسال دوم → `alreadyRegistered: true` |
| ۱۰ | Auth واقعی + مسیریابی نقش + ذخیره‌ی توکن | ✅ | ۱۸ تست واحد/یکپارچه + بررسی زنده |

---

## ۲. گام اول — پایگاه‌داده و متغیرهای محیطی (فقط dev)

### ۲-۱. مهاجرت `migrations/0005_mobile_driver_link.sql`
- `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS driver_id TEXT REFERENCES drivers(id);`
- `CREATE INDEX IF NOT EXISTS idx_invoices_driver_id ON invoices(driver_id);`
- ستون متنی `driver_name` **حفظ شد** (سازگاری عقب‌رو: وب، worker باسکول، ایمپورت‌های قدیمی).
- همان DDL در `server/db/migrate.ts` (نصب تازه) و `server/db/schema.ts` (Drizzle) و همچنین در `runtimeDdl` تست `farmerMerge` (pglite) آینه شد.
- روی دیتابیس **محلی** (`nir`، 127.0.0.1) هم اجرا شد تا تست‌های ریشه/`mobileApi` با ستون جدید کار کنند.

### ۲-۲. Backfill `scripts/backfill-invoice-drivers.sql` (idempotent)
- دو پاس: تطبیق دقیق `btrim(name)`، سپس تطبیق **نرمال‌شده** (ي→ی، ك→ک، ة/ۀ→ه، ZWNJ→فاصله، ادغام فاصله‌ها).
- فقط رکوردهایی که `driver_id IS NULL` هستند؛ نامی که به **بیش از یک** راننده می‌خورد **نادیده** گرفته می‌شود (لینک اشتباه بدتر از بی‌لینکی است).
- نتیجه روی `nir_dev`:

```
invoices total                      | 3123
invoices with driver_id             | 2855   (91.4%)
invoices with driver_name           | 3087
invoices still unmapped (have name) | 232    (66 نام متمایز)
```

۲۳۲ حواله‌ی باقی‌مانده نام‌هایی هستند که **رکورد راننده‌ای متناظر ندارند** (نه اشکال الگوریتم)؛ در فاز ۲ همراه صفحه‌ی «راننده‌های نامطابق» برای مدیر نمایش داده می‌شود.

### ۲-۳. داده‌ی تستی `scripts/dev-seed-mobile-phase1.sql` (فقط `nir_dev`)
- **راننده:** پرکارترین راننده‌ی موجود انتخاب و شماره‌اش `09120000001` شد + کاربر `usr-mobile-test-driver` با `driver_id` معتبر → **۵۲۶ بار** قابل مشاهده برای او (اثبات عملی Backfill).
- **مرغدار:** پرحواله‌ترین مرغدار با `09120000002` + کاربر `usr-mobile-test-farmer` → **۱۳۶ حواله‌ی خروج**.
- **۵ شماره‌ی نمونه** `09121000001…5` روی مرغداران موجود (فقط آن‌هایی که شماره نداشتند).
- کاملاً idempotent (اجرای دوباره هیچ رکورد تکراری نمی‌سازد)، `password_hash` خالی (این حساب‌ها فقط OTP هستند).

### ۲-۴. فلگ OTP توسعه
- `C:\Servers\NIR\dev\.env`: `MOBILE_OTP_DEBUG=true` و `NIR_ENV=dev` (اسکریپت: `psremoting/dev-enable-mobile-otp-debug.ps1`).
- سیاست در `server/services/mobileOtpDebug.ts`: کد فقط وقتی در پاسخ برمی‌گردد که فلگ روشن باشد **و** runtime غیر‌production باشد یا `NIR_ENV=dev` اعلام شده باشد. `C:\Servers\NIR\app\.env` **هیچ‌کدام** را ندارد (اثبات: هش قبل/بعد یکسان و `MOBILE_OTP_DEBUG=False NIR_ENV=False`).
- `.env.example` مخزن هم با توضیح «فقط dev» مستند شد.
- پشتیبان‌ها: `C:\Servers\NIR\dev\backups\.env-20261013-175153` و dump دیتابیس `db-nir_dev-20261013-175058.sql` (۶ مگابایت).


---

## ۳. گام دوم — پاک‌سازی کامل منطق جعلی (`nir-mobile`)

| فایل | تغییر |
|---|---|
| `src/services/mockDataService.ts` | **حذف کامل فایل** (۶۸۲ خط داده‌ی جعلی: `MOCK_USERS`, `handleMockRoute`, کارتابل و KPI ساختگی) |
| `src/api/client.ts` | حذف short-circuit آفلاین، حذف پاسخ جعلی روی **هر خطای شبکه** و روی **HTTP 404**، حذف `setOfflineDemoMode/getOfflineDemoMode`؛ خطاها با هشدار قابل‌مشاهده (`[NIR API] 404 on …`) به caller می‌رسند |
| `src/contexts/AuthContext.tsx` | حذف `loginOffline`، حذف کاربران ماک، حذف fallback `admin/admin123`، حذف fallback «آفلاین» در `requestOtp`/`verifyOtp`؛ session فقط با توکن واقعی + نقش شناخته‌شده معتبر است (`isKnownRole`) |
| `src/screens/auth/LoginScreen.tsx` | حذف کارت «دسترسی سریع آفلاین» و سه دکمه‌ی نقش؛ حذف اعتبارنامه‌های پیش‌پرشده و بج «admin/admin123»؛ حذف کد جعلی `debugCode || '123456'`؛ نمایش **بنر محیط** (`dev.artadan.ir · توسعه · نسخه آزمایشی`) |
| `src/screens/auth/OtpVerifyScreen.tsx` | نمایش واقعی پیام خطای سرور (قبلاً `data.message` خوانده می‌شد و خطاهای سرور نامرئی بودند) |
| `src/services/secureStore.ts` | حذف پرچم آفلاین (`nir_offline_demo_mode`) |
| `src/components/hardware/SignaturePadModal.tsx` | حذف امضای جعلی `mockSignatureBase64String` → پیام خطا |
| `src/components/hardware/ImagePickerAction.tsx` | حذف URIهای جعلی `file:///mock/…` → پیام خطا |
| `src/screens/driver/DeliveryProofScreen.tsx` | حذف **GPS ساختگی تهران** (`35.6892, 51.389`) → `null` |
| `src/screens/manager/MoreMenuScreen.tsx` | حذف هویت جعلی (`مهندس حسینی`، `09129990001`) و سوئیچ آفلاین؛ نمایش `describeApiTarget()` |

### ماژول‌های جدید (و چرا)
- **`src/api/endpoints.ts`** — تنها منبع حقیقت مسیرهای API. علت: دو عدم‌تطابق واقعی (`/driver/proof` در برابر `/driver/delivery-receipt` و `/mobile/device-token` بدون `/api`) توسط موتور ماک پنهان می‌شد.
- **`src/api/errors.ts`** — استخراج یکسان پیام خطای سرور (`error`/`message`) و تشخیص خطای شبکه.
- **`src/utils/envGuard.ts`** — نسخه‌ی dev **نمی‌تواند** به سرور عملیاتی وصل شود و نسخه‌ی عملیاتی به dev (آدرس LAN/VPS سفارشی مجاز می‌ماند). آدرس ذخیره‌شده در هر اجرا بازاعتبارسنجی می‌شود.
- **`src/services/multipartPayload.ts` + `src/features/driver/podPayload.ts`** — قرارداد درست POD و پوشش آفلاین بدون از‌دست‌رفتن عکس‌ها.

### اصلاح قرارداد رسید تحویل (POD) — باگ مهم
کلاینت قبلاً `{ invoiceId, photoBillUrl, photoScaleUrl, signatureUrl }` را به مسیر ناموجود می‌فرستاد؛ سرور `invoice_id` و فیلدهای `photo_bill/photo_scale/signature` یا `*_base64` را می‌خواند. نتیجه‌ی واقعی: ۴۰۴ (پنهان‌شده توسط ماک) و رسیدی **بدون هیچ تصویری**.
اکنون:
- عکس‌های `file://` → `multipart/form-data` (فیلدهای درست)؛ امضای `data:` → JSON base64.
- آفلاین → پوشش JSON‌امن شامل `fields` + `files` که در لحظه‌ی flush به FormData تبدیل می‌شود (عکس‌ها از دست نمی‌روند).
- خطای **سمت سرور** (۴۰۰/۴۰۴/۵۰۰) دیگر در صف آفلاین انداخته نمی‌شود؛ فقط قطعی واقعی شبکه صف می‌شود.

### چرا مسیرهای API در تمام صفحه‌ها جایگزین شد
همه‌ی ۱۱ صفحه‌ی مصرف‌کننده (driver/farmer/manager) به `Endpoints` منتقل شدند و تست نگهبان `tests/noMockFallback.test.ts` هرگونه رشته‌ی سخت‌کد `'/api/…'` بیرون از `endpoints.ts` را **fail** می‌کند.

> نکته‌ی فنی/شفافیت: در اجرای اولِ این بازنویسی، اسکریپت کمکی PowerShell به‌دلیل flatten شدن آرایه‌ی تودرتو (`@( @(a,b) )`) به‌جای جایگزینی مسیرها، هر `/` را با `a` عوض کرد. خرابی **بلافاصله** با `git diff` تشخیص داده شد، ۱۱ فایل با `git checkout` بازگردانی شد و اسکریپت اصلاح‌شده (با assert روی هر جایگزینی + کنترل «تعداد کاراکترهای غیرASCII نباید تغییر کند») دوباره اجرا شد. هیچ اثر باقی‌مانده‌ای نیست (تست نگهبان همین را تضمین می‌کند).

---

## ۴. گام سوم — سرور: مسیرهای اصلاح‌شده و مسیرهای جدید

### ۴-۱. رسید تحویل بار (POD) — `server/routes/mobile.ts`
```ts
router.post('/driver/delivery-receipt', requireAuth, podUploadMiddleware, submitDeliveryReceipt); // مسیر اصلی
router.post('/driver/proof',            requireAuth, podUploadMiddleware, submitDeliveryReceipt); // alias منسوخ
```
سه اصلاح در همان هندلر مشترک:
1. **رفع باگ FK:** قبلاً `driverId = req.user?.driverId || invRows[0].driverName` یعنی **نام متنی داخل ستون FK** نوشته می‌شد. اکنون: `req.user?.driverId || invoice.driverId || null`.
2. **Idempotency:** اگر برای همان حواله رسیدی موجود باشد، همان رکورد برگردانده می‌شود (`alreadyRegistered: true`) — تلاش مجدد بعد از timeout دیگر «تحویل جعلی» نمی‌سازد.
3. **alias منسوخ** برای APKهای ساخته‌شده پیش از فاز ۱ (تا زمانی که APK جدید نصب شود) — با کامنت صریح «استفاده نکنید».

### ۴-۲. بارهای راننده — `server/routes/mobile.ts`
پرس‌وجو حالا **اول** با `invoices.driver_id` (FK) تطبیق می‌دهد و نام/تلفن تنها به‌عنوان شبکه‌ی ایمنی برای رکوردهای مپ‌نشده باقی مانده است:
```ts
or(eq(invoices.driverId, driverRow.id), eq(invoices.driverName, driverName), driverPhone ? … : sql`FALSE`)
```

### ۴-۳. کارتابل مدیر — فایل جدید `server/routes/mobileManager.ts` (mount در `server.ts`)
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/api/mobile/manager/orders` | لیست سفارش‌های جیره با نام مرغدار/محصول، فیلتر `status`، سقف ۲۰۰ |
| PATCH | `/api/mobile/manager/orders/:orderId` | تایید/رد سفارش با اعتبارسنجی وضعیت (۴۰۰ برای مقدار نامعتبر، ۴۰۴ برای سفارش ناموجود) |
| GET | `/api/mobile/manager/proofs` | رسیدهای تحویل با URL کامل تصاویر (`http(s)://…`) و نام راننده/مرغدار |

هر سه با `requireAuth + requireRole('ADMIN','MANAGER')` محافظت می‌شوند (راننده → ۴۰۳). این سه مسیر قبلاً **وجود نداشتند** و موتور ماک کلاینت جوابشان را می‌ساخت.

### ۴-۴. دو اصلاح امنیتی دیگر
- **`/api/mobile/auth/logout`:** علاوه بر توکن هدر، session متصل به `refreshToken` را هم باطل می‌کند. پیش‌تر توکن refresh دزدیده‌شده پس از logout معتبر می‌ماند (توکن دسترسی JWT است، ولی session با توکن اپکِ درون refresh توکن شناسایی می‌شود).
- **`MOBILE_OTP_DEBUG`:** تنها با فلگ dev + گارد `NIR_ENV` (بخش ۲-۴) کد در پاسخ برمی‌گردد و همان‌جا در لاگ سرور هشدار ثبت می‌شود.

---

## ۵. گام چهارم — جریان واقعی Auth، ذخیره‌ی امن توکن و مسیریابی نقش

- **OTP راننده/مرغدار:** `requestOtp` → پیامک (روی dev: `debugCode` در پاسخ) → `verifyOtp` → توکن‌ها در `expo-secure-store` (`nir_access_token`, `nir_refresh_token`, `nir_user_data`) → `MMKV` فقط برای صف آفلاین. هیچ مسیر جانبی برای ورود بدون سرور باقی نمانده است.
- **ورود مدیر:** نام کاربری/رمز + TOTP دومرحله‌ای (پیام خطای واقعی سرور نمایش داده می‌شود).
- **مسیریابی نقش (`RootNavigator`):** نقش ناشناخته‌ی/غایب دیگر به‌طور پیش‌فرض به UI راننده هدایت **نمی‌شود**؛ به `AuthNavigator` برمی‌گردد. `AuthContext` هنگام bootstrap هر session ذخیره‌شده‌ای که توکن واقعی یا نقش شناخته‌شده ندارد را پاک می‌کند (fail-closed).
- **گارد محیط:** نسخه‌ی dev و عملیاتی نمی‌توانند به محیط مقابل وصل شوند؛ آدرس جاری در صفحه‌ی ورود و در «امکانات بیشتر» نمایش داده می‌شود.
- **رفرش توکن:** interceptor ۴۰۱ با صف درخواست‌ها دست‌نخورده ماند؛ در صورت شکست رفرش، session پاک و رویداد `AUTH_EXPIRED` منتشر می‌شود.

---

## ۶. اعتبارسنجی (همه در همین اجرا)

| مجموعه | نتیجه | خروجی |
|---|---|---|
| `npm test` (ریشه، بک‌اند) | ✅ ۱۰ suite / **۱۰۰ تست** / ۰ خطا | `logs/repo-tests-phase1.txt` |
| `npm --prefix nir-mobile test` | ✅ **۱۰ suite / ۵۵ تست** / ۰ خطا (قبلاً ۸/۳۸) | `logs/mobile-tests-phase1.txt` |
| `npx tsx tests/mobileApi.test.ts` (سرور + Postgres واقعی) | ✅ ۱۵ تست از جمله ۶ تست جدید فاز ۱ | `logs/mobile-api-phase1.txt` |
| `npx tsc --noEmit` (ریشه) | ✅ بدون خطای جدید (خطاهای قبلی فقط در `tests/broodSplitProof.ts` و `tools/dev/*`) | — |
| `npm --prefix nir-mobile run typecheck` | ✅ پاک | — |
| **بررسی زنده‌ی dev** (`psremoting/dev-verify-mobile-phase1.ps1`) | ✅ **۲۲ بررسی، ۰ خطا** | `logs/dev-verify-phase1-out.txt` |
| مهاجرت/Backfill/Seed روی `nir_dev` | ✅ هر سه exit=0 | `logs/dev-phase1-db.txt` |
| انتشار dev (`wb-dev-deploy.ps1`) | ✅ هش‌ها مطابق، health=200، **prod دست‌نخورده** | `logs/dev-deploy-phase1-out.txt` |

### تست‌های جدید کلاینت
| فایل | چه چیزی را قفل می‌کند |
|---|---|
| `tests/noMockFallback.test.ts` | ۴۰۴ و خطای شبکه باید reject شوند (نه داده‌ی جعلی)؛ نبود فایل ماک؛ نبود `setOfflineDemoMode`/`loginOffline`/`admin123`/`123456` جعلی؛ **هیچ مسیر `/api/…` سخت‌کدی بیرون از `endpoints.ts`** |
| `tests/environmentGuard.test.ts` | رد کردن اتصال dev→prod و prod→dev، مجاز بودن آدرس LAN/VPS، تشخیص درست host (شامل `host:port` بدون scheme) |
| `tests/podContract.test.ts` | نام فیلدهای POD، انتخاب multipart در برابر JSON، سالم ماندن پوشش آفلاین پس از round-trip و تبدیل درست آن به FormData |

### تست‌های جدید سرور (`tests/mobileApi.test.ts`)
- alias منسوخ `/driver/proof` رسید را ثبت کند و **`driver_id` برابر راننده‌ی احراز‌شده باشد** (قفل رگرسیون باگ نام‌در‌FK)؛
- ارسال دوم → `alreadyRegistered` و فقط **یک** رکورد در دیتابیس؛
- `GET /manager/orders` برای مدیر ۲۰۰ و برای راننده ۴۰۳؛
- `PATCH /manager/orders/:id` → ۴۰۰ برای وضعیت نامعتبر، ۲۰۰ و تغییر واقعی وضعیت؛
- `GET /manager/proofs` رسید ثبت‌شده را نشان دهد و URL تصویر مطلق باشد.

### لاگ بررسی زنده (خلاصه)
```
PASS : OTP request 200 (200) / debugCode returned for the dev flag (debugCode=666584)
PASS : role = DRIVER / driverId linked on the user
PASS : GET /api/mobile/driver/loads 200 (active=100 completed=0)
PASS : canonical POD route exists (404) / deprecated alias route exists (404) / POD requires authentication (401)
PASS : GET /manager/orders = 403 for a driver / /manager/proofs = 403 / PATCH = 403
PASS : farmer OTP verify 200 / role = FARMER / dashboard 200 / invoices 200 (count=136)
PASS : unknown mobile route returns 404 (not fabricated data)
FAILURES: 0  -> ALL PHASE 1 LIVE CHECKS PASSED
```

---

## ۷. فایل‌های تغییریافته/جدید

**سرور و داده**
- جدید: `migrations/0005_mobile_driver_link.sql` · `scripts/backfill-invoice-drivers.sql` · `scripts/dev-seed-mobile-phase1.sql` · `server/services/mobileOtpDebug.ts` · `server/routes/mobileManager.ts`
- تغییر: `server/routes/mobile.ts` (POD + FK + loads) · `server/routes/mobileAuth.ts` (فلگ OTP + logout) · `server/db/schema.ts` · `server/db/migrate.ts` · `server.ts` (mount) · `tests/mobileApi.test.ts` · `tests/farmerMerge.test.ts` · `.env.example`

**کلاینت موبایل**
- جدید: `src/api/endpoints.ts` · `src/api/errors.ts` · `src/utils/envGuard.ts` · `src/services/multipartPayload.ts` · `src/features/driver/podPayload.ts`
- حذف: `src/services/mockDataService.ts` · `tests/offlineDemo.test.ts`
- تغییر: `src/api/client.ts` · `src/contexts/AuthContext.tsx` · `src/navigation/RootNavigator.tsx` · `src/services/{secureStore,notificationService,offlineQueue}.ts` · `src/components/hardware/{SignaturePadModal,ImagePickerAction}.tsx` · `src/screens/auth/{LoginScreen,OtpVerifyScreen}.tsx` · `src/screens/driver/{DeliveryProofScreen,DriverLoadsScreen}.tsx` · `src/screens/farmer/{FarmerDashboardScreen,FarmerInvoicesScreen,OrderFeedModal}.tsx` · `src/screens/manager/{ApprovalsScreen,FarmersDirectoryScreen,InventoryMonitorScreen,ManagerKpiScreen,MoreMenuScreen,RemittancesScreen,WeighbridgeMonitorScreen}.tsx` · `package.json` (اسکریپت تست)

**عملیات**
- جدید: `psremoting/dev-mobile-phase1-db.ps1` · `psremoting/dev-enable-mobile-otp-debug.ps1` · `psremoting/dev-verify-mobile-phase1.ps1` + `psremoting/_dev-verify-mobile-phase1.ps1`
- لاگ‌ها: `logs/dev-phase1-db.txt`, `logs/dev-otp-debug-out.txt`, `logs/build-dev-out.txt`, `logs/dev-deploy-phase1-out.txt`, `logs/dev-verify-phase1-out.txt`, `logs/repo-tests-phase1.txt`, `logs/mobile-tests-phase1.txt`, `logs/mobile-api-phase1.txt`

---

## ۸. ریسک‌ها، محدودیت‌های شناخته‌شده و مرز فاز ۱

1. **APK فعلی روی گوشی باید بازساخته شود.** تغییرات فاز ۱ کلاینت (حذف ماک، OTP واقعی، تاریخچه‌ی نقش‌محور) داخل بیلد نصب‌شده نیست. سیاست انتشار (تصمیم ۶) دست‌نخورده است: **هیچ AAB عملیاتی ساخته نشد**؛ برای تست لاگین فقط یک APK داخلی نسخه‌ی dev لازم است:
   `cd nir-mobile; npx eas build -p android --profile dev`
2. **سقف ۱۰۰ بار در `/driver/loads`** (G-16 فاز ۰) پابرجاست — راننده‌ی تستی ۵۲۶ حواله دارد و فعلاً ۱۰۰ تای اول را می‌بیند. صفحه‌بندی در فاز ۲.
3. **۲۳۲ حواله‌ی مپ‌نشده** (۶۶ نام بدون رکورد راننده) تا زمانی که «مدیریت رانندگان نامطابق» در فاز ۲ ساخته شود باقی می‌مانند؛ این حواله‌ها همچنان با نام/تلفن قدیمی پیدا می‌شوند (شبکه‌ی ایمنی حفظ شد).
4. **نمایش تصاویر POD در کارتابل:** API اکنون URL مطلق می‌دهد؛ اما سرو شدن `/uploads/...` توسط nginx روی dev باید در فاز ۲ تأیید شود (اگر proxy نشود، تصویر بارگذاری نمی‌شود).
5. **گزارش «ارسال پیامک»:** روی dev هیچ کلید پیامکی وجود ندارد؛ کد در لاگ سرور و در پاسخ `debugCode` است. سیاست prod دست‌نخورده (بدون debugCode).
6. **سخت‌سازی OTP** (هش کد، شمارش تلاش ناموفق، cooldown درخواست مجدد) طبق برنامه در فاز ۵ انجام می‌شود (G-14).
7. `.gitignore`/خط‌پایان: فایل‌های جدید با LF و بدون BOM نوشته شدند تا با سایر فایل‌های مخزن یکدست باشند؛ SQLها **صرفاً ASCII** هستند (انتقال امن از WinRM/psql).
8. شکست‌های عمدی: نقش `VIEWER` طبق قبل فقط خواندنی است؛ نقش `OPERATOR` (اپراتور باسکول) طبق تصمیم شما در فاز ۳ صفحه می‌گیرد.

---

## ۹. کارهای انجام‌شده روی VPS (فقط dev)

| مورد | مقدار |
|---|---|
| پشتیبان `.env` | `C:\Servers\NIR\dev\backups\.env-20261013-175153` |
| پشتیبان دیتابیس (پیش از هر تغییر) | `C:\Servers\NIR\dev\backups\db-nir_dev-20261013-175058.sql` (۶٬۰۰۰ KB) |
| پشتیبان انتشار | `C:\Servers\NIR\dev\backups\deploy-dev-20261013-175346` (+ staging در `deploy-tmp`) |
| نسخه‌ی مستقر | `server.cjs` با هش `2A050F22…` (bundle وب بدون تغییر: `index-BA1WgyNk.js`) |
| سلامت dev بعد از انتشار | `GET http://127.0.0.1:3001/api/health` → 200 |
| prod | `.env`، `index.html`، `server.cjs` هش‌ها **بدون تغییر**؛ health 200؛ prod DB (`nir_db`) هرگز باز نشد |

---

## ۱۰. نتیجه و قدم بعدی

فاز ۱ کامل شد: زیرساخت داده (FK راننده↔حواله)، حذف بی‌رحمانه‌ی همه‌ی مسیرهای جعلی، قرارداد درست رسید تحویل، سه اندپوینت کارتابل مدیر، و جریان احراز هویت واقعی با مسیریابی نقش و ذخیره‌ی امن توکن. روی dev **زنده** آزمایش شد و همه‌ی ۲۲ بررسی پایان‌به‌پایان پاس شد.

**اقدام شما:** نصب APK جدید نسخه‌ی dev روی گوشی و تست جریان لاگین:
- راننده: شماره `09120000001` (کد در پاسخ/لاگ dev) → باید «بارهای من» با بارهای واقعی باز شود.
- مرغدار: شماره `09120000002` → داشبورد دوره + ۱۳۶ حواله.
- مدیر: نام کاربری/رمز مدیر کارخانه + کد TOTP؛ ورود بدون رمز و بدون اینترنت **باید ناموفق باشد**.

پس از تأیید شما، فاز ۲ (گردش وضعیت‌های سفر راننده، صفحه‌بندی تاریخچه، idempotency کامل، نمایش قبض باسکول، صفحه‌ی «رانندگان نامطابق») آغاز می‌شود.
