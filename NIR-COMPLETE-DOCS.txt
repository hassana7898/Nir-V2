# NIR — مستندات کامل سامانه (سند یکپارچه)

> نسخه‌ی سند: 2026-10-10 20:08 · مخزن: https://github.com/hassana7898/Nir-V2 · دامنه‌ی عملیاتی: https://app.artadan.ir

این فایل **همه‌ی مستندات نرم‌افزار** را در یک جا جمع می‌کند: معرفی و قابلیت‌ها، معماری، مدل داده، مرجع API، راهنمای استقرار، و نقشه‌ی کامل توسعه‌ی اپلیکیشن‌های اندروید (راننده/مرغدار/مدیر).

## فهرست مطالب

| # | بخش | منبع |
|---|---|---|
| ۱ | معرفی نرم‌افزار، قابلیت‌ها، پشته، ساختار، راه‌اندازی، متغیرها، باسکول، نقش‌ها، رودمپ | `README.md` |
| ۲ | معماری فنی و توپولوژی استقرار | `docs/ARCHITECTURE.md` |
| ۳ | مدل داده (۲۰ جدول و روابط) | `docs/DATABASE.md` |
| ۴ | مرجع کامل API | `docs/API.md` |
| ۵ | راهنمای استقرار و بازگردانی | `docs/DEPLOYMENT.md` |
| ۶ | نقشه‌ی اپ‌های اندروید (راننده/مرغدار/مدیر) | `docs/ANDROID-APPS-PLAN.md` |

---

<a id="part1"></a>

# بخش ۱ — معرفی نرم‌افزار

<!-- source: 

# NIR — سامانه مدیریت حواله و انبار کارخانه (Factory Remittance & Inventory Management)

سامانه‌ی جامع و فارسی (RTL) برای مدیریت **حواله‌های ورود (خرید) و خروج (فروش)**، **انبار و مواد اولیه**، **تولید و فرمولاسیون**، **مرغداران و دوره‌های پرورش**، **ردپای کاربران** و **اتصال کامل به باسکول کارخانه**.

> دامنه‌ی عملیاتی: `https://app.artadan.ir` · محیط آزمایشی: `https://dev.artadan.ir`

---

## ۱. این نرم‌افزار چه می‌کند؟

| حوزه | قابلیت‌ها |
|---|---|
| **حواله ورود (خرید)** | ثبت خرید مواد اولیه با تاریخ شمسی، محصول، فروشنده، مبدأ، بارنامه، وزن باسکول/بارنامه، کرایه حمل، راننده (نام، تلفن، شبا) و اثر آنی روی انبار |
| **حواله خروج (فروش)** | فروش محصول به مرغدار با انتخاب مرغدار/دوره، شماره حواله، وزن و کسر آنی از انبار |
| **انبار** | موجودی زنده، تراکنش‌های انبار، اصلاح موجودی، مواد اولیه/محصول نهایی، دسته‌بندی محصولات، انبار، امکان موجودی منفی |
| **تولید** | ثبت تولید بر اساس فرمول، مصرف خودکار مواد اولیه و ایجاد بچ، فرمول‌ها و اقلام فرمول |
| **مرغداران** | پرونده مرغدار (نام/تلفن)، دوره‌های پرورش، ادغام مرغداران تکراری، انتساب حواله‌های بی‌صاحب، تعمیر داده |
| **گزارش‌ها** | داشبورد تحلیلی، روند روزانه، گزارش ورود/خروج، مقایسه وزن بارنامه/باسکول، کارت‌های تاشو |
| **جستجوی سراسری** | جست‌وجو در حواله‌ها، مرغداران، محصولات و … |
| **ردپای کاربران (Audit)** | ثبت کامل ایجاد/ویرایش/حذف با مقدار قبل و بعد، کاربر، IP و جزئیات |
| **باسکول (توزین نگار)** | سینک خودکار قبوض از SQL Server کارخانه، تخصیص به حواله، ایجاد حواله از قبض، بررسی مغایرت وزن، ویرایش نوع، فیلتر خالص‌شده/ناخالص، نام مشتری |
| **کاربران و امنیت** | نقش‌ها (مدیر/اپراتور/بازدیدکننده)، ورود با نام کاربری یا رمز اختصاصی، ۲FA با TOTP و QR، نشست‌های قابل ابطال، محدودسازی نرخ، بازدیدکننده فقط‌خواندنی |
| **پشتیبان‌گیری** | بکاپ دستی/زمان‌بندی‌شده دیتابیس از داخل نرم‌افزار + اسکریپت‌های سرور |
| **آفلاین/همگام‌سازی** | صف تغییرات (`sync_mutations`) و همگام‌سازی پس از بازگشت اتصال |

---

## ۲. پشته‌ی فناوری

| لایه | فناوری |
|---|---|
| فرانت‌اند | React 18 + TypeScript + Vite + TailwindCSS + React Router (HashRouter) + SweetAlert2 + Recharts + `react-multi-date-picker` (شمسی) + SortableJS |
| بک‌اند | Node.js + TypeScript + Express، بسته‌شده با esbuild به یک فایل `dist/server.cjs` |
| دیتابیس | **PostgreSQL** با Drizzle ORM (و PGlite فقط برای تست/توسعه) |
| اتصال باسکول | کتابخانه‌ی `mssql` در یک **ورکر مستقل** (`dist/weighbridge-worker.cjs`) با زمان‌بندی Scheduled Task |
| احراز هویت | JWT در کوکی HttpOnly + جدول `sessions` + bcrypt + TOTP (`otplib`) |
| فایل/گزارش | multer (آپلود)، xlsx، pdfjs-dist، qrcode |
| هوش مصنوعی (اختیاری) | `@google/genai` برای استخراج خودکار حواله از تصویر |

