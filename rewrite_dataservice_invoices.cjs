const fs = require('fs');

let dataService = fs.readFileSync('services/dataService.ts', 'utf8');

const regex = /export const addInvoice = async \([\s\S]*?(?=export const bulkMoveInvoicesByIds =)/;

const newInvoiceFunctions = `
export const addInvoice = async (invoiceData: any, type: 'entry' | 'exit'): Promise<void> => {
    const operationId = uuidv4();
    const id = invoiceData.id || \`inv_\${Date.now()}_\${Math.random().toString(36).substr(2, 5)}\`;
    let newInvoice: any = { ...invoiceData, id, type, createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
    
    if (type === 'entry') {
        if (newInvoice.wastage === undefined) { 
             newInvoice.wastage = safeParseFloat(newInvoice.scaleWeight) - safeParseFloat(newInvoice.billWeight);
        }
    }
    
    const apiRes = await sendRestRequest('/api/invoices', {
        method: 'POST',
        headers: { 'X-Operation-Id': operationId },
        body: JSON.stringify(newInvoice),
    });

    if (apiRes.success) {
        newInvoice.version = apiRes.version || 1;
        newInvoice.status = 'synced';
    } else {
        if (apiRes.error?.message === 'شما آفلاین هستید' || apiRes.error?.message === 'خطای شبکه') {
            newInvoice.status = 'pending';
            await enqueueMutation({
                id: operationId,
                entityType: 'invoices',
                action: 'create',
                payload: newInvoice
            });
        } else {
            throw apiRes.error;
        }
    }

    const allInvoices = getAllInvoices();
    allInvoices.push(newInvoice);
    await saveAllInvoices(allInvoices);
    
    try {
        const key = \`sortOrder_\${type}_\${newInvoice.date}\`;
        const currentOrder = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify([...currentOrder, id]));
    } catch (e) {}
    
    if (newInvoice.driverName?.trim()) await addDriver(newInvoice.driverName).catch(() => {});
    if (type === 'entry' && newInvoice.origin?.trim()) await addOrigin(newInvoice.origin).catch(() => {});
    invalidateInventoryCache();
    await logAction('created', type, newInvoice).catch(() => {});
};

export const updateInvoice = async (id: string, updates: any): Promise<void> => {
    const allInvoices = getAllInvoices();
    const index = allInvoices.findIndex(inv => inv.id === id);
    if (index === -1) return;
    
    const original = allInvoices[index];
    const expectedVersion = original.version || 1;
    const operationId = uuidv4();
    const updated = { ...original, ...updates, updatedAt: Date.now() };
    const type = 'sellerName' in updated ? 'entry' : 'exit';
    
    if ('scaleWeight' in updated && 'billWeight' in updated && updates.wastage === undefined) {
        updated.wastage = safeParseFloat(updated.scaleWeight) - safeParseFloat(updated.billWeight);
    }
    
    const apiRes = await sendRestRequest(\`/api/invoices/\${encodeURIComponent(id)}\`, {
        method: 'PUT',
        headers: { 'X-Operation-Id': operationId },
        body: JSON.stringify({ ...updates, expectedVersion }),
    });

    if (apiRes.success) {
        updated.version = apiRes.version;
        updated.status = 'synced';
    } else {
        if (apiRes.error?.message === 'شما آفلاین هستید' || apiRes.error?.message === 'خطای شبکه') {
            updated.status = 'pending';
            await enqueueMutation({
                id: operationId,
                entityType: 'invoices',
                action: 'update',
                payload: updated
            });
        } else {
            if (apiRes.error?.code === 'CONFLICT' && apiRes.error?.details?.authoritativeRecord) {
                // Update local with authoritative server record
                allInvoices[index] = apiRes.error.details.authoritativeRecord;
                await saveAllInvoices(allInvoices);
            }
            throw apiRes.error;
        }
    }

    allInvoices[index] = updated;
    await saveAllInvoices(allInvoices);
    invalidateInventoryCache();
    
    try {
        if (updates.date && updates.date !== original.date) {
            const oldKey = \`sortOrder_\${type}_\${original.date}\`;
            localStorage.setItem(oldKey, JSON.stringify(JSON.parse(localStorage.getItem(oldKey) || '[]').filter((oId: string) => oId !== id)));
            const newKey = \`sortOrder_\${type}_\${updates.date}\`;
            const newOrder = JSON.parse(localStorage.getItem(newKey) || '[]');
            if (!newOrder.includes(id)) localStorage.setItem(newKey, JSON.stringify([...newOrder, id]));
        }
    } catch(e) {}
    
    if (updated.driverName?.trim()) await addDriver(updated.driverName).catch(() => {});
    if (type === 'entry' && updated.origin?.trim()) await addOrigin(updated.origin).catch(() => {});
    const updateKeys = Object.keys(updates);
    if (!(updateKeys.length === 1 && updateKeys[0] === 'isPageBreak')) {
        await logAction('updated', type, updated, original.date, updated.date).catch(() => {});
    }
};

export const deleteInvoice = async (id: string): Promise<void> => {
    const allInvoices = getAllInvoices();
    const invoice = allInvoices.find(inv => inv.id === id);
    if (!invoice) return;
    const type = 'sellerName' in invoice ? 'entry' : 'exit';
    const operationId = uuidv4();
    
    const apiRes = await sendRestRequest(\`/api/invoices/\${encodeURIComponent(id)}\`, {
        method: 'DELETE',
        headers: { 'X-Operation-Id': operationId },
    });

    if (!apiRes.success) {
        if (apiRes.error?.message === 'شما آفلاین هستید' || apiRes.error?.message === 'خطای شبکه') {
            await enqueueMutation({
                id: operationId,
                entityType: 'invoices',
                action: 'delete',
                payload: { id }
            });
        } else {
            throw apiRes.error;
        }
    }

    await saveAllInvoices(allInvoices.filter(inv => inv.id !== id));
    try {
        const key = \`sortOrder_\${type}_\${invoice.date}\`;
        localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key) || '[]').filter((oId: string) => oId !== id)));
    } catch(e) {}
    invalidateInventoryCache();
    await logAction('deleted', type, invoice).catch(() => {});
};

`;

dataService = dataService.replace(regex, newInvoiceFunctions);
fs.writeFileSync('services/dataService.ts', dataService);
