/**
 * Weighbridge background worker (باسکول توزین نگار).
 *
 * Reads the newest rows of the factory SQL Server `WEIGHNGDB.dbo.WeightTable` and upserts them
 * into PostgreSQL `weighbridge_records`, keyed by `external_id` (the SQL Server primary key), so
 * running it repeatedly is idempotent.
 *
 * Design constraints (they matter operationally):
 *  - It is bundled to a single self-contained file (dist/weighbridge-worker.cjs) because the
 *    server has no node_modules and no npm: `npm run build:worker`.
 *  - It must NEVER crash the schedule: every failure path is caught, logged and turned into
 *    exit code 0, because a non-zero exit would make the Scheduled Task show an error and the
 *    weighbridge being offline is a normal, expected condition.
 *  - Column names are DISCOVERED from INFORMATION_SCHEMA on every run (the vendor schema is not
 *    documented) and can be overridden with WEIGHBRIDGE_COLUMN_MAP.
 *
 * Env: WEIGHBRIDGE_HOST/PORT/DB/USER/PASS, optional TABLE (default WeightTable),
 * SCHEMA (default dbo), BATCH (default 300), LOOKBACK_HOURS (default 72),
 * COLUMN_MAP (JSON), DATABASE_URL (PostgreSQL, read from .env).
 */
import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

type ColumnMap = {
  externalId?: string;
  ticketNumber?: string;
  plateNumber?: string;
  driverName?: string;
  carrierCompany?: string;
  /** نام مشتری as recorded by the weighing software (`CustomerName`). */
  customerName?: string;
  grossWeight?: string;
  tareWeight?: string;
  netWeight?: string;
  weighTime?: string;
  direction?: string;
  goods?: string;
  remittanceNumber?: string;
};

/** The weighing software's own in/out flag, normalised to what the app stores. */
type Direction = 'entry' | 'exit' | 'unknown';

/**
 * ورودی / خروجی  ->  entry | exit | unknown.
 * Persian spellings (with or without the ی/ي or و/ب spelling variants) and Latin words are both
 * accepted, so a flag we have never seen becomes «unknown» rather than being silently guessed.
 */
const resolveDirection = (raw: string | null | undefined): Direction => {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[\u064A]/g, '\u06CC') // ي -> ی
    .replace(/\s+/g, '');
  if (!s) return 'unknown';
  if (/(in|inward|import|enter|entry|purchase|input|ورود|وارده|ورودي|خرید|ورودی|داخلی)/.test(s)) return 'entry';
  if (/(out|outward|export|exit|sale|sales|output|خروج|خارجه|خروجی|خروحي|فروش|بیرونی|خارجی)/.test(s)) return 'exit';
  return 'unknown';
};

const cfg = {
  host: (process.env.WEIGHBRIDGE_HOST || '').trim(),
  port: Number(process.env.WEIGHBRIDGE_PORT || 1433),
  database: (process.env.WEIGHBRIDGE_DB || 'WEIGHNGDB').trim(),
  user: (process.env.WEIGHBRIDGE_USER || '').trim(),
  password: process.env.WEIGHBRIDGE_PASS || '',
  table: (process.env.WEIGHBRIDGE_TABLE || 'WeightTable').trim(),
  schema: (process.env.WEIGHBRIDGE_SCHEMA || 'dbo').trim(),
  batch: Math.max(1, Math.min(5000, Number(process.env.WEIGHBRIDGE_BATCH || 300))),
  lookbackHours: Math.max(1, Math.min(24 * 60, Number(process.env.WEIGHBRIDGE_LOOKBACK_HOURS || 72))),
  connectTimeoutMs: Number(process.env.WEIGHBRIDGE_CONNECT_TIMEOUT_MS || 15000),
  requestTimeoutMs: Number(process.env.WEIGHBRIDGE_REQUEST_TIMEOUT_MS || 20000),
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  logDir: (process.env.WEIGHBRIDGE_LOG_DIR || path.join(process.cwd(), 'logs')).trim(),
};

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const VERBOSE = ARGS.includes('--verbose') || ARGS.includes('-v');