---

## ۳. ساختار پروژه

```
├─ App.tsx / index.tsx        # بوت فرانت‌اند، مسیردهی سراسری
├─ pages/                     # Dashboard, Entry, Exit, Inventory, Production, Farmers,
│                             #   ActiveBroods, Reports(+Dashboard), Log, Settings, Users,
│                             #   GlobalSearch, Setup, Login, Weighbridge
├─ components/                # Sidebar, MainLayout, Modal, DatePicker, SyncStatusIndicator ...
├─ contexts/                  # AuthContext, SettingsContext
├─ services/                  # dataService (کل ارتباط با API)، dbStore (IndexedDB)، authService
├─ shared/                    # jalali.ts (تبدیل تاریخ شمسی/میلادی)، persianText.ts
├─ server.ts                  # نقطه‌ی ورود بک‌اند + مانت روت‌ها + بوت‌استرپ
├─ server/
│   ├─ routes/                # auth, users, settings, farmers, drivers, origins, invoices,
│   │                         #   inventory, production, formulas, warehouses, reports,
│   │                         #   audit, sync, backup, uploads, weighbridge
│   ├─ services/              # invoiceService (قلب منطق حواله/انبار)، auditService
│   ├─ db/                    # schema.ts (Drizzle)، migrate.ts، index.ts، seed.ts
│   └─ middleware/            # auth (requireAuth/requireRole)، rate limit، blockViewerWrites
├─ workers/weighbridge-worker.ts   # سینک قبوض باسکول → PostgreSQL (UPSERT)
├─ migrations/                # SQL مایگریشن‌ها
├─ tests/                     # تست‌های tsx (صف سینک، مرتب‌سازی چندستونه، ادغام مرغدار ...)
├─ tools/dev/                 # ابزارهای توسعه (verify-401، verify-mapper، compute-totp)
└─ docs/                      # ARCHITECTURE, API, DATABASE, DEPLOYMENT, ANDROID-APPS-PLAN
```

---

## ۴. راه‌اندازی سریع (توسعه)

```bash
cp .env.example .env      # DATABASE_URL و JWT_SECRET را پر کنید
npm install
npm run db:migrate        # ساخت جداول
npm run dev               # http://127.0.0.1:3000
```

### ساخت برای استقرار

```bash
npm run build:deploy      # vite build + esbuild → dist/server.cjs
npm run build:worker      # باسکول → dist/weighbridge-worker.cjs
npm run build:weighbridge # هر دو
```

### تست

```bash
npm test                  # صف سینک، مرتب‌سازی چندستونه، ادغام مرغدار، نام مرغدار ...
```

---

## ۵. متغیرهای محیطی (خلاصه)

| کلید | توضیح |
|---|---|
| `PORT`, `HOST` | پورت و آدرس (تولید: `3000` / `127.0.0.1`) |
| `DATABASE_URL` | رشته‌ی اتصال PostgreSQL |
| `JWT_SECRET` | کلید امضای توکن (حداقل ۳۲ کاراکتر تصادفی) |
| `UPLOAD_DIR`, `BACKUP_DIR` | مسیر فایل‌ها و پشتیبان‌ها |
| `CORS_ORIGIN`, `ALLOWED_ORIGINS`, `CROSS_SITE_COOKIE` | سیاست CORS/کوکی |
| `WEIGHBRIDGE_HOST/PORT/DB/USER/PASS` | اتصال به SQL Server باسکول |
| `WEIGHBRIDGE_TABLE/SCHEMA/BATCH/LOOKBACK_HOURS` | جدول و پنجره‌ی سینک (پیش‌فرض ۵۰۰۰ ردیف / ۶۰ روز) |
| `WEIGHBRIDGE_COLUMN_MAP` | نگاشت صریح ستون‌های باسکول (JSON) |
| `GEMINI_API_KEY` | (اختیاری) استخراج خودکار از تصویر |

فهرست کامل: `.env.example`

---

## ۶. اتصال به باسکول (توزین نگار)

- ورکر هر **۲ دقیقه** (Scheduled Task) جدیدترین رکوردهای `WEIGHNGDB.dbo.WeightTable` را می‌خواند و با **UPSERT روی `external_id`** در `weighbridge_records` می‌نویسد (تکرارپذیر و بی‌خطر).
- ستون‌ها **خودکار کشف** می‌شوند (INFORMATION_SCHEMA) و با `WEIGHBRIDGE_COLUMN_MAP` قابل قفل‌کردن‌اند:
  `ID`, `ShomareHavale` (شماره حواله), `TruckNo` (پلاک), `DriverName`, **`CustomerName`** (نام مشتری), `Goods` (نوع کالا), `WeightFull`, `WeightEmpty`, `NetWeight`, `DateFull`, `InOutFlag`.
