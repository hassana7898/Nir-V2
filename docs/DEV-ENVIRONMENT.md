# محیط توسعه: `dev.artadan.ir` در برابر `app.artadan.ir`

> این سند مرجع رسمی جداسازی محیط توسعه از نرم‌افزار اصلی است. هر تغییری در `dev` نباید به `app` آسیب بزند و
> صحت این ادعا با `psremoting\verify-dev-isolation.ps1` (۲۶ اِسناد / invariant) ماشینی قابل اثبات است.

## ۱. معماری فعلی

| لایه | prod — `app.artadan.ir` | dev — `dev.artadan.ir` | وضعیت |
|---|---|---|---|
| پوشه | `C:\Servers\NIR\app` | `C:\Servers\NIR\dev` | جدا (دایرکتوری واقعی، junction نیست) |
| پروسه اپ | `app\runtime\node.exe` روی `127.0.0.1:3000` | `dev\runtime\node.exe` روی `127.0.0.1:3001` | جدا |
| سوپروایزر | تسک `NIR Production Service` → `RUN-NIR.ps1` | تسک `NIR Dev Service` → `RUN-DEV.ps1` | جدا |
| دیتابیس | `nir_db` | `nir_dev` | دیتابیس جدا روی **یک** اینستنس PG (۱۶.۴، پورت ۵۴۳۲) |
| نقش دیتابیس | `nir_user` (مالک `nir_db`) | `nir_dev_user` (مالک `nir_dev`) | جدا + `CONNECT` متقابل قطع است |
| راز JWT | `JWT_SECRET` مستقل | `JWT_SECRET` مستقل (sha متفاوت) | جدا → توکن‌ها بین دو دامنه کار نمی‌کنند |
| آرتیفکت بیلد | `dist\` (stamp = `prod`) | `dist-dev\` (stamp = `dev`) | جدا |
| اسکریپت استقرار | `psremoting\wb-prod-deploy.ps1` + `DEPLOY-GUARD.ps1` | `psremoting\wb-dev-deploy.ps1` | جدا (هرکدام بیلد جعلی را رد می‌کند) |
| nginx | `C:\Servers\Nginx` (پروسه TLS روی :80/:443) | `C:\Servers\NginxDev` (پروسه مستقل، `127.0.0.1:8081`) | **دو پروسه جدا** |
| watchdog | تسک `NIR Health Check` (هر ۱۰ دقیقه) | تسک `NIR Dev Health` (هر ۱۰ دقیقه) | جدا |
| بکاپ | `BACKUP-NIR.ps1` روزانه + cron داخلی | تسک `NIR Dev Backup` (`nir-dev-backup-*.zip`) | جدا |
| sync باسکول | `NIR Weighbridge Sync Prod` (هر ۲ دقیقه) | `NIR Weighbridge Sync` + کلید `WEIGHBRIDGE_SYNC_ENABLED` | جدا |

**منابع مشترک (آگاهانه):** یک VPS، یک IPv4 عمومی (`194.60.230.236`)، یک اینستنس PostgreSQL، سیستم‌عامل.
دلیل: سرور ۴GB RAM (آزاد ~۷۵۰MB) و ۱۰GB دیسک آزاد دارد و اینستنس دوم PG عملاً RAM کافی ندارد.
پیامد این اشتراک: خرابی/سوءمصرف شدید دیتابیس یا پر شدن دیسک هنوز می‌تواند هر دو محیط را متأثر کند
(رفع کامل فقط با یک VPS جدا برای dev ممکن است).

## ۲. تضمین «دست‌نخوردگی prod» و شعاع انفجار

* `wb-dev-deploy.ps1` قبل و بعد از استقرار، اثرانگشت `app\dist\index.html`، `app\server.cjs` و `app\.env`
  را مقایسه می‌کند و در صورت هر اختلاف **با خطا متوقف می‌شود**.
* بلوک dev در nginx اصلی فقط یک استاب ثابت است: `dev.artadan.ir → 127.0.0.1:8081`.
  همه تنظیم‌های پرخطر dev (تایم‌اوت، هدر، gzip، کش) در `C:\Servers\NginxDev\conf\nginx.conf` است.
* آزمایش واقعی شعاع انفجار (انجام‌شده): پروسه dev-nginx کشته شد →
  `dev.artadan.ir` = **502** و `app.artadan.ir` = **200**؛ سپس watchdog خودکار آن را برگرداند
  (`ACTION=started_dev_nginx` در `dev\logs\health.log`).

## ۳. دستورکارها (Runbook)

```powershell
# --- بیلد و استقرار روی محیط توسعه (prod دست‌نخورده می‌ماند) ---
npm run build:dev                          # خروجی: dist-dev\ (stamp=dev)
.\psremoting\wb-dev-deploy.ps1             # بکاپ + استقرار فقط در C:\Servers\NIR\dev
.\psremoting\wb-dev-deploy.ps1 -SkipBackup
.\psremoting\wb-dev-deploy.ps1 -WhatIf     # فقط نمایش

