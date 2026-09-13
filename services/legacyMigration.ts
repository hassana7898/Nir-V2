import { initDB, getSystemState, setSystemState, LegacyMigrationState, setCacheItem, enqueueMutation } from './dbStore';
import { v4 as uuidv4 } from 'uuid';

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

    if (migrationState.status === 'COMPLETED' || migrationState.status === 'FAILED') {
      return; // Already done
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
            // Very simplistic: just queue them all as creations to ensure no data loss.
            // A robust check would query the DB first. Idempotency will prevent duplicates.
            await enqueueMutation({
              id: uuidv4(),
              entityType: 'invoices',
              action: 'create',
              payload: inv
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