- **زمان** به‌صورت متن دیوارکلاک (`CONVERT(...,126)`) خوانده/ذخیره می‌شود ⇒ هیچ جابه‌جایی منطقهٔ زمانی رخ نمی‌دهد.
- **قواعد تعیین نوع:** حوالهٔ ثبت‌شدهٔ کاربر ⇒ نوع همان حواله > ویرایش دستی (قفل‌شده) > پرچم «ورودی» باسکول > خالص‌شدهٔ بی‌پرچم = خروج.
- **بازبینی حواله در بازهٔ ±۳ روز:** تطبیق با شماره حواله **و** وزن خالص دقیق + امتیازدهی نوع/نزدیکی تاریخ ⇒ نمایش «✓ حواله ثبت شد»، «هم‌خوان با باسکول» یا «⚠ مغایرت X کیلو».
- خاموشی/قطع شبکه‌ی باسکول هرگز برنامه را متوقف نمی‌کند (لاگ، خروج ۰، تلاش در اجرای بعدی).

---

## ۷. نقش‌ها و امنیت

| نقش | دسترسی |
|---|---|
| `ADMIN` | کامل (کاربران، تنظیمات، بکاپ، همه‌ی نوشتن‌ها) |
| `MANAGER` / اپراتور | ثبت/ویرایش حواله، انبار، تولید، باسکول (بدون مدیریت کاربران) |
| `VIEWER` | فقط خواندن (همه‌ی متدهای نوشتنی مسدود) |

- کوکی HttpOnly + SameSite، محدودسازی نرخ روی `/api/auth`، ۲FA (TOTP)، ابطال نشست.
- تمام تغییرات در `audit_logs` با مقدار قبل/بعد ثبت می‌شود.

---

## ۸. استقرار (خلاصه)

تولید روی **Windows Server**: PostgreSQL + سرویس Node (Scheduled Task) + **Nginx** تنها درگاه عمومی (HTTPS) + تسک‌های زمان‌بندی (سینک باسکول، بکاپ، چرخش لاگ، سلامت).

راهنمای گام‌به‌گام: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## ۹. مسیر توسعه (Roadmap)

- [x] فاز ۱ — حواله‌ها، انبار، تولید، گزارش‌ها، کاربران، ردپا
- [x] فاز ۲ — ادغام مرغداران، انتساب حواله‌های بی‌صاحب، مرتب‌سازی چندستونه، صف سینک
- [x] فاز ۳ — **یکپارچگی کامل باسکول** (سینک، تخصیص، ایجاد حواله، مغایرت، ویرایش نوع، نام مشتری)
- [ ] فاز ۴ — **اپلیکیشن‌های اندروید**: راننده، مرغدار، مدیر → [`docs/ANDROID-APPS-PLAN.md`](docs/ANDROID-APPS-PLAN.md)
- [ ] فاز ۵ — اعلان (SMS/Push)، امضای دیجیتال بارنامه، داشبورد مالی

---

## ۱۰. مالکیت

کد اختصاصی کارخانه‌ی آرادان (NIR) — استفاده و توسعه با اجازه‌ی مالک.

<!-- repo: github.com/hassana7898/Nir-V2 -->


---

# بخش ۲ — معماری (Architecture)

<!-- source: 

# معماری سامانه (Architecture)

## ۱. نمای کلی

```
┌──────────────────────────── مرورگر (کاربر) ────────────────────────────┐
│  React SPA (Vite)  +  IndexedDB (dbStore)  +  صف سینک (sync_mutations) │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS  /api/*
                     ┌──────────▼──────────┐
                     │  Nginx (تنها درگاه) │  TLS، ACME، هدرها (noindex در dev)
                     └──────────┬──────────┘
                                │ http://127.0.0.1:3000
                ┌───────────────▼────────────────┐
                │ Express + TypeScript (server.cjs)│
                │  middleware: auth / rate-limit  │
                │  routes: 17 ماژول /api/*        │
                │  services: invoiceService, audit│
                └───────┬────────────────┬────────┘
                        │                │
             ┌──────────▼──────┐  ┌──────▼───────────────┐
             │ PostgreSQL      │  │ فایل‌ها: uploads/      │
             │ (Drizzle ORM)   │  │ بکاپ‌ها: backups/      │
             └─────────────────┘  └──────────────────────┘

   ┌───────────────── ورکر مستقل (Scheduled Task هر ۲ دقیقه) ─────────────────┐
   │  weighbridge-worker.cjs ──(mssql/Tailscale)──► SQL Server باسکول          │
   │  ▼ UPSERT روی external_id                                                 │
   │  weighbridge_records (PostgreSQL)                                        │
   └──────────────────────────────────────────────────────────────────────────┘
```

## ۲. لایه‌های کد

| لایه | مسیر | مسئولیت |
|---|---|---|
| UI | `pages/`, `components/` | صفحات و اجزای RTL، تاریخ شمسی، جدول‌های مرتب‌شونده، مودال‌ها |
| State | `contexts/` | `AuthContext` (کاربر/نقش)، `SettingsContext` (تنظیمات و منوها) |
| کلاینت API | `services/dataService.ts` | تمام درخواست‌ها، نرمال‌سازی پاسخ، صف سینک |
| ذخیره‌سازی مرورگر | `services/dbStore.ts` | IndexedDB: کش، صف تغییرات، وضعیت آفلاین |
| کتابخانه مشترک | `shared/` | `jalali.ts` (شمسی↔میلادی، فاصله‌ی روز)، `persianText.ts` (یکسان‌سازی نام/کد پلاک) |
| بک‌اند | `server.ts` + `server/routes/*` | مانت روت‌ها، بوت‌استرپ، سلامت، محدودسازی نرخ |
| دامنه | `server/services/invoiceService.ts` | ثبت/ویرایش حواله، اثر انبار، بچ، مرغدار، تولید |
| داده | `server/db/schema.ts` | ۲۰ جدول Drizzle (فهرست در `docs/DATABASE.md`) |
| ورکر | `workers/weighbridge-worker.ts` | سینک قبوض باسکول (کشف ستون، Upsert، مدیریت خطا) |

