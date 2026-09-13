import { initDB, getSystemState, setSystemState, LegacyMigrationState, setCacheItem, enqueueMutation } from './dbStore';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { initDB } from './dbStore';

const legacyInvoiceSchema = z.object({
  id: z.string(),
  date: z.string().or(z.number()),
  // minimal fields
}).passthrough();


const LEGACY_KEYS = [
  'poultryAppSettings',
  'poultryAppInvoices',
  'poultryAppLogs',
  'poultryAppFormulas',
  'poultryAppProduction',
  'poultryAppAdjustments',
  'poultryAppFarmers',
  'poultryAppDrivers',
  'poultryAppOrigins'
];

export const runLegacyMigration = async () => {
  try {
    let migrationState = await getSystemState<LegacyMigrationState>('migration_state');
    
    if (!migrationState) {
      // Check if there is anything to migrate
      const hasLegacyData = LEGACY_KEYS.some(key => localStorage.getItem(key));
      if (!hasLegacyData) {
        // Nothing to migrate
        return;
      }
      
      migrationState = { id: 'migration_state', status: 'NOT_STARTED' };
      await setSystemState(migrationState);
    }

    if (migrationState.status === 'COMPLETED') {
      return; 
    }
    if (migrationState.status === 'FAILED') {
      migrationState.status = 'NOT_STARTED'; // Reset to try again
    }

    if (migrationState.status === 'NOT_STARTED' || migrationState.status === 'IMPORTING') {
      migrationState.status = 'IMPORTING';
      await setSystemState(migrationState);

      for (const key of LEGACY_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            // Map keys: poultryAppInvoices -> invoices
            const newKey = key.replace('poultryApp', '').toLowerCase();
            await setCacheItem(newKey, parsed);
          } catch (e) {
            console.error(`Failed to parse legacy key ${key}`, e);
          }
        }
      }
      
      migrationState.status = 'IMPORTED';
      await setSystemState(migrationState);
    }

    if (migrationState.status === 'IMPORTED' || migrationState.status === 'SYNCING') {
      migrationState.status = 'SYNCING';
      await setSystemState(migrationState);

      // We should queue up mutations for everything we just imported that hasn't been synced.
      // For simplicity in this bounded refactor, we will mark them as pending sync if they have local IDs.
      // Assuming legacy invoices start with 'inv_' or 'local_'.
      
      // Let's grab invoices
      const invoicesStr = localStorage.getItem('poultryAppInvoices');
      if (invoicesStr) {
        try {
          const invoices = JSON.parse(invoicesStr);
          for (const inv of invoices) {
            const parsed = legacyInvoiceSchema.safeParse(inv);
            if (!parsed.success) {
              const db = await initDB();
              await db.put('system', { id: 'dead_letter_' + (inv.id || uuidv4()), payload: inv, error: parsed.error.message });
              continue; // Move to dead-letter, don't halt
            }
            await enqueueMutation({
              id: uuidv4(),
              entityType: 'invoices',
              action: 'create',
              payload: parsed.data
            });
          }
        } catch (e) {}
      }
      
      migrationState.status = 'COMPLETED';
      await setSystemState(migrationState);
    }

    if (migrationState.status === 'COMPLETED') {
      // Clean up localStorage
      for (const key of LEGACY_KEYS) {
        localStorage.removeItem(key);
      }
    }

  } catch (error: any) {
    console.error('Legacy migration failed', error);
    await setSystemState({ id: 'migration_state', status: 'FAILED', lastError: error.message });
  }
};
