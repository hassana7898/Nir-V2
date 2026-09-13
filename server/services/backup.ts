import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getTableColumns } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

// Resolve PostgreSQL client tools (pg_dump/pg_restore). Prefers an explicit
// PG_BIN, then a standard Windows install, then the NIR portable PostgreSQL.
const resolvePgBin = (): string | null => {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  for (const base of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
    try {
      for (const entry of fs.readdirSync(base)) candidates.push(path.join(base, entry, 'bin'));
    } catch { /* ignore */ }
  }
  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'pgsql', 'bin'), path.join(cwd, '..', 'pgsql', 'bin'));
  // NIR server layout: <root>\app\server.cjs with binaries in <root>\..\PostgreSQL
  candidates.push(path.join(cwd, '..', 'PostgreSQL', 'bin'), path.join(cwd, 'PostgreSQL', 'bin'));
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'pg_dump.exe')) || fs.existsSync(path.join(dir, 'pg_dump'))) return dir;
    } catch { /* ignore */ }
  }
  return null;
};

export const pgDumpPath = (): string => {
  const bin = resolvePgBin();
  if (!bin) return 'pg_dump';
  return path.join(bin, fs.existsSync(path.join(bin, 'pg_dump.exe')) ? 'pg_dump.exe' : 'pg_dump');
};

/**
 * Business entities included in an application backup, listed in FOREIGN-KEY
 * DEPENDENCY ORDER. Parents must be restored before children or the restore
 * transaction fails on a foreign-key violation.
 *
 * Intentionally EXCLUDED: `users`, `sessions` (credentials/security) and
 * `sync_mutations` (a transient client-mutation log that must not be replayed).
 */
export const BACKUP_ENTITIES = [
  'product_categories',
  'products',
  'warehouses',
  'farmers',
  'drivers',
  'origins',
  'settings',
  'invoices',
  'formulas',
  'formula_items',
  'batches',
  'production_records',
  'inventory_adjustments',
  'inventory_transactions',
  'logs',
] as const;

export type BackupEntity = (typeof BACKUP_ENTITIES)[number];

const tableMap: Record<BackupEntity, any> = {
  product_categories: schema.product_categories,
  products: schema.products,
  warehouses: schema.warehouses,
  farmers: schema.farmers,
  drivers: schema.drivers,
  origins: schema.origins,
  settings: schema.settings,
  invoices: schema.invoices,
  formulas: schema.formulas,
  formula_items: schema.formula_items,
  batches: schema.batches,
  production_records: schema.production_records,
  inventory_adjustments: schema.inventory_adjustments,
  inventory_transactions: schema.inventory_transactions,
  logs: schema.logs,
};

export interface SnapshotPayload {
  version: string;
  createdAt: string;
  entities: string[];
  tables: Record<string, any[]>;
}

const collectSnapshotTables = async (): Promise<Record<string, any[]>> => {
  const tables: Record<string, any[]> = {};
  for (const entity of BACKUP_ENTITIES) {
    tables[entity] = await db.select().from(tableMap[entity]);
  }
  return tables;
};

/** Full application snapshot used by the Export/Download flow. */
export const exportSnapshot = async (): Promise<SnapshotPayload> => ({
  version: '3.0.0',
  createdAt: new Date().toISOString(),
  entities: [...BACKUP_ENTITIES],
  tables: await collectSnapshotTables(),
});

