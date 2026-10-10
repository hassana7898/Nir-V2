# مرجع API

پایه: `/api` · احراز هویت: **کوکی HttpOnly (JWT)** برای همه‌ی مسیرها به‌جز `/api/auth/*`
سیاست‌ها: `requireAuth` برای همه · `blockViewerWrites` (نقش VIEWER فقط خواندن) · نوشتن‌های حساس `requireRole('ADMIN'|'MANAGER')` · محدودسازی نرخ روی `/api/auth/*` و سایر مسیرها.

## احراز هویت — `/api/auth`

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/status` | آیا سامانه راه‌اندازی شده؟ (برای صفحه Setup) |
| POST | `/setup` | ساخت نخستین کاربر مدیر |
| POST | `/login` | ورود (نام کاربری یا شناسه‌ی کوتاه + رمز؛ پشتیبانی ۲FA) |
| GET | `/me` | کاربر جاری + نقش |
| POST | `/logout` | خروج و ابطال نشست |
| GET | `/2fa/status` · POST `/2fa/generate` · POST `/2fa/verify` · POST `/2fa/disable` | مدیریت ورود دو مرحله‌ای (TOTP + QR) |
| POST | `/change-password` | تغییر رمز |

## حواله‌ها — `/api/invoices`

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/` | لیست حواله‌ها (فیلتر نوع/تاریخ/محصول/مرغدار/جستجو) |
| POST | `/` | ایجاد حواله (`type`: `entry`/`exit`) — اثر انبار/بچ/مرغدار در یک تراکنش |
| PUT | `/:id` | ویرایش حواله |
| DELETE | `/:id` | حذف (نرم) |
| PUT | `/order` | ذخیره‌ی ترتیب دستی حواله‌ها |
| POST | `/bulk-move` | جابه‌جایی گروهی بین تاریخ‌ها/انبارها |

## انبار — `/api/inventory` · تولید — `/api/production` · فرمول — `/api/formulas`

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/api/inventory/status` | موجودی زنده (`?until=YYYY-MM-DD`) |
| GET | `/api/inventory/transactions` | تراکنش‌ها |
| POST | `/api/inventory/adjust` | اصلاح موجودی |
| GET/POST/DELETE | `/api/production` | ثبت و حذف تولید |
| GET/POST/PUT/DELETE | `/api/formulas` | فرمول‌ها و اقلام |

## مرغداران / رانندگان / مبدأها

| متد | مسیر | توضیح |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/farmers` | مرغداران |
| POST | `/api/farmers/merge` | **ادغام دو مرغدار** (انتقال حواله‌ها/دوره‌ها + audit) |
| POST | `/api/farmers/:id/adopt-invoices` | **انتساب حواله‌های بی‌صاحب** به مرغدار |
| DELETE | `/api/farmers/:id/broods/:broodId` · PUT `.../restore` | حذف/بازگردانی دوره |
| GET/POST/DELETE | `/api/drivers`, `/api/origins` | رانندگان و مبدأها |

## گزارش‌ها / ردپا / تنظیمات / همگام‌سازی

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/api/reports/summary` | داشبورد و روند روزانه |
| GET | `/api/audit` | ردپای کاربران (فیلتر کاربر/موجودیت/تاریخ) |
| GET/PUT | `/api/settings` | تنظیمات (نام کارخانه، منوها، محصول پیش‌فرض) |
| GET | `/api/sync/state` | وضعیت کامل داده برای کش کلاینت |
| POST | `/api/sync` | پخش صف تغییرات آفلاین |
| POST/GET | `/api/uploads` | آپلود و دریافت فایل |
| GET/POST/PATCH/DELETE | `/api/users` | مدیریت کاربران (ADMIN) |
| POST/GET | `/api/backup` … | بکاپ/بازیابی دیتابیس |

## باسکول — `/api/weighbridge`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/records` | همه | لیست قبوض با فیلتر: `from`,`to` (ISO تاریخ توزین)، `plate`، `status`، **`net`** (`all`\|`done` خالص‌شده \|`pending`)، `q` (سریال/شماره حواله/پلاک/راننده/**مشتری**)، `limit`/`offset` — همراه `counts` (کل/تخصیص‌نیافته/تخصیص‌یافته/خالص‌شده/ناخالص) و برای هر ردیف: `direction`, `directionLabel`, `customerName`, `goods`, `invoice` (حواله‌ی متصل + `customerName`)، `existingInvoice` (حواله‌ی **ثبت‌شده‌ی مطابق** در بازهٔ ±۳ روز)، `weightDelta`، `existingTypeMismatch` |
| GET | `/stats` | همه | شمارنده‌ها، آخرین سینک، جدیدترین توزین، وجود باندل ورکر |
| GET | `/records/:id` | همه | جزئیات قبض + حواله‌ی متصل/ثبت‌شده |
| GET | `/records/:id/candidates` | همه | حواله‌های کاندید در بازهٔ روزها (`type`, `days`, `q`) |
| POST | `/records/:id/map` | ADMIN/MANAGER | اتصال قبض به حواله + نوشتن وزن خالص روی آن |
| POST | `/records/:id/unmap` | ADMIN/MANAGER | لغو اتصال (بازگردانی وزن اگر دستی تغییر نکرده باشد) |
| POST | `/records/:id/create-remittance` | ADMIN/MANAGER | **ایجاد حواله از قبض** (ورود/خروج) + اتصال، در یک تراکنش |
| PATCH | `/records/:id/direction` | ADMIN/MANAGER | **ویرایش دستی نوع** (قفل‌شده در برابر سینک) |
| POST | `/sync` | ADMIN/MANAGER | اجرای فوری ورکر و بازگرداندن لاگ (مهلت ۹۰ ثانیه) |

### قواعد پاسخ باسکول
- `direction`: حواله‌ی ثبت‌شده > ویرایش دستی > پرچم «ورودی» باسکول > خالص‌شده‌ی بی‌پرچم = `exit`.
- `existingInvoice`: تطبیق با شماره حواله **و/یا** وزن خالص دقیق، فقط داخل **±۳ روز** از توزین، با ترجیح هم‌نوعی و نزدیک‌ترین تاریخ.
- `weightDelta`: وزن ستون حواله (`scale_weight` برای خرید، `weight` برای فروش) منهای وزن خالص باسکول.
