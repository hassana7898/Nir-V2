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

- **قرارداد تاریخ حوالهها: ISO میلادی** (`2026-10-10`) — همه‌ی صفحات روز را با `date === formatToISODate(selectedDay)` تطبیق می‌دهند و UI آن را **شمسی** نشان می‌دهد (`shared/jalali.ts`).
  ردیف‌های تاریخی ممکن است شمسی (`1405/07/18`) باشند؛ کدها هر دو را می‌خوانند و ورودی‌های شمسی در سمت سرور به ISO تبدیل می‌شوند
  (`isoInvoiceDate` در `server/routes/weighbridge.ts`) تا حواله‌ی ساخته‌شده از قبض باسکول در همان روز دیده شود.
- **`weigh_time`** یک `timestamp` بدون منطقه است و **عین ارقام باسکول** ذخیره می‌شود (بدون تبدیل).
- `raw_payload` کل رکورد باسکول را نگه می‌دارد (منبع حقیقت برای بازسازی/عیب‌یابی مثل `Destination`, `CustomerName`, `BillOfLading`).
- حذف‌ها **نرم** (`deleted_at`) هستند؛ گزارش‌ها/لیست‌ها ردیف‌های حذف‌شده را کنار می‌گذارند.

## پشتیبان‌گیری

- از داخل نرم‌افزار: ماژول بکاپ (`/api/backup`) با `pg_dump`/`pg_restore` (مسیر `PG_BIN`).
- از سرور: تسک «NIR Daily Backup» + اسکریپت‌های `BACKUP-NIR.ps1` / `RESTORE-NIR.ps1`.
- **قبل از هر تغییر اسکیما/انتشار**، بکاپ دستی گرفته می‌شود (نمونه: `C:\Servers\NIR\app\backups\…`).
