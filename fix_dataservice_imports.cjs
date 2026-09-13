const fs = require('fs');
let code = fs.readFileSync('services/dataService.ts', 'utf8');

// Replace the invalid imports from dbStore
code = code.replace(/import \{ memoryCache, setStoreItem, initDataStore, enqueueSync, triggerSync, getDB, hydrateFromServer \} from '\.\/dbStore';/, `import { initDB } from './dbStore';`);

// Implement hydrateFromServer and triggerSync in dataService.ts
const newFuncs = `
export const hydrateFromServer = async (): Promise<boolean> => {
    try {
        const apiRes = await sendRestRequest('/api/invoices');
        if (apiRes && apiRes.success !== false) { // it might just be the array if we didn't wrap it yet, actually our api returns {data: [...], success: true} or [...] based on what findInvoicesWithPagination returns. Wait, GET /api/invoices returns paginated data ( { data: [], total: x, page: 1, limit: 50, totalPages: 1 } ).
            let fetchedInvoices = apiRes.data || (Array.isArray(apiRes) ? apiRes : apiRes.invoices) || [];
            await saveAllInvoices(fetchedInvoices);
            return true;
        }
    } catch (e) {
        console.error('Hydration failed', e);
    }
    return false;
};

export const triggerSync = async (): Promise<boolean> => {
    // Basic sync loop for pending queue
    const db = await initDB();
    const pending = await db.getAllFromIndex('syncQueue', 'by-status', 'pending');
    if (pending.length === 0) return true;
    
    let allSuccess = true;
    for (const mutation of pending) {
        try {
            let apiRes;
            if (mutation.action === 'create') {
                apiRes = await sendRestRequest('/api/invoices', { method: 'POST', headers: { 'X-Operation-Id': mutation.id }, body: JSON.stringify(mutation.payload) });
            } else if (mutation.action === 'update') {
                apiRes = await sendRestRequest(\`/api/invoices/\${encodeURIComponent(mutation.payload.id)}\`, { method: 'PUT', headers: { 'X-Operation-Id': mutation.id }, body: JSON.stringify(mutation.payload) });
            } else if (mutation.action === 'delete') {
                apiRes = await sendRestRequest(\`/api/invoices/\${encodeURIComponent(mutation.payload.id)}\`, { method: 'DELETE', headers: { 'X-Operation-Id': mutation.id } });
            }
            
            if (apiRes?.success) {
                mutation.status = 'synced';
                await db.put('syncQueue', mutation); // or delete
                await db.delete('syncQueue', mutation.id);
            } else {
                if (apiRes?.error?.code === 'IDEMPOTENCY_KEY_REUSED' || apiRes?.error?.code === 'CONFLICT') {
                    // It's technically resolved or we need to hydrate. Just remove from queue to stop blocking.
                    await db.delete('syncQueue', mutation.id);
                } else {
                    allSuccess = false;
                }
            }
        } catch (e) {
            allSuccess = false;
        }
    }
    if (allSuccess) await hydrateFromServer();
    return allSuccess;
};
`;

code = code + '\n' + newFuncs;

// We also need to fix `setStoreItem`, `enqueueSync`, and `memoryCache`.
code = code.replace(/setStoreItem/g, 'setCacheItem');
code = code.replace(/enqueueSync/g, 'enqueueMutation');
// memoryCache is now imported from './dbStore', so we need to add it to the first import.
code = code.replace(/import \{ setCacheItem, getCacheItem, enqueueMutation \} from '\.\/dbStore';/, `import { setCacheItem, getCacheItem, enqueueMutation, memoryCache } from './dbStore';`);

fs.writeFileSync('services/dataService.ts', code);