const started = Date.now();
let logFile = '';
try {
  fs.mkdirSync(cfg.logDir, { recursive: true });
  logFile = path.join(cfg.logDir, 'weighbridge-worker.log');
  // keep the log bounded without an extra dependency
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
    fs.writeFileSync(logFile, `--- log rotated at ${new Date().toISOString()} ---\r\n`, 'utf8');
  }
} catch {
  logFile = '';
}

const log = (message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\r\n', 'utf8');
    } catch {
      /* logging must never break the run */
    }
  }
};

const debug = (message: string) => {
  if (VERBOSE) log(message, 'INFO');
};

/** SQL Server connections that are unreachable are the normal case when the scale is off. */
const describeError = (error: any): string => {
  const code = error?.code || error?.name || '';
  const msg = error?.message || String(error);
  return code ? `${code}: ${msg}` : msg;
};

/* ------------------------------------------------- column discovery (no fixed vendor schema) */

const tokenMatch = (column: string, tokens: string[]): number => {
  const c = column.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  let best = 0;
  for (const t of tokens) {
    if (c === t) best = Math.max(best, 100);
    else if (c.includes(t)) best = Math.max(best, 50 + Math.min(t.length, 10));
  }
  return best;
};

const PRIORITY: Array<[keyof ColumnMap, string[], string]> = [
  ['plateNumber', ['truckno', 'plaque', 'plate', 'pelak', 'plakenumber', 'plateno', 'vehicle', 'car', 'truck'], 'پلاک'],
  ['ticketNumber', ['ticket', 'ticketno', 'ticketnumber', 'billno', 'billnumber', 'receipt', 'ghabz', 'serial', 'docno', 'bon'], 'شماره قبض'],
  ['driverName', ['drivername', 'driver', 'ranande', 'ranandeh', 'driv'], 'راننده'],
  ['customerName', ['customername', 'customer', 'moshtari', 'buyer', 'client', 'hesab'], 'مشتری'],
  ['carrierCompany', ['carrier', 'company', 'sharkat', 'transportcompany', 'transporter', 'forwarder'], 'شرکت حمل'],
  ['grossWeight', ['gross', 'grossweight', 'firstweight', 'weight1', 'vazn1', 'entranceweight', 'inweight', 'fullweight'], 'وزن پر'],
  ['tareWeight', ['tare', 'tareweight', 'secondweight', 'weight2', 'vazn2', 'exitweight', 'outweight', 'emptyweight'], 'وزن خالی'],
  ['netWeight', ['net', 'netweight', 'netto', 'khales', 'weightnet'], 'وزن خالص'],
  ['weighTime', ['datefull', 'fulldate', 'firstweighdate', 'weightdate', 'weighingdate', 'dateweight', 'weighdate', 'datetime', 'date', 'time', 'tarikh', 'createdat', 'regdate', 'insertdate'], 'زمان توزین'],
  ['direction', ['inoutflag', 'inout', 'direction', 'ioflag', 'vazn', 'inouttype', 'inoutkind', 'flag', 'state', 'transdir'], 'ورود/خروج'],
  ['goods', ['goods', 'producttype', 'noekala', 'kala', 'kalatype', 'product', 'material', 'commodity'], 'نوع کالا'],
  ['remittanceNumber', ['shomarehavale', 'shomarehavaleh', 'havaleh', 'havale', 'remittance', 'remittanceno', 'billoflading'], 'شماره حواله'],
  ['externalId', ['weightid', 'weightno', 'recordid', 'rowid', 'id', 'counter', 'no', 'serialnumber'], 'شناسه خارجی'],
];

/**
 * Columns of the factory scale (`WEIGHNGDB.dbo.WeightTable`) that must be trusted verbatim when
 * they exist: the fuzzy discovery below can tie two columns (e.g. `DateFull` vs a plain `Date`, or
 * `InOutFlag` vs the numeric `flag`) and pick the wrong one, which silently corrupts the direction
 * and the weighing time. These names are pinned on purpose.
 */
