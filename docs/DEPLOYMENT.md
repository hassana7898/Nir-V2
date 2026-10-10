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

## ۶. کارایی (تنظیمات انجام‌شده روی سرور)

| مورد | مقدار | چرا |
|---|---|---|
| `gzip on` در `conf/nginx.conf` | با `gzip_types` شامل **`text/javascript`** (فایل‌ها توسط Node با این MIME سرو می‌شوند) | باندل SPA ‏۲.۸MB بود و بدون gzip روی اینترنت کند ~۶ ثانیه طول می‌کشید؛ اکنون ~۶۹۷KB و ~۰.۹ ثانیه |
| `WEIGHBRIDGE_LOOKBACK_HOURS` | `168` (۷ روز) | فقط قبوض اخیر برای سینک/بروزرسانی لازم‌اند |
| گارد `IS DISTINCT FROM` در UPSERT ورکر | فعال | سینک‌های تکراری دیگر هیچ سطری را بازنویسی نمی‌کنند (از ۱۳۹۵ ردیف به «۰ به‌روزرسانی، ۱۶۳ بدون تغییر» رسید) و بار نوشتن روی PostgreSQL که کل برنامه را کند می‌کرد حذف شد |
| پنجرهٔ سینک | هر ۲ دقیقه | بدون تغییر |

> پس از هر تغییر در `nginx.conf`، ابتدا `nginx -t` و سپس یک reload/ری‌استارت تمیز (تسک `NIR Nginx Reload` یا ری‌استارت `NIR Nginx Proxy`) لازم است.


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