# --- بیلد و استقرار روی prod (مسیر رسمی) ---
npm run build:weighbridge                  # خروجی: dist\ (stamp=prod)
.\psremoting\DEPLOY-GUARD.ps1              # گارد + تست‌ها + استقرار + گزارش

# --- اثبات جداسازی (باید VERIFY-OK بدهد) ---
.\psremoting\verify-dev-isolation.ps1
.\psremoting\verify-prod-netted.ps1        # صحت گزارش باسکول prod

# --- توقف/فعال‌سازی sync باسکول در dev (بدون اثر روی prod) ---
#   در C:\Servers\NIR\dev\.env مقدار WEIGHBRIDGE_SYNC_ENABLED=false یا true
```

### تغییر تنظیمات nginx
* **dev:** `C:\Servers\NginxDev\conf\nginx.conf` → تست، سپس ری‌استارت فقط تسک/پروسه dev:
  ```powershell
  C:\Servers\NginxDev\nginx.exe -p C:\Servers\NginxDev -c conf\nginx.conf -t
  Stop-ScheduledTask 'NIR Dev Nginx'
  Get-Process nginx | Where-Object { $_.Path -eq 'C:\Servers\NginxDev\nginx.exe' } | Stop-Process -Force
  Start-ScheduledTask 'NIR Dev Nginx'
  ```
* **nginx اصلی (TLS):** با `C:\Servers\NIR\scripts\reload-nginx.ps1` یا `nginx-hard-restart.ps1`.
  ⚠️ سیگنال graceful (`nginx -s reload`) از نشست Administrator رد می‌شود (مستر nginx با SYSTEM اجرا می‌شود) و
  مسیر جایگزین، **همه** پروسه‌های nginx از جمله dev-nginx را ری‌استارت می‌کند. پس از هر ری‌استارت nginx اصلی،
  تسک `NIR Dev Nginx` را فوراً استارت کنید (یا حداکثر ۱۰ دقیقه صبر کنید تا watchdog خودکار انجام دهد).

## ۴. رازها و بازگردانی (Rollback)

| مورد | مسیر |
|---|---|
| رازهای prod (admin/postgres + appDb + jwt) | `C:\Servers\NIR\secrets\nir-credentials.json` |
| رازهای dev (نقش `nir_dev_user`) | `C:\Servers\NIR\secrets\dev-credentials.json` |
| بکاپ روزانه dev (DB + uploads + `.env`) | `C:\Servers\NIR\dev\backups\nir-dev-backup-*.zip` (۷ نسخه) |
| بکاپ استقرار dev | `C:\Servers\NIR\dev\backups\deploy-dev-*` (فایل‌ها + dump `nir_dev`) |
| بکاپ تنظیمات مراحل جداسازی | `dev\backups\isolation-*`، `hardening-*`، `nginx-split-*` |

* بازگردانی دیتابیس dev (بدون هیچ اثر روی `nir_db`):
  `pg_restore -h 127.0.0.1 -U nir_dev_user -d nir_dev --clean --if-exists <dump>`
* اگر لازم شد مالکیت dev به حالت قبل برگردد: `ALTER DATABASE nir_dev OWNER TO nir_user;` سپس GRANTها.

## ۵. نکات مهم و محدودیت‌ها

1. **هرگز `REASSIGN OWNED` روی این کلاستر اجرا نکنید.** این دستور کاتالوگ‌های *shared* را هم تغییر می‌دهد و
   در جریان جداسازی، مالکیت **دیتابیس `nir_db`** را به نقش dev منتقل کرد (و dev می‌توانست به prod وصل شود).
   مالکیت بازگردانده شد (`nir_db` → `nir_user`)؛ `dev-isolate-step1.ps1` اکنون با `ALTER … OWNER TO`
   تک‌تک اشیاء داخل `nir_dev` را منتقل می‌کند و در پایان مالکیت `nir_db` را دوباره بررسی می‌کند.
2. **`PG_BIN` در `.env` نرم‌افزار prod اشتباه است** (`C:\Program Files\PostgreSQL\18\bin` وجود ندارد؛
   کلاینت واقعی `C:\Servers\PostgreSQL\bin` است) یعنی pg_dump/pg_restore داخل نرم‌افزار در prod کار نمی‌کند.
   در dev اصلاح شد؛ اصلاح prod آگاهانه انجام نشد (خواسته: prod دست‌نخورده) و اینجا ثبت می‌شود:
   `PG_BIN=C:\Servers\PostgreSQL\bin`.
3. منبع باسکول (`100.71.164.40 / WEIGHNGDB`) بین دو محیط مشترک است و هر دو هر ۲ دقیقه آن را می‌خوانند
   (read-only با کاربر `artadan_reader`). برای آزمایش‌های سنگین، dev را با `WEIGHBRIDGE_SYNC_ENABLED=false` خاموش کنید.
4. dev و prod روی یک سرور ۴GB با ~۷۵۰MB RAM آزاد هستند؛ بار سنگین dev می‌تواند prod را کند کند.
   `DB_POOL_MAX` در dev به ۸ کاهش یافت. گزینه بلندمدت: VPS جدا برای dev.
5. گواهی‌ها با win-acme تمدید می‌شوند (`dev.artadan.ir` تا ۲۰۲۷-۰۱-۰۶، `app.artadan.ir` تا ۲۰۲۶-۱۲-۱۵).

## ۶. تاریخچه این جداسازی

| زمان | تغییر | ابزار |
|---|---|---|
| ۱۴:۲۰ | نقش `nir_dev_user` + مالکیت `nir_dev` + قطع `CONNECT` متقابل + چرخش `JWT_SECRET` dev + اصلاح `PG_BIN`/`DB_POOL_MAX` | `psremoting\dev-isolate-step1.ps1` |
| ۱۴:۲۵ | بیلد مستقل `dist-dev` + استمپ هدف بیلد + گارد منبع استقرار | `scripts\stamp-build.mjs`، `package.json`، `wb-dev-deploy.ps1`، `wb-prod-deploy.ps1` |
| ۱۴:۲۸ | watchdog و بکاپ اختصاصی dev + کلید sync باسکول + هم‌ترازی نقشه ستون‌ها | `psremoting\dev-harden.ps1` |
| ۱۴:۳۲ | nginx مستقل dev روی 8081 + استاب ثابت در nginx اصلی | `psremoting\dev-nginx-split.ps1` |
| ۱۴:۳۶ | اثبات شعاع انفجار (dev 502 / prod 200) + خودترمیمی watchdog | `dev\logs\health.log` |
| ۱۴:۴۰ | ۲۶ اِسناد جداسازی → VERIFY-OK | `psremoting\verify-dev-isolation.ps1` |