const PINNED_COLUMNS: Partial<Record<keyof ColumnMap, string[]>> = {
  externalId: ['ID'],
  remittanceNumber: ['ShomareHavale'],
  plateNumber: ['TruckNo'],
  driverName: ['DriverName'],
  customerName: ['CustomerName'],
  goods: ['Goods'],
  grossWeight: ['WeightFull'],
  tareWeight: ['WeightEmpty'],
  netWeight: ['NetWeight'],
  weighTime: ['DateFull'],
  direction: ['InOutFlag'],
};

/** Force the well-known scale columns (when present) over the fuzzy match. */
const pinColumns = (map: ColumnMap, columns: string[]) => {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const [field, names] of Object.entries(PINNED_COLUMNS) as Array<[keyof ColumnMap, string[]]>) {
    for (const name of names) {
      const hit = lower.get(name.toLowerCase());
      if (hit) {
        (map as any)[field] = hit;
        break;
      }
    }
  }
  return map;
};

/** Pick the most plausible column per field, never reusing the same column twice. */
const discoverColumns = (columns: string[], primaryKeys: string[]): ColumnMap => {
  const map: ColumnMap = {};
  const used = new Set<string>();
  if (primaryKeys.length) {
    const pk = columns.find((c) => c.toLowerCase() === primaryKeys[0].toLowerCase());
    if (pk) {
      map.externalId = pk;
      used.add(pk);
    }
  }
  for (const [field, tokens] of PRIORITY) {
    if (map[field]) continue;
    let best: { col: string; score: number } | null = null;
    for (const col of columns) {
      if (used.has(col)) continue;
      const score = tokenMatch(col, tokens);
      if (score > 0 && (!best || score > best.score)) best = { col, score };
    }
    if (best) {
      map[field] = best.col;
      used.add(best.col);
    }
  }
  return map;
};

const logColumnMap = (map: ColumnMap) => {
  const parts = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  log(`ستون‌های شناسایی‌شده: ${parts.join(', ') || '(هیچ)'}`);
};

/* ------------------------------------------------------------------- PostgreSQL upsert */

/**
 * Every `weighbridge_records` column the worker owns, in bind order, paired with the value it takes
 * from the payload. The statement is assembled from THIS list, so a column can never be bound twice
 * or left out (the old hand-written `VALUES ($1..$11, NOW(), NOW(), NOW())` had 14 expressions for
 * 15 columns, which made `raw_payload` receive `NOW()` and broke the INSERT outright).
 *
 * `goods` / `remittance_number` are optional on purpose: an older database may not have them yet, so
 * they are dropped from the statement when `information_schema` says the column is missing.
 */
const RECORD_COLUMNS: Array<{ column: string; optional?: boolean; value: (p: any) => unknown }> = [
  { column: 'external_id', value: (p) => p.externalId },
  { column: 'ticket_number', value: (p) => p.ticketNumber },
  { column: 'plate_number', value: (p) => p.plateNumber },
  { column: 'driver_name', value: (p) => p.driverName },
  { column: 'carrier_company', value: (p) => p.carrierCompany },
  { column: 'gross_weight', value: (p) => p.grossWeight },
  { column: 'tare_weight', value: (p) => p.tareWeight },
  { column: 'net_weight', value: (p) => p.netWeight },
  { column: 'weigh_time', value: (p) => p.weighTime },
  { column: 'direction', value: (p) => p.direction },
  { column: 'source', value: (p) => p.source },
  { column: 'raw_payload', value: (p) => (p.raw ? JSON.stringify(p.raw) : null) },
  { column: 'goods', optional: true, value: (p) => p.goods },
  { column: 'remittance_number', optional: true, value: (p) => p.remittanceNumber },
  { column: 'customer_name', optional: true, value: (p) => p.customerName },
];

