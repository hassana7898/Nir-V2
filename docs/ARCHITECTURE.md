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