## ۳. جریان‌های کلیدی

### ۳-۱. ثبت حواله
1. کلاینت `POST /api/invoices` → `createInvoiceInTransaction(tx, payload, actor)`
2. در **یک تراکنش**: درج حواله → تضمین/ایجاد مرغدار (اگر خروج) → تراکنش انبار (`inventory_transactions`) → مصرف فرمول/بچ (اگر تولید) → `audit_logs`
3. پاسخ شامل شناسه‌ی حواله؛ کلاینت کش/نشست را تازه می‌کند

### ۳-۲. آفلاین و همگام‌سازی
- عملیات نوشتنی در نبود شبکه در `sync_mutations` (IndexedDB) صف می‌شود.
- هنگام بازگشت اتصال، `SyncStatusIndicator` صف را پخش می‌کند؛ خطاهای دائمی (۴۰۰/۴۲۲) نباید صف را تا ابد قفل کنند (سیاست: دور ریختن/علامت‌گذاری).

### ۳-۳. باسکول
1. Scheduled Task → `RUN-WEIGHBRIDGE-SYNC*.ps1` → `node dist/weighbridge-worker.cjs --once`
2. ورکر: اتصال به SQL Server (پیش‌فرض از طریق Tailscale)، `SELECT TOP BATCH ...` با `CONVERT(...,126)` برای ستون‌های تاریخ
3. `UPSERT ... ON CONFLICT (external_id)` — هر سینک، فیلدهای وارداتی را تازه می‌کند اما `status` و `mapped_remittance_id` را دست نمی‌زند و اگر `direction_locked` باشد، نوع دستی حفظ می‌شود
4. API باسکول: لیست/فیلترها، تخصیص به حواله (`map`)، لغو (`unmap` با بازگردانی وزن)، ایجاد حواله از قبض (`create-remittance`)، ویرایش نوع (`PATCH direction`)، بررسی مغایرت در بازه‌ی ±۳ روز

### ۳-۴. احراز هویت
- `POST /api/auth/login` (نام کاربری یا شناسه‌ی کوتاه) → JWT امضاشده در کوکی HttpOnly + رکورد `sessions`
- ۲FA (TOTP) با `otplib` و QR؛ محدودسازی نرخ روی ورود
- میان‌افزار `requireAuth`، `requireRole('ADMIN','MANAGER')`، `blockViewerWrites` (نقش VIEWER فقط خواندن)

## ۴. توپولوژی استقرار (تولید)

| جزء | جزئیات |
|---|---|
| سیستم | Windows Server |
| وب‌سرور | Nginx (TLS/ACME) → پروکسی به `127.0.0.1:3000` |
| برنامه | `C:\Servers\NIR\app` — `server.cjs` + `dist/` + `runtime\node.exe` |
| سرویس | Scheduled Task «NIR Production Service» با `RUN-NIR.ps1` |
| دیتابیس | PostgreSQL روی `127.0.0.1:5432`، دیتابیس `nir_db` |
| باسکول | `100.71.164.40:1433` روی Tailscale (بدون افشای عمومی) |
| تسک‌ها | سینک باسکول (۲ دقیقه)، بکاپ روزانه، چرخش لاگ، سلامت |
| محیط آزمایشی | `C:\Servers\NIR\dev` + دیتابیس `nir_dev` + تسک «NIR Dev Service» (پورت ۳۰۰۱) |

## ۵. تصمیم‌های طراحی

- **باندل تک‌فایلی سرور** (`esbuild --packages=bundle`) زیرا سرور `node_modules` ندارد.
- **ورکر جدا**: خطای باسکول نباید API را درگیر کند؛ خروج همیشه ۰ و لاگ‌گیری در `logs/`.
- **زمان دیوارکلاک متنی** برای باسکول: هیچ تبدیل منطقهٔ زمانی ⇒ صفر جابه‌جایی ساعت.
- **مایگریشن‌های افزودنی**: هر تغییر اسکیما با `IF NOT EXISTS` تا اجرای مکرر بی‌خطر باشد.
- **audit-first**: هر نوشتن، ردپای قبل/بعد دارد.


---

# بخش ۳ — مدل داده (Database)

<!-- source: 

# مدل داده (Database)