/** Columns that exist on the target table (so the INSERT never references a missing column). */
const availableColumns = async (client: any): Promise<Set<string>> => {
  try {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'weighbridge_records'`
    );
    return new Set((res.rows || []).map((r: any) => String(r.column_name).toLowerCase()));
  } catch {
    return new Set(); // empty set -> fall back to every column (statement then reports the real error)
  }
};

/**
 * Build the idempotent upsert for exactly the columns that exist.
 *
 * ON CONFLICT (external_id) DO UPDATE refreshes every imported field — including `weigh_time`, which
 * is what repairs rows written before the wall-clock (CONVERT/text) fix: the next sync simply
 * overwrites the shifted value with the correct Tehran digits. `status` and `mapped_remittance_id`
 * are deliberately NOT in the SET list, so a re-sync can never unlink a ticket from its invoice.
 */
const buildUpsert = (existing: Set<string>) => {
  const cols = RECORD_COLUMNS.filter((c) => !c.optional || existing.size === 0 || existing.has(c.column));
  const names = cols.map((c) => c.column);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const settable = names.filter((c) => c !== 'external_id');
  const sets = settable.map((c) => {
    if (c === 'direction') {
      // A direction the operator edited by hand (direction_locked) survives every re-sync; the
      // flag-derived value is only used while the ticket is still untouched by the user.
      return `direction = CASE WHEN weighbridge_records.direction_locked THEN weighbridge_records.direction WHEN EXCLUDED.direction IS NULL OR EXCLUDED.direction = 'unknown' THEN weighbridge_records.direction ELSE EXCLUDED.direction END`;
    }
    if (c === 'goods' || c === 'remittance_number') {
      return `${c} = COALESCE(EXCLUDED.${c}, weighbridge_records.${c})`;
    }
    return `${c} = EXCLUDED.${c}`;
  });
  const compareCols = names.filter((c) => c !== 'external_id' && c !== 'direction');
  // Skip the write entirely when nothing about the row actually changed: re-writing all 1,400+
  // tickets every two minutes produced megabytes of write churn (dead tuples + WAL) that slowed the
  // whole database down. `IS DISTINCT FROM` also handles NULLs correctly.
  const distinctGuard = compareCols.length
    ? `WHERE (${compareCols.map((c) => `weighbridge_records.${c}`).join(', ')}) IS DISTINCT FROM (${compareCols.map((c) => `EXCLUDED.${c}`).join(', ')})`
    : '';
  const text = `
INSERT INTO weighbridge_records
  (${names.join(', ')}, last_synced_at, created_at, updated_at)
VALUES (${placeholders.join(', ')}, NOW(), NOW(), NOW())
ON CONFLICT (external_id) DO UPDATE SET
  ${sets.join(',\n  ')},
  last_synced_at = NOW(),
  updated_at = NOW()
${distinctGuard}
RETURNING (xmax = 0) AS inserted
`;
  return {
    text,
    params: (p: any) => cols.map((c) => c.value(p)),
  };
};

const toWeight = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
};

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s === '' ? null : s;
};

/**
 * Normalise a date/time value to the vendor's exact wall-clock digits `YYYY-MM-DD HH:MM:SS[.mmm]`
 * and return it as a STRING (never a `Date`).
 *
 * The SQL Server `datetime` columns hold the operator's local clock with no timezone. Reading them
 * through CONVERT(...,126) yields that exact text; converting it to a JS `Date` and letting node-pg
 * serialise it would re-apply the server's timezone and shift the hour (±3:30), which is the bug the
 * user reported. Storing the digits verbatim into the `timestamp without time zone` column keeps them
 * stable, and the UI prints them straight through.
 */
const toWallClock = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    // Should not happen (the SELECT reads dates as text), but never shift the digits through UTC.
    const p = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}.${String(value.getMilliseconds()).padStart(3, '0')}`;
  }
  const s = String(value).trim();
  if (s === '') return null;
  // CONVERT(varchar, col, 126) already returns the vendor's own wall clock: keep it VERBATIM and
  // only strip a trailing zone marker if some driver still appended one.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
  return null;
};

