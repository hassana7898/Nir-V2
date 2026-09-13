import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.error('[NIR SEED ERROR] DATABASE_URL is not set. Please configure DATABASE_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

export async function runSeed() {
  console.log('[NIR SEED] Seeding initial data into PostgreSQL...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Admin User
    const adminCheck = await client.query(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
    if (adminCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 12);
      await client.query(`
        INSERT INTO users (id, username, password_hash, role, full_name)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), 'admin', passwordHash, 'ADMIN', 'مدیر ارشد سیستم']);
      console.log('[NIR SEED] Created default admin user (username: admin, pass: admin123)');
    }

    // 2. Default Factory Settings
    await client.query(`
      INSERT INTO settings (id, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()
    `, [
      'default',
      JSON.stringify({
        factoryName: 'کارخانه خوراک دام و طیور نیر',
        managerName: 'مهندس حسینی',
        phone: '021-88888888',
        address: 'شهرک صنعتی، بلوار صنعت، کارخانه تولید خوراک نیر',
        taxNumber: '14008954321',
        printHeader: 'حواله رسمی شرکت خوراک دام و طیور نیر',
        notes: 'حمل بار منوط به رعایت استانداردهای بهداشتی دامپزشکی می‌باشد.'
      })
    ]);

    // 3. Product Categories
    const categories = [
      { id: randomUUID(), name: 'غلات و دانه‌ها', description: 'ذرت، گندم، جو و سایر غلات' },
      { id: randomUUID(), name: 'کنجاله‌ها و منابع پروتئینی', description: 'کنجاله سویا، کلزا، آفتابگردان' },
      { id: randomUUID(), name: 'مکمل‌ها و ریزمغذی‌ها', description: 'ویتامین‌ها، متیونین، دی‌کلسیم فسفات' },
      { id: randomUUID(), name: 'خوراک آماده و پلت طیور', description: 'دان استارتر، رشد و پایانی' },
    ];

    for (const cat of categories) {
      await client.query(`
        INSERT INTO product_categories (id, name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO NOTHING
      `, [cat.id, cat.name, cat.description]);
    }

    // Get category IDs
    const catRows = await client.query(`SELECT id, name FROM product_categories`);
    const catMap = new Map(catRows.rows.map(r => [r.name, r.id]));

    // 4. Products (Raw materials and Finished Goods)
    const rawMaterials = [
      { id: 'prod-corn', code: 'RM-101', name: 'ذرت برزیل', type: 'raw', categoryId: catMap.get('غلات و دانه‌ها'), unit: 'kg', minStock: 20000, currentStock: 85000 },
      { id: 'prod-soy', code: 'RM-102', name: 'کنجاله سویا آرژانتین', type: 'raw', categoryId: catMap.get('کنجاله‌ها و منابع پروتئینی'), unit: 'kg', minStock: 15000, currentStock: 45000 },
      { id: 'prod-wheat', code: 'RM-103', name: 'گندم دامی', type: 'raw', categoryId: catMap.get('غلات و دانه‌ها'), unit: 'kg', minStock: 10000, currentStock: 30000 },
      { id: 'prod-dcp', code: 'RM-104', name: 'دی‌کلسیم فسفات (DCP)', type: 'raw', categoryId: catMap.get('مکمل‌ها و ریزمغذی‌ها'), unit: 'kg', minStock: 2000, currentStock: 8500 },
      { id: 'prod-oil', code: 'RM-105', name: 'روغن سویا خالص', type: 'raw', categoryId: catMap.get('کنجاله‌ها و منابع پروتئینی'), unit: 'kg', minStock: 3000, currentStock: 12000 },
    ];

    const finishedGoods = [
      { id: 'prod-starter', code: 'FG-201', name: 'دان سوپر استارتر پلت', type: 'finished', categoryId: catMap.get('خوراک آماده و پلت طیور'), unit: 'kg', minStock: 5000, currentStock: 18000 },
      { id: 'prod-grower-1', code: 'FG-202', name: 'دان پیشدان (رشد ۱) پلت', type: 'finished', categoryId: catMap.get('خوراک آماده و پلت طیور'), unit: 'kg', minStock: 8000, currentStock: 24000 },
      { id: 'prod-grower-2', code: 'FG-203', name: 'دان میان‌دان (رشد ۲) پلت', type: 'finished', categoryId: catMap.get('خوراک آماده و پلت طیور'), unit: 'kg', minStock: 10000, currentStock: 32000 },
      { id: 'prod-finisher', code: 'FG-204', name: 'دان پایانی پلت', type: 'finished', categoryId: catMap.get('خوراک آماده و پلت طیور'), unit: 'kg', minStock: 10000, currentStock: 28000 },
    ];

    for (const p of [...rawMaterials, ...finishedGoods]) {
      await client.query(`
        INSERT INTO products (id, code, name, type, category_id, unit, min_stock, current_stock)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          current_stock = EXCLUDED.current_stock
      `, [p.id, p.code, p.name, p.type, p.categoryId, p.unit, p.minStock, p.currentStock]);
    }

    // 5. Warehouses
    const warehouses = [
      { id: randomUUID(), name: 'انبار مرکزی سیلو و غلات', code: 'WH-01', location: 'محوطه غربی کارخانه', capacity: 500000 },
      { id: randomUUID(), name: 'انبار مواد اولیه، کنجاله و مکمل‌ها', code: 'WH-02', location: 'سوله شماره ۲', capacity: 250000 },
      { id: randomUUID(), name: 'انبار محصول نهایی و بارگیری', code: 'WH-03', location: 'سکوی بارگیری خروجی', capacity: 150000 },
    ];

    for (const w of warehouses) {
      await client.query(`
        INSERT INTO warehouses (id, name, code, location, capacity)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO NOTHING
      `, [w.id, w.name, w.code, w.location, w.capacity]);
    }

    // 6. Origins
    const origins = ['بندر امام خمینی (ره)', 'بندر امیرآباد', 'سیلوی مرکزی استان', 'گمرک بازرگان', 'انبار مرکزی پشتیبانی امور دام'];
    for (const origin of origins) {
      await client.query(`
        INSERT INTO origins (id, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `, [randomUUID(), origin]);
    }

    // 7. Drivers
    const drivers = [
      { name: 'علی رضایی', phone: '09121112233', iban: 'IR820170000000123456789001' },
      { name: 'محمد کریمی', phone: '09132223344', iban: 'IR560120000000987654321002' },
      { name: 'حسین صادقی', phone: '09143334455', iban: 'IR190150000000112233445503' },
    ];
    for (const d of drivers) {
      await client.query(`
        INSERT INTO drivers (id, name, phone, iban)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, iban = EXCLUDED.iban
      `, [randomUUID(), d.name, d.phone, d.iban]);
    }

    // 8. Farmers / Customers
    const farmers = [
      {
        id: randomUUID(),
        name: 'مرغداری بهاران (برادران احمدی)',
        phone: '09123456789',
        broods: JSON.stringify([
          { id: randomUUID(), name: 'سالن ۱ - دوره ۴۵', capacity: 25000, breed: 'راس ۳۰۸', startDate: '1403/01/15' },
          { id: randomUUID(), name: 'سالن ۲ - دوره ۳۲', capacity: 20000, breed: 'کاب ۵۰۰', startDate: '1403/02/01' }
        ])
      },
      {
        id: randomUUID(),
        name: 'مجتمع طیور سپیدبال البرز',
        phone: '09128889900',
        broods: JSON.stringify([
          { id: randomUUID(), name: 'فارم A - گله مادر', capacity: 30000, breed: 'راس ۳۰۸', startDate: '1403/01/20' }
        ])
      }
    ];

    for (const f of farmers) {
      await client.query(`
        INSERT INTO farmers (id, name, phone, broods)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `, [f.id, f.name, f.phone, f.broods]);
    }

    await client.query('COMMIT');
    console.log('[NIR SEED] Database seeding completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[NIR SEED ERROR] Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
