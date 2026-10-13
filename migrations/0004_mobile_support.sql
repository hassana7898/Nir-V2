-- 0004_mobile_support.sql
-- NIR Multi-Role Mobile Application Support (Driver / Farmer / Manager)
-- Idempotent additive schema migration (safe to execute multiple times)

-- کدهای یکبارمصرف پیامکی
CREATE TABLE IF NOT EXISTS otp_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(15) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

-- توکن‌های پوش‌نوتیفیکیشن
CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL, -- 'android' | 'ios'
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- رسیدهای تحویل بار راننده (Proof of Delivery)
CREATE TABLE IF NOT EXISTS delivery_proofs (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  driver_id TEXT REFERENCES drivers(id),
  photo_bill_url TEXT,
  photo_scale_url TEXT,
  signature_url TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  delivered_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_invoice ON delivery_proofs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_driver ON delivery_proofs(driver_id);

-- سفارش‌های جیره ثبت‌شده توسط مرغداران
CREATE TABLE IF NOT EXISTS farmer_orders (
  id SERIAL PRIMARY KEY,
  farmer_id TEXT REFERENCES farmers(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  requested_weight NUMERIC(12, 2) NOT NULL,
  target_date VARCHAR(10) NOT NULL, -- تاریخ شمسی YYYY/MM/DD
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'completed'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_farmer ON farmer_orders(farmer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON farmer_orders(status);

-- اتصال اکانت کاربران به رانندگان و مرغداران
ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_id TEXT REFERENCES drivers(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS farmer_id TEXT REFERENCES farmers(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(15);
CREATE INDEX IF NOT EXISTS idx_users_driver ON users(driver_id);
CREATE INDEX IF NOT EXISTS idx_users_farmer ON users(farmer_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