const main = async () => {
  log(`=== weighbridge sync start ${DRY_RUN ? '(dry-run) ' : ''}host=${cfg.host || '(missing)'} db=${cfg.database} table=${cfg.schema}.${cfg.table} ===`);

  if (!cfg.host || !cfg.user) {
    log('WEIGHBRIDGE_HOST / WEIGHBRIDGE_USER تنظیم نشده است - همگام‌سازی انجام نشد.', 'ERROR');
    return;
  }
  if (!cfg.databaseUrl) {
    log('DATABASE_URL تنظیم نشده است - همگام‌سازی انجام نشد.', 'ERROR');
    return;
  }

  // Lazy dynamic imports: the worker must still start (and log) when a dependency is unavailable.
  let sql: any;
  let pg: any;
  try {
    sql = await import('mssql');
    pg = await import('pg');
  } catch (error: any) {
    log(`کتابخانه لازم بارگذاری نشد (${describeError(error)}) - همگام‌سازی انجام نشد.`, 'ERROR');
    return;
  }

  /* ---------- 1) SQL Server ---------- */
  let sourceRows: any[] = [];
  let columns: string[] = [];
  let map: ColumnMap = {};
  let pool: any = null;
  try {
    pool = await new sql.ConnectionPool({
      server: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeout: cfg.connectTimeoutMs,
      requestTimeout: cfg.requestTimeoutMs,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 2, min: 0, idleTimeoutMillis: 5000 },
    }).connect();

    const meta = await pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${cfg.table}' AND TABLE_SCHEMA = '${cfg.schema}' ORDER BY ORDINAL_POSITION`
    );
    columns = (meta.recordset || []).map((r: any) => String(r.COLUMN_NAME));
    // Remember each column's SQL type so date/time columns can be read as plain wall-clock text.
    const dataTypes: Record<string, string> = {};
    for (const r of meta.recordset || []) dataTypes[String(r.COLUMN_NAME).toLowerCase()] = String(r.DATA_TYPE).toLowerCase();
    const dateTimeColumns = new Set(
      Object.keys(dataTypes).filter((c) => ['datetime', 'smalldatetime', 'datetime2', 'datetimeoffset', 'date'].includes(dataTypes[c]))
    );
    if (columns.length === 0) {
      log(`جدول ${cfg.schema}.${cfg.table} در دیتابیس ${cfg.database} پیدا نشد (یا دسترسی خواندن ندارد).`, 'ERROR');
      return;
    }
    debug(`ستون‌های موجود: ${columns.join(', ')}`);

    let primaryKeys: string[] = [];
    try {
      const pk = await pool.request().query(
        `SELECT kcu.COLUMN_NAME AS c FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         WHERE tc.TABLE_NAME = '${cfg.table}' AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`
      );
      primaryKeys = (pk.recordset || []).map((r: any) => String(r.c));
      debug(`کلید اصلی: ${primaryKeys.join(', ') || '(نامشخص)'}`);
    } catch (error: any) {
      debug(`خواندن کلید اصلی ناموفق بود: ${describeError(error)}`);
    }

    map = pinColumns(discoverColumns(columns, primaryKeys), columns);
    if (process.env.WEIGHBRIDGE_COLUMN_MAP) {
      try {
        const override = JSON.parse(process.env.WEIGHBRIDGE_COLUMN_MAP);
        const applied: string[] = [];
        for (const [k, v] of Object.entries(override)) {
          if (columns.some((c) => c.toLowerCase() === String(v).toLowerCase())) {
            (map as any)[k] = columns.find((c) => c.toLowerCase() === String(v).toLowerCase());
            applied.push(`${k}=${v}`);
          } else {
            log(`ستون override «${v}» برای ${k} در جدول وجود ندارد - نادیده گرفته شد.`, 'WARN');
          }
        }
        if (applied.length) log(`override ستون‌ها اعمال شد: ${applied.join(', ')}`);
      } catch (error: any) {
        log(`WEIGHBRIDGE_COLUMN_MAP نامعتبر است: ${describeError(error)}`, 'WARN');
      }
    }
    logColumnMap(map);

    if (!map.externalId) {
      log('ستون شناسه (external_id) مشخص نشد - همگام‌سازی انجام نشد. با WEIGHBRIDGE_COLUMN_MAP مشخص کنید.', 'ERROR');
      return;
    }

    const orderBy = `[${map.externalId}] DESC`;
    const tableRef = `[${cfg.database}].[${cfg.schema}].[${cfg.table}]`;
    const since = new Date(Date.now() - cfg.lookbackHours * 3600 * 1000);
    // Read every date/time column as plain wall-clock TEXT (style 126, no timezone) via CONVERT, so
    // the mssql driver never re-interprets the vendor's local clock in the server's zone and shifts
    // the hour. Everything else is selected as-is.
    const selectCols = columns
      .map((c) => (dateTimeColumns.has(c.toLowerCase()) ? `CONVERT(varchar(33), [${c}], 126) AS [${c}]` : `[${c}]`))
      .join(', ');
    let query = `SELECT TOP ${cfg.batch} ${selectCols} FROM ${tableRef}`;
    if (map.weighTime) {
      query += ` WHERE [${map.weighTime}] >= @since`;
    }
    query += ` ORDER BY ${orderBy}`;

    const req = pool.request();
    if (map.weighTime) req.input('since', sql.DateTime, since);
    const result = await req.query(query);
    sourceRows = result.recordset || [];
    log(`از SQL Server خوانده شد: ${sourceRows.length} ردیف (پنجره ${cfg.lookbackHours} ساعت، سقف ${cfg.batch})`);
  } catch (error: any) {
    log(`اتصال/خواندن از سیستم باسکول ناموفق بود: ${describeError(error)}`, 'ERROR');
    log('این خطا مدیریت شد؛ برنامه متوقف نمی‌شود و در اجرای بعدی دوباره تلاش می‌کند.', 'WARN');
    return;
  } finally {
    try {
      if (pool) await pool.close();
    } catch {
      /* ignore */
    }
  }

  /* ---------- 2) PostgreSQL upsert ---------- */
  const client = new pg.Client({ connectionString: cfg.databaseUrl, connectionTimeoutMillis: 10000 });
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  try {
    await client.connect();
    // Keep «حواله / مغایرت» honest: a ticket whose invoice was deleted (or unlinked) elsewhere is
    // freed here, so the weighbridge screen can never claim it is still assigned.
    try {
      const freed = await client.query(
        `UPDATE weighbridge_records
            SET status = 'unmapped', mapped_remittance_id = NULL, previous_weight_value = NULL, updated_at = NOW()
          WHERE mapped_remittance_id IS NOT NULL
            AND mapped_remittance_id NOT IN (SELECT id FROM invoices WHERE deleted_at IS NULL)`
      );
      if (freed.rowCount) log(`تخصیص ${freed.rowCount} قبض که حواله‌اش حذف/جدا شده بود آزاد شد.`, 'WARN');
    } catch (error: any) {
      log(`آشتی‌سازی تخصیص‌های یتیم ناموفق بود: ${describeError(error)}`, 'WARN');
    }
    const upsert = buildUpsert(await availableColumns(client));
    for (const row of sourceRows) {
      const externalId = Number(row[map.externalId as string]);
      if (!Number.isFinite(externalId)) {
        skipped += 1;
        continue;
      }
      const gross = map.grossWeight ? toWeight(row[map.grossWeight]) : null;
      const tare = map.tareWeight ? toWeight(row[map.tareWeight]) : null;
      let net = map.netWeight ? toWeight(row[map.netWeight]) : null;
      // «خالص‌شده» needs BOTH weighings — mirror of the server's NETTED_SQL.
      //
      // WHY: the weighing software opens a ticket at the FIRST weighing and leaves the other column at 0
      // (`وزن پر` filled ⇒ «وزن خالی» = 0, and vice versa). The old code recomputed a missing net as
      // `gross - 0` = the gross, so a truck that had been weighed only once was stored with a full load
      // as «وزن خالص» (26,360 kg for ticket 3593) and looked netted everywhere. Now:
      //   * both weights present ⇒ the net is recomputed when the vendor left it 0 (a loaded truck is
      //     never 0 kg), so a late NetWeight column never hides a completed ticket;
      //   * a weighing missing ⇒ the net stays UNKNOWN (null, never `gross - 0`), so the ticket is
      //     correctly counted as «در انتظار توزین دوم» instead of inventing a weight;
      //   * a positive vendor net with a weighing missing is kept (the software knows better than we do),
      //     and the report's both-weighings rule still shows the ticket as pending.
      const bothWeights = gross !== null && gross > 0 && tare !== null && tare > 0;
      if (bothWeights) {
        if ((net === null || net === 0) && gross !== tare) {
          net = Math.round((gross - tare) * 1000) / 1000;
        }
      } else if (net === null || net <= 0) {
        net = null;
      }

      const payload = {
        externalId,
        ticketNumber: map.ticketNumber ? toText(row[map.ticketNumber]) : null,
        plateNumber: map.plateNumber ? toText(row[map.plateNumber]) : null,
        driverName: map.driverName ? toText(row[map.driverName]) : null,
        carrierCompany: map.carrierCompany ? toText(row[map.carrierCompany]) : null,
        grossWeight: gross,
        tareWeight: tare,
        netWeight: net,
        // The vendor stores wall-clock local time; store the exact digits as text (never a Date) so
        // node-pg never re-applies the server timezone and shifts the hour.
        weighTime: map.weighTime ? toWallClock(row[map.weighTime]) : null,
        // The weighing software's own in/out flag, normalised to entry/exit/unknown.
        directionRaw: map.direction ? toText(row[map.direction]) : null,
        // The weighing software's own flag always wins («ورودی» ⇒ ورود — it STAYS entry even when
        // the ticket is netted); only a ticket with NO flag whose NET weight is known defaults to
        // خروج (the operator's rule).
        direction: (() => {
          const flagDir = resolveDirection(map.direction ? toText(row[map.direction]) : null);
          if (flagDir !== 'unknown') return flagDir;
          return net !== null && net > 0 ? 'exit' : 'unknown';
        })(),
        goods: map.goods ? toText(row[map.goods]) : null,
        customerName: map.customerName ? toText(row[map.customerName]) : null,
        remittanceNumber: map.remittanceNumber ? toText(row[map.remittanceNumber]) : null,
        source: `${cfg.database}.${cfg.schema}.${cfg.table}`,
        raw: row,
      };

      if (DRY_RUN) {
        log(`[dry-run] ${externalId} | ${payload.plateNumber || '-'} | ${payload.driverName || '-'} | کالا=${payload.goods || '-'} | حواله=${payload.remittanceNumber || '-'} | net=${net ?? '-'} | ${payload.weighTime || '-'} | ${payload.direction}`);
        continue;
      }

      const res = await client.query(upsert.text, upsert.params(payload));
      if (!res.rows || res.rows.length === 0) unchanged += 1; // nothing changed -> the write was skipped
      else if (res.rows[0].inserted) inserted += 1;
      else updated += 1;
    }
    log(`PostgreSQL: ${inserted} جدید، ${updated} به‌روزرسانی، ${unchanged} بدون تغییر${skipped ? `، ${skipped} نامعتبر` : ''}${DRY_RUN ? ' (dry-run: چیزی نوشته نشد)' : ''}`);
  } catch (error: any) {
    log(`نوشتن در PostgreSQL ناموفق بود: ${describeError(error)}`, 'ERROR');
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }

  log(`=== weighbridge sync end (${Date.now() - started} ms) ===`);
};

/* --------------------------------------------------------------------- entry point */

// A scale that is switched off must never look like a crashed job: every failure is logged and
// the process still exits 0.
process.on('unhandledRejection', (reason: any) => log(`unhandledRejection: ${describeError(reason)}`, 'ERROR'));
process.on('uncaughtException', (error: any) => log(`uncaughtException: ${describeError(error)}`, 'ERROR'));

/**
 * Run only when the bundle is executed (the Scheduled Task). Requiring the bundle from a test must
 * not start a sync — it only needs the pure helpers (`buildUpsert`, `toWallClock`, ...).
 */
const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  main()
    .catch((error: any) => log(`اجرای ورکر با خطای مدیریت‌شده پایان یافت: ${describeError(error)}`, 'ERROR'))
    .finally(() => process.exit(0));
}

// Exported for tests / ad-hoc inspection of the generated statement (never used by the sync itself).
if (typeof module !== 'undefined' && (module as any).exports) {
  Object.assign((module as any).exports, { buildUpsert, availableColumns, toWallClock, resolveDirection, RECORD_COLUMNS });
}