دیتابیس: **PostgreSQL** · ORM: **Drizzle** (`server/db/schema.ts`) · مایگریشن‌ها: `server/db/migrate.ts` + `migrations/*.sql`
همه‌ی مایگریشن‌ها **افزودنی و idempotent** هستند (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## جدول‌ها (۲۰ جدول)

| جدول | نقش | نکات کلیدی |
|---|---|---|
| `users` | کاربران سامانه | `id`, `username`, `password_hash` (bcrypt)، `role` (`ADMIN`/`MANAGER`/`VIEWER`)، `totp_secret` (2FA) |
| `sessions` | نشست‌های فعال | امکان ابطال؛ مبنای کوکی JWT |
| `settings` | تنظیمات برنامه | یک ردیف `id='default'` با ستون `data` (JSONB): نام کارخانه، محصول پیش‌فرض، منوهای فعال (`enabledMenus`)، پارامترهای گزارش |
| `farmers` | مرغداران (مشتریان) | `id`, `name`, `phone`, `broods` (JSONB دوره‌ها)، `is_hidden`, `deleted_at` (حذف نرم) |
| `drivers` | رانندگان | `id`, `name`, `phone`, `iban` |
| `origins` | مبدأها | فهرست مبدأهای خرید |
| `products` | محصولات | `id`, `name`, `type` = `rawMaterial` (مواد اولیه) / `finishedGood` (محصول نهایی) |
| `product_categories` | دسته‌بندی محصولات | برای گزارش‌های گروهی |
| `warehouses` | انبارها | مبنای تفکیک موجودی |
| `invoices` | **حواله‌های ورود و خروج** | `type` (`entry`/`exit`)، `date` (**شمسی `YYYY/MM/DD`**)، `product_id`, `product_name`, `driver_name`, `seller_name` (خرید)، `farmer_id` (فروش)، `weight` (فروش)، `scale_weight`/`bill_weight` (خرید)، `invoice_number`, `bill_number`, `origin`, `transport_cost`, `sort_order`, `version`, `deleted_at`, `created_by`/`updated_by` |
| `inventory_transactions` | تراکنش‌های انبار | ورود/خروج/اصلاح؛ مرجع حواله یا تولید؛ مبنای موجودی زنده |
| `inventory_adjustments` | اصلاح موجودی | مغایرت‌گیری انبارگردانی |
| `production_records` | تولید | محصول، فرمول، مقدار، تاریخ |
| `formulas` / `formula_items` | فرمولاسیون | نسبت مواد اولیه در محصول نهایی |
| `batches` | بچ‌های تولید | شماره بچ، مقدار اولیه/باقی‌مانده، تاریخ تولید/انقضا |
| `logs` | لاگ‌های عملیاتی برنامه | رخدادهای داخلی |
| `audit_logs` | **ردپای کاربران** | `action`, `entity`, `target_ids`, `changes` (قبل/بعد), `context`, `details`, کاربر/IP |
| `sync_mutations` | صف همگام‌سازی آفلاین | عملیات معوق مرورگر برای پخش در بازگشت شبکه |
| `weighbridge_records` | **قبوض باسکول** | `external_id` (کلید باسکول، UNIQUE)، `ticket_number`, `plate_number`, `driver_name`, **`customer_name`**، **`goods`**، **`remittance_number`** (شماره حواله)، `gross_weight`, `tare_weight`, `net_weight`, `weigh_time` (متن دیوارکلاک)، **`direction`** (`entry`/`exit`/`unknown`)، **`direction_locked`** (ویرایش دستی)، `status` (`unmapped`/`mapped`/`archived`)، `mapped_remittance_id` → `invoices.id`، `previous_weight_value`, `source`, `raw_payload` (JSONB کامل رکورد باسکول)، `last_synced_at` |

## روابط مهم

```
farmers ──1:N──► invoices (farmer_id)            [حواله فروش]
invoices ──1:N──► inventory_transactions         [اثر انبار]
invoices ──1:N──► weighbridge_records (mapped_remittance_id)   [اتصال قبض ↔ حواله]
products ──1:N──► invoices / batches / inventory_transactions
formulas ──1:N──► formula_items ──► products
users    ──1:N──► audit_logs (actor)
```

## نکات داده‌ای مهم

- **تاریخ حواله‌ها شمسی** (`1405/07/18`) است؛ تبدیل‌ها با `shared/jalali.ts`. ردیف‌های قدیمی ممکن است ISO باشند ⇒ کدها هر دو را می‌پذیرند.
- **`weigh_time`** یک `timestamp` بدون منطقه است و **عین ارقام باسکول** ذخیره می‌شود (بدون تبدیل).
- `raw_payload` کل رکورد باسکول را نگه می‌دارد (منبع حقیقت برای بازسازی/عیب‌یابی مثل `Destination`, `CustomerName`, `BillOfLading`).
- حذف‌ها **نرم** (`deleted_at`) هستند؛ گزارش‌ها/لیست‌ها ردیف‌های حذف‌شده را کنار می‌گذارند.

## پشتیبان‌گیری

- از داخل نرم‌افزار: ماژول بکاپ (`/api/backup`) با `pg_dump`/`pg_restore` (مسیر `PG_BIN`).
- از سرور: تسک «NIR Daily Backup» + اسکریپت‌های `BACKUP-NIR.ps1` / `RESTORE-NIR.ps1`.
- **قبل از هر تغییر اسکیما/انتشار**، بکاپ دستی گرفته می‌شود (نمونه: `C:\Servers\NIR\app\backups\…`).


---

# بخش ۴ — مرجع API

<!-- source: 

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


---

# بخش ۵ — راهنمای استقرار (Deployment)

<!-- source: 

# راهنمای استقرار و به‌روزرسانی (Deployment)

> محیط هدف: **Windows Server** · تولید: `app.artadan.ir` · آزمایشی: `dev.artadan.ir`

## ۱. چیدمان سرور

| مسیر | توضیح |
|---|---|
| `C:\Servers\NIR\app` | برنامه‌ی **تولید** (`server.cjs`, `dist/`, `.env`, `runtime\node.exe`) |
| `C:\Servers\NIR\dev` | برنامه‌ی **آزمایشی** (پورت ۳۰۰۱، دیتابیس `nir_dev`) |
| `C:\Servers\NIR\scripts` | اسکریپت‌های زمان‌بندی (`RUN-NIR.ps1`, `RUN-WEIGHBRIDGE-SYNC*.ps1`, بکاپ/چرخش لاگ) |
| `C:\Servers\NIR\{logs,uploads,backups,secrets}` | لاگ‌ها، فایل‌های آپلودی، پشتیبان‌ها، اسرار |
| `C:\Servers\Nginx` | پیکربندی Nginx (TLS/ACME) → پروکسی به `127.0.0.1:3000` |
| PostgreSQL | `127.0.0.1:5432` — دیتابیس‌ها: `nir_db` (تولید)، `nir_dev` (آزمایشی) |

**تسک‌های زمان‌بندی‌شده:** `NIR Production Service` (سرویس اصلی) · `NIR Dev Service` · `NIR Weighbridge Sync` (dev) · `NIR Weighbridge Sync Prod` · `NIR Daily Backup` · `NIR Log Rotation` · `NIR Health Check` · `NIR Nginx Reload`.

## ۲. پیش‌نیازها

- Node.js (یا `runtime\node.exe` همراه پروژه) و npm روی ماشین **ساخت**
- PostgreSQL 14+ · `psql`/`pg_dump` (مسیر در `.env` → `PG_BIN`)
- Nginx + گواهی TLS
- (اختیاری، برای باسکول) **Tailscale** روی سرور و روی سیستم باسکول

## ۳. ساخت (روی ماشین توسعه)

```bash
npm ci
npm run build:weighbridge      # = vite build + esbuild server.cjs + esbuild worker
# خروجی: dist/server.cjs ، dist/weighbridge-worker.cjs ، dist/index.html ، dist/assets/*
```

## ۴. استقرار (تولید)

1. **پیش‌پرواز (اجباری)**
   - اسنپ‌شات شمارش‌ها: `psql -d nir_db -c "SELECT (SELECT count(*) FROM invoices), (SELECT count(*) FROM farmers), (SELECT count(*) FROM users);"`
   - بکاپ فایل‌ها: `server.cjs`، `dist\index.html`، `.env`، `dist\assets\` → `app\backups\<tag>\`
2. **مایگریشن افزودنی** (فقط `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`)
   - `psql -d nir_db -f migrations/0003_weighbridge.sql` یا اجرای `server/db/migrate.ts`
3. **انتقال فایل‌ها** (به‌ترتیب)
   - `server.cjs` → هم به `app\server.cjs` و هم `app\dist\server.cjs`
   - `dist\weighbridge-worker.cjs` → `app\dist\`
   - `dist\assets\*` → `app\dist\assets\` (ادغام؛ باندل‌های قدیمی را حذف نکنید تا تب‌های باز نشکنند)
   - **`index.html` را آخر از همه** کپی کنید (تا پنجره‌ی ناسازگاری باندل نسازید)
4. **ری‌استارت سرویس**
   ```powershell
   Stop-ScheduledTask  'NIR Production Service'; Start-Sleep 3
   Start-ScheduledTask 'NIR Production Service'
   curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/health   # باید 200
   ```
5. **راستی‌آزمایی**
   - `/api/health` = 200 · صفحه‌ی عمومی = 200 · باندل جدید در `index.html`
   - شمارش‌های مرحله‌ی ۱ **باید بدون تغییر** باشند (تنها جدول/ستون‌های جدید اضافه شده‌اند)
   - در صورت داشتن باسکول: اجرای یک‌باره‌ی `RUN-WEIGHBRIDGE-SYNC-PROD.ps1` و بررسی لاگ `app\logs\weighbridge-worker.log`

> اسکریپت نمونه‌ی کل این فرایندها: `wb-fix6.ps1` (dev) و `wb-prod-deploy.ps1` (تولید) — هر دو idempotent و بدون هیچ عملیات مخرب روی داده.

## ۵. متغیرهای محیطی (`.env`)

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:5432/nir_db
JWT_SECRET=<32+ کاراکتر تصادفی>
UPLOAD_DIR=C:\Servers\NIR\uploads
BACKUP_DIR=C:\Servers\NIR\backups
API_BASE_URL=https://app.artadan.ir
CORS_ORIGIN=https://app.artadan.ir
ALLOWED_ORIGINS=https://app.artadan.ir
CROSS_SITE_COOKIE=false
PG_BIN=C:\Program Files\PostgreSQL\18\bin

# باسکول
WEIGHBRIDGE_HOST=<IP باسکول در Tailscale>
WEIGHBRIDGE_PORT=1433
WEIGHBRIDGE_DB=WEIGHNGDB
WEIGHBRIDGE_USER=<user فقط-خواندنی>
WEIGHBRIDGE_PASS=<pass>
WEIGHBRIDGE_TABLE=WeightTable
WEIGHBRIDGE_SCHEMA=dbo
WEIGHBRIDGE_BATCH=5000
WEIGHBRIDGE_LOOKBACK_HOURS=8760
WEIGHBRIDGE_COLUMN_MAP={"externalId":"ID","ticketNumber":"ShomareHavale","plateNumber":"TruckNo","driverName":"DriverName","customerName":"CustomerName","goods":"Goods","grossWeight":"WeightFull","tareWeight":"WeightEmpty","netWeight":"NetWeight","weighTime":"DateFull","direction":"InOutFlag","remittanceNumber":"ShomareHavale"}
```

`.env` هرگز commit نمی‌شود (در `.gitignore`). الگو: `.env.example`.

## ۶. باگ‌تریبل‌شوتینگ سریع

| نشانه | بررسی |
|---|---|
| صفحه ۵۰۲/۵۰۳ | سرویس بالا نیست → تسک را Start کنید؛ `logs\nir-server.err.log` |
| صفحه سفید پس از انتشار | `Ctrl+F5` (کش index.html)؛ وجود باندل جدید در `dist\assets` |
| خطای «column … does not exist» | مایگریشن مرحله‌ی ۲ اجرا نشده |
| سینک باسکول انجام نمی‌شود | تسک سینک، لاگ ورکر، دسترسی Tailscale به پورت ۱۴۳۳، مقادیر `WEIGHBRIDGE_*` |
| ۴۰۱ روی همه‌ی APIها | تاریخ/ساعت سرور یا `JWT_SECRET` تغییر کرده ⇒ ورود مجدد |

## ۷. بازگردانی (Rollback)

```powershell
Stop-ScheduledTask 'NIR Production Service'
Copy-Item 'C:\Servers\NIR\app\backups\<tag>\server.cjs'    'C:\Servers\NIR\app\server.cjs' -Force
Copy-Item 'C:\Servers\NIR\app\backups\<tag>\server.cjs'    'C:\Servers\NIR\app\dist\server.cjs' -Force
Copy-Item 'C:\Servers\NIR\app\backups\<tag>\dist_index.html' 'C:\Servers\NIR\app\dist\index.html' -Force
Copy-Item 'C:\Servers\NIR\app\backups\<tag>\.env'          'C:\Servers\NIR\app\.env' -Force
Start-ScheduledTask 'NIR Production Service'
```
جدول‌های جدید (مثل `weighbridge_records`) کاملاً مستقل‌اند؛ حذفشان به داده‌های قبلی آسیب نمی‌زند.


---

# بخش ۶ — نقشه‌ی اپ‌های اندروید

<!-- source: 

# نقشه‌ی توسعه‌ی اپلیکیشن‌های اندروید (Driver / Farmer / Manager)

> هدف: سه اپلیکیشن اندرویدی مستقل در کنار سامانه‌ی وب `app.artadan.ir` که همه به **همان بک‌اند و همان دیتابیس** متصل شوند.
> این سند مشخصات، شکاف‌های فعلی API و فازبندی اجرا را تعیین می‌کند.

---

## ۱. سه اپ، سه مخاطب

### ۱-۱. اپ راننده (`driver-app`)
کاربر: راننده‌های حمل مواد اولیه/محصول (لاگین با شماره موبایل + رمز یک‌بارمصرف).
| صفحه | توضیح |
|---|---|
| بارهای من | لیست حواله/بارنامه‌هایی که راننده به آن‌ها تخصیص یافته |
| جزئیات بار | مبدأ، مقصد، محصول، وزن بارنامه، پلاک، شماره حواله، نام مشتری |
| توزین | ثبت نوبت باسکول و مشاهده‌ی وزن پر/خالی/خالص همان قبض |
| رسید تحویل | عکس بارنامه + عکس باسکول + امضای تحویل‌گیرنده + GPS + زمان |
| اعلان‌ها | تخصیص بار جدید، تغییر مقصد، یادآوری |
| آفلاین | ثبت رسید بدون اینترنت و ارسال خودکار در بازگشت شبکه |

### ۱-۲. اپ مرغدار (`farmer-app`)
کاربر: مرغدار (مشتری). لاگین با موبایل ثبت‌شده در پرونده + OTP.
| صفحه | توضیح |
|---|---|
| داشبورد من | دوره‌های فعال، موجودی جیره، آخرین تحویل‌ها |
| دوره‌های پرورش | ورود/خروج جوجه، مصرف دان، تلفات |
| حواله‌های من | حواله‌های خروج با وزن باسکول، تاریخ شمسی، مغایرت وزن |
| درخواست جیره | ثبت سفارش محصول/فرمول برای تایید مدیر |
| صورتحساب | مانده حساب، جمع وزنی، ریز تراکنش‌ها |
| اعلان‌ها | تایید حواله، ارسال بار، یادآوری واکسن/جیره |

### ۱-۳. اپ مدیر (`manager-app`)
کاربر: مدیر/اپراتور کارخانه (همان حساب وب).
| صفحه | توضیح |
|---|---|
| داشبورد KPI | ورود/خروج امروز، موجودی انبار، تولید، تعداد قبوض باسکول |
| تاییدها | صف تایید درخواست جیره، رسید تحویل راننده، اصلاح موجودی |
| باسکول | قبوض، فیلتر خالص‌شده/ناخالص، **نام مشتری**، «✓ حواله ثبت شد»، **⚠ مغایرت وزن**، ویرایش نوع |
| حواله‌ها | ورود/خروج با جستجوی سریع سریال/شماره حواله/پلاک/مشتری |
| انبار و تولید | موجودی زنده، ثبت تولید |
| گزارش‌ها | نمودار روند روزانه، مقایسه بارنامه/باسکول |
| اعلان | مغایرت‌ها، خطای سینک باسکول، رخدادهای مهم |

---

## ۲. پیشنهاد فنی (انتخاب تیم لازم است)

| گزینه | مزیت | معایب | پیشنهاد |
|---|---|---|---|
| **React Native + Expo (TypeScript)** | هم‌زبانی با وب (React/TS)، کد مشترک با `services/dataService.ts`، OTA Update، سرعت توسعه بالا | پرفورمنس پایین‌تر در گرافیک سنگین (اینجا نیاز نیست) | ⭐ **پیشنهاد اول** |
| Flutter (Dart) | UI یکنواخت و روان، ابزار عالی | زبان جدید برای تیم، دوباره‌نویسی منطق | گزینه‌ی دوم |
| Kotlin + Jetpack Compose | بهترین یکپارچگی با اندروید | کاملاً جدا از کد فعلی، زمان توسعه بیشتر | برای اپ سنگین |

**ساختار پیشنهادی مخزن (Monorepo):**
```
apps/
├─ mobile-shared/     # کلاینت API، احراز هویت، مدل‌ها، تاریخ شمسی، تم، کامپوننت‌های مشترک
├─ driver-app/        # اپ راننده (نسخه و امضای مستقل)
├─ farmer-app/        # اپ مرغدار
└─ manager-app/       # اپ مدیر
```
> گزینه‌ی ارزان‌تر: **یک اپ با سه حالت نقش**. ساختار بالا هر دو حالت را پشتیبانی می‌کند.

---

## ۳. شکاف‌های فعلی بک‌اند (کار لازم قبل/هم‌زمان با اپ‌ها)

1. **احراز هویت موبایل** — اکنون JWT در کوکی HttpOnly است (مناسب وب). برای موبایل:
   - `POST /api/auth/token` (بدنه‌ی JSON) → `{ accessToken, refreshToken, user }`
   - `POST /api/auth/refresh` و `POST /api/auth/logout` (ابطال نشست)
   - OTP پیامکی برای راننده/مرغدار: `POST /api/auth/otp/request`، `/api/auth/otp/verify` + جدول `otp_codes` (انقضا + محدودیت نرخ)
2. **نقش‌های جدید و دامنه‌ی داده**
   - نقش‌های `DRIVER` و `FARMER` + اتصال کاربر به `drivers.id` / `farmers.id`
   - فیلتر اجباری سمت سرور: راننده فقط بارهای خودش، مرغدار فقط حواله‌ها/دوره‌های خودش
3. **اندپوینت‌های سبک موبایلی**
   - `GET /api/mobile/summary` (KPI امروز برای مدیر)
   - `GET /api/mobile/my-loads` (راننده) · `GET /api/mobile/my-invoices` (مرغدار)
   - `POST /api/mobile/delivery-receipt` (عکس + امضا + GPS → متصل به بارنامه)
   - `POST /api/mobile/orders` (درخواست جیره توسط مرغدار)
4. **آپلود فایل** — `/api/uploads` موجود است؛ افزودن محدودیت حجم/نوع عکس و اتصال به جدول پیوست‌ها
5. **اعلان‌ها** — جدول `device_tokens` + سرویس FCM (یا پیامک) و رخدادهای اعلان (تخصیص بار، تایید حواله، مغایرت باسکول)
6. **نسخه‌بندی API** — `GET /api/meta` با `{ apiVersion, minAppVersion }` برای اجبار به‌روزرسانی
7. **آفلاین** — الگوی صف سینک موجود (`sync_mutations`) در موبایل هم قابل استفاده است (SQLite/MMKV)

---

## ۴. امنیت و انتشار

- ذخیره‌ی توکن در **Android Keystore**، Refresh Token چرخشی، Certificate Pinning (اختیاری)
- RBAC سمت سرور (هیچ تصمیمی در اپ گرفته نشود)، محدودسازی نرخ روی OTP و ورود
- لاگ رخداد موبایل در همان `audit_logs` (کاربر/دستگاه/IP)
- انتشار: **Google Play** یا **APK داخلی** روی سرور کارخانه با امضای مستقل و `versionCode`
- CI: GitHub Actions برای ساخت AAB/APK و انتشار خودکار Release در همین مخزن

---

## ۵. فازبندی پیشنهادی

| فاز | خروجی | پیش‌نیاز |
|---|---|---|
| **M0** | آماده‌سازی بک‌اند: توکن موبایل، OTP، نقش‌های راننده/مرغدار، endpointهای چکیده، `/api/meta` | — |
| **M1** | اسکلت Monorepo + `mobile-shared` + اپ **مدیر** MVP (داشبورد + باسکول + حواله‌ها) | M0 |
| **M2** | اپ **راننده**: بارهای من، جزئیات، رسید تحویل با عکس/GPS | M1 |
| **M3** | اپ **مرغدار**: دوره‌ها، حواله‌ها، درخواست جیره، صورتحساب | M1 |
| **M4** | اعلان‌ها (FCM/SMS) + آفلاین کامل + بهینه‌سازی | M2/M3 |
| **M5** | انتشار (Play/APK)، پایش خطا (Sentry)، سیاست به‌روزرسانی | M4 |

**تخمین:** M0 ≈ ۳–۵ روز کاری · هر اپ MVP ≈ ۱–۲ هفته · M4/M5 ≈ ۱ هفته

---

## ۶. گام بعدی (تصمیم شما)

1. انتخاب پشته: **React Native/Expo** (پیشنهاد) یا Flutter یا Kotlin
2. سه اپ جدا یا یک اپ با سه نقش (سه‌گانه در Google Play هزینه/زمان بیشتری می‌برد)
3. اجازه‌ی اجرای **فاز M0** روی بک‌اند (بدون تغییر در داده‌های فعلی؛ فقط افزودن جدول‌های `otp_codes`/`device_tokens` و اندپوینت‌ها)


---

