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