export const backupDatabase = async (): Promise<{ filePath: string; fileName: string; format: 'sql' | 'json'; sizeBytes: number }> => {
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups'));

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
    const fileName = `backup-${date}.dump`;
    const filePath = path.join(backupDir, fileName);
    const pgDump = pgDumpPath();

    try {
      await new Promise<string>((resolve, reject) => {
        execFile(pgDump, ['-F', 'c', '--no-owner', '--no-privileges', '-f', filePath, process.env.DATABASE_URL as string], (error, _stdout, stderr) => {
          if (error) {
            console.warn(`pg_dump failed (${error.message}), falling back to structured JSON backup`);
            return reject(error);
          }
          if (stderr) console.warn(`pg_dump stderr: ${stderr}`);
          resolve(filePath);
        });
      });
      const stats = fs.statSync(filePath);
      return { filePath, fileName, format: 'sql', sizeBytes: stats.size };
    } catch {
      // Fall through to JSON snapshot backup.
    }
  }

  const jsonFileName = `backup-${date}.json`;
  const jsonFilePath = path.join(backupDir, jsonFileName);

  const snapshot = await exportSnapshot();
  fs.writeFileSync(jsonFilePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  const stats = fs.statSync(jsonFilePath);
  return { filePath: jsonFilePath, fileName: jsonFileName, format: 'json', sizeBytes: stats.size };
};

const isTimestampColumn = (column: any): boolean => {
  if (!column) return false;
  if (column.dataType === 'date') return true;
  return typeof column.columnType === 'string' && column.columnType.startsWith('PgTimestamp');
};

/**
 * A JSON backup stores Date columns as ISO strings. Drizzle expects real Date
 * objects on insert, so timestamps must be revived - otherwise the whole restore
 * fails with "value.toISOString is not a function". Unknown keys are dropped.
 */
const normalizeRow = (table: any, row: Record<string, unknown>): Record<string, unknown> => {
  const columns = getTableColumns(table) as Record<string, any>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const column = columns[key];
    if (!column) continue;
    if (isTimestampColumn(column) && typeof value === 'string' && value !== '') {
      const parsed = new Date(value);
      normalized[key] = Number.isNaN(parsed.getTime()) ? null : parsed;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
};

export interface RestoreReport {
  restoredTables: Record<string, number>;
  skippedTables: string[];
  verifiedCounts: Record<string, number>;
  totalRows: number;
}

/**
 * Restore an application backup.
 *
 * - single transaction: either every entity is restored or nothing is (no
 *   "products came back but invoices did not" partial state);
 * - parents before children (see BACKUP_ENTITIES);
 * - upsert by primary key, so IDs and every foreign-key relationship survive;
 * - precise errors naming the failing entity/record;
 * - post-restore row counts are returned for verification.
 */
export const restoreDatabase = async (backupData: any): Promise<RestoreReport> => {
  const tables = backupData && typeof backupData === 'object' ? backupData.tables : undefined;
  if (!tables || typeof tables !== 'object') {
    throw new Error('فایل پشتیبان معتبر نیست: بخش «tables» یافت نشد. از فایل خروجی خود NIR استفاده کنید.');
  }

  const restoredTables: Record<string, number> = {};
  const skippedTables: string[] = [];
  let totalRows = 0;

  await db.transaction(async (tx: any) => {
    for (const entity of BACKUP_ENTITIES) {
      const rows = (tables as Record<string, unknown>)[entity];
      if (rows === undefined || rows === null) {
        skippedTables.push(entity);
        continue;
      }
      if (!Array.isArray(rows)) {
        throw new Error(`ساختار جدول «${entity}» در فایل پشتیبان نامعتبر است.`);
      }
      if (rows.length === 0) {
        restoredTables[entity] = 0;
        continue;
      }

      const table = tableMap[entity];
      for (const row of rows as Record<string, unknown>[]) {
        try {
          const values = normalizeRow(table, row);
          await tx.insert(table).values(values).onConflictDoUpdate({ target: table.id, set: values });
        } catch (error: any) {
          const id = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;
          throw new Error(`بازیابی جدول «${entity}» ناموفق بود (رکورد ${String(id ?? '?')}): ${error?.message || error}`, { cause: error });
        }
      }
      restoredTables[entity] = (rows as unknown[]).length;
      totalRows += (rows as unknown[]).length;
    }
  });

  const verifiedCounts: Record<string, number> = {};
  for (const entity of BACKUP_ENTITIES) {
    const rows: any[] = await db.select({ id: tableMap[entity].id }).from(tableMap[entity]);
    verifiedCounts[entity] = rows.length;
  }

  return { restoredTables, skippedTables, verifiedCounts, totalRows };
};
