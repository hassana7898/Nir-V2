
import { Settings, Entry, Exit, Log, Remittance, Product, Formula, ProductionRecord, InventoryAdjustment, Farmer, Brood } from '../types';
import { formatToISODate, formatDate } from '../utils/formatters';

import { ApiResponse, ApiError, ApiErrorCode } from '../shared/apiContract';
import { v4 as uuidv4 } from 'uuid';
import { setCacheItem, getCacheItem, enqueueMutation, memoryCache } from './dbStore';

import { initDB } from './dbStore';

// Pure UI Preferences Storage (Non-sensitive, UI-only, e.g. sort orders, theme, view options)
const localStorage = {
    getItem: (key: string): string | null => {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    setItem: (key: string, value: string): void => {
        try {
            window.localStorage.setItem(key, value);
        } catch (_e) {
            // Ignored - storage quota or unavailable
        }
    },
    removeItem: (key: string): void => {
        try {
            window.localStorage.removeItem(key);
        } catch (_e) {
            // Ignored
        }
    }
};

// Business Data Store abstraction (IndexedDB + memoryCache, never in window.localStorage)
const dataStore = {
    getItem: (key: string): any => {
        return memoryCache[key] ?? null;
    },
    setItem: async (key: string, value: any): Promise<void> => {
        memoryCache[key] = value;
        const db = await initDB();
        await db.put('cache', value, key);
    }
};

const SETTINGS_KEY = 'poultryAppSettings';
const INVOICES_KEY = 'poultryAppInvoices';
const LOGS_KEY = 'poultryAppLogs';
const FORMULAS_KEY = 'poultryAppFormulas';
const PRODUCTION_KEY = 'poultryAppProduction';
const ADJUSTMENTS_KEY = 'poultryAppAdjustments';
const FARMERS_KEY = 'poultryAppFarmers';
const DRIVERS_KEY = 'poultryAppDrivers';
const ORIGINS_KEY = 'poultryAppOrigins';

const DEFAULT_SETTINGS: Settings = {
    factoryName: "کارخانه شما",
    factoryLogo: null,
    entryPrintTitle: "فرم ورود روزانه",
    exitPrintTitle: "فرم خروج روزانه",
    entrySignatures: ["تایید کننده اول", "مسئول باسکول", "مدیر تحویل", "امضای چهارم"],
    entrySignatureNames: ["", "", "", ""],
    exitSignatures: ["راننده", "مسئول باسکول", "مدیریت / سرپرست", "امضای چهارم"],
    exitSignatureNames: ["", "", "", ""],
    products: [
        { id: 'corn', name: 'ذرت', type: 'rawMaterial' },
        { id: 'soybean', name: 'کنجاله سویا', type: 'rawMaterial' },
        { id: 'concentrate', name: 'کنسانتره', type: 'rawMaterial' },
        { id: 'broiler_feed', name: 'دان مرغ گوشتی', type: 'finishedGood' },
        { id: 'layer_feed', name: 'دان مرغ تخم‌گذار', type: 'finishedGood' },
    ],
    feedQuotas: [],
    totalBroodDays: 50,
    productPhaseDurations: {},
    printBoldText: false
};

const safeParseFloat = (val: any): number => {
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
};

interface ApiResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}


export const sendRestRequest = async <T = any>(
    url: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> => {
    if (!navigator.onLine) {
        return { success: false, error: { code: 'SERVER_ERROR', message: 'شما آفلاین هستید' } }; // Network equivalent
    }

    try {
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('nir_token') : null;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(options.headers || {}),
            },
            credentials: 'include',
        });

        const data = await response.json().catch(() => ({}));
        
        if (response.ok) {
            return data as ApiResponse<T>;
        }

        return data as ApiResponse<T>; // Should be the error structure
    } catch (error: any) {
        return { success: false, error: { code: 'SERVER_ERROR', message: 'خطای شبکه' } };
    }
};


// --- Settings ---
export const loadSettings = (): Settings => {
    const stored = dataStore.getItem(SETTINGS_KEY);
    if (stored && typeof stored === 'object') {
        return { ...DEFAULT_SETTINGS, ...stored };
    }
    return DEFAULT_SETTINGS;
};

export const saveSettings = async (settings: Settings): Promise<void> => {
    await dataStore.setItem(SETTINGS_KEY, settings);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
    });

    // Fallback: offline queue if not online or server failure
    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'update',
            entityType: 'poultryAppSettings',
            data: settings,
            timestamp: Date.now()
        });
    }
};

// --- Farmers ---
export const getFarmers = (): Farmer[] => {
    const list = dataStore.getItem(FARMERS_KEY);
    if (Array.isArray(list)) {
        return list.filter(f => !f.deletedAt).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'fa'));
    }
    return [];
};

export const saveFarmers = async (farmers: Farmer[]): Promise<void> => {
    await dataStore.setItem(FARMERS_KEY, farmers);
};

export const addFarmer = async (farmerData: Partial<Farmer>): Promise<Farmer> => {
    const farmers = getFarmers();
    const newFarmer: Farmer = {
        id: farmerData.id || `f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: farmerData.name?.trim() || 'مرغدار جدید',
        phone: farmerData.phone || '',
        broods: farmerData.broods || [],
        isHidden: Boolean(farmerData.isHidden),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    farmers.push(newFarmer);
    await dataStore.setItem(FARMERS_KEY, farmers);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest('/api/farmers', {
        method: 'POST',
        body: JSON.stringify(newFarmer),
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'create',
            entityType: 'poultryAppFarmers',
            data: newFarmer,
            timestamp: Date.now()
        });
    }
    return newFarmer;
};

export const updateFarmer = async (id: string, updates: Partial<Farmer>): Promise<void> => {
    const farmers = getFarmers();
    const index = farmers.findIndex(f => f.id === id);
    if (index > -1) {
        const updated = { ...farmers[index], ...updates, updatedAt: Date.now() };
        farmers[index] = updated;
        await dataStore.setItem(FARMERS_KEY, farmers);

        // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
        const apiRes = await sendRestRequest(`/api/farmers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        });

        if (!apiRes.success) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'update',
                entityType: 'poultryAppFarmers',
                data: updated,
                timestamp: Date.now()
            });
        }
    }
};

export const deleteFarmer = async (id: string): Promise<void> => {
    const farmers = getFarmers();
    const filtered = farmers.filter(f => f.id !== id);
    await dataStore.setItem(FARMERS_KEY, filtered);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest(`/api/farmers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'delete',
            entityType: 'poultryAppFarmers',
            data: { id },
            timestamp: Date.now()
        });
    }
};

// --- Drivers ---
export const getDrivers = (): string[] => {
    const list = dataStore.getItem(DRIVERS_KEY);
    return Array.isArray(list) ? list : [];
};

export const saveDrivers = async (drivers: string[]): Promise<void> => {
    const sorted = [...drivers].sort((a, b) => a.localeCompare(b, 'fa'));
    await dataStore.setItem(DRIVERS_KEY, sorted);
};

export const addDriver = async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const drivers = getDrivers();
    if (!drivers.includes(trimmed)) {
        const updated = [...drivers, trimmed];
        await saveDrivers(updated);

        // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
        const apiRes = await sendRestRequest('/api/drivers', {
            method: 'POST',
            body: JSON.stringify({ name: trimmed }),
        });

        if (!apiRes.success) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'create',
                entityType: 'poultryAppDrivers',
                data: { id: trimmed, name: trimmed },
                timestamp: Date.now()
            });
        }
    }
};

export const deleteDriver = async (nameToDelete: string): Promise<void> => {
    const drivers = getDrivers().filter(d => d !== nameToDelete);
    await saveDrivers(drivers);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest(`/api/drivers/${encodeURIComponent(nameToDelete)}`, {
        method: 'DELETE',
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'delete',
            entityType: 'poultryAppDrivers',
            data: { id: nameToDelete, name: nameToDelete },
            timestamp: Date.now()
        });
    }
};

export const deleteDrivers = async (namesToDelete: string[]): Promise<void> => {
    for (const name of namesToDelete) {
        await deleteDriver(name);
    }
};

// --- Invoices ---
export const getAllInvoices = (): Remittance[] => {
    const list = dataStore.getItem(INVOICES_KEY);
    return Array.isArray(list) ? list : [];
};

const saveAllInvoices = async (invoices: Remittance[]): Promise<void> => {
    await dataStore.setItem(INVOICES_KEY, invoices);
};

export const getInvoicesByDate = <T extends Remittance>(type: 'entry' | 'exit', date: Date): T[] => {
    const allInvoices = getAllInvoices();
    const dateStr = formatToISODate(date);
    let filtered = allInvoices.filter(inv => 
        (('sellerName' in inv) ? 'entry' : 'exit') === type && inv.date === dateStr
    ) as T[];

    // Sort order is stored in pure UI preferences (allowed in localStorage)
    const sortOrderKey = `sortOrder_${type}_${dateStr}`;
    const orderedIdsStr = localStorage.getItem(sortOrderKey);

    if (orderedIdsStr) {
        try {
            const orderedIds = JSON.parse(orderedIdsStr);
            if (Array.isArray(orderedIds)) {
                const invoiceMap = new Map(filtered.map(inv => [inv.id, inv]));
                const sortedInvoices: T[] = [];
                orderedIds.forEach((id: string) => {
                    const invoice = invoiceMap.get(id);
                    if (invoice) {
                        sortedInvoices.push(invoice as T);
                        invoiceMap.delete(id);
                    }
                });
                return [...sortedInvoices, ...(Array.from(invoiceMap.values()) as T[])];
            }
        } catch (_e) {
            // Sort order parsing error, fallback to default order
        }
    }
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
};


export const addInvoice = async (invoiceData: any, type: 'entry' | 'exit'): Promise<void> => {
    const operationId = uuidv4();
    const id = invoiceData.id || `inv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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
        const key = `sortOrder_${type}_${newInvoice.date}`;
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
    
    const apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(id)}`, {
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
            const oldKey = `sortOrder_${type}_${original.date}`;
            localStorage.setItem(oldKey, JSON.stringify(JSON.parse(localStorage.getItem(oldKey) || '[]').filter((oId: string) => oId !== id)));
            const newKey = `sortOrder_${type}_${updates.date}`;
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
    
    const apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(id)}`, {
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
        const key = `sortOrder_${type}_${invoice.date}`;
        localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key) || '[]').filter((oId: string) => oId !== id)));
    } catch(e) {}
    invalidateInventoryCache();
    await logAction('deleted', type, invoice).catch(() => {});
};

export const bulkMoveInvoicesByIds = async (type: 'entry' | 'exit', ids: string[], targetDate: Date): Promise<number> => {
    if (ids.length === 0) return 0;
    const targetDateStr = formatToISODate(targetDate);
    const allInvoices = getAllInvoices();
    
    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL (DB Transaction)
    const apiRes = await sendRestRequest<{ movedCount: number }>('/api/invoices/bulk-move', {
        method: 'POST',
        body: JSON.stringify({ ids, targetDate: targetDateStr }),
    });

    const sourceDates = new Set<string>();
    const updated = allInvoices.map(inv => {
        if (ids.includes(inv.id)) {
            sourceDates.add(inv.date);
            const upd = { ...inv, date: targetDateStr, updatedAt: Date.now() };
            return upd;
        }
        return inv;
    });
    await saveAllInvoices(updated);
    invalidateInventoryCache();

    const targetKey = `sortOrder_${type}_${targetDateStr}`;
    const targetOrder = JSON.parse(localStorage.getItem(targetKey) || '[]');
    localStorage.setItem(targetKey, JSON.stringify([...targetOrder, ...ids]));

    sourceDates.forEach(sourceDate => {
        if (sourceDate !== targetDateStr) {
            const sourceKey = `sortOrder_${type}_${sourceDate}`;
            const sourceOrder = JSON.parse(localStorage.getItem(sourceKey) || '[]');
            const newSourceOrder = sourceOrder.filter((id: string) => !ids.includes(id));
            localStorage.setItem(sourceKey, JSON.stringify(newSourceOrder));
        }
    });

    // Fallback: enqueue mutations if offline
    if (!apiRes.success) {
        for (const inv of allInvoices.filter(i => ids.includes(i.id))) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'update',
                entityType: 'poultryAppInvoices',
                data: inv,
                timestamp: Date.now()
            });
        }
    }

    await logAction('bulkMoved', 'bulkMove', { count: ids.length, subType: type });
    return ids.length;
};

export const saveOrderForDate = async (type: 'entry' | 'exit', date: Date, orderedIds: string[]): Promise<void> => {
    localStorage.setItem(`sortOrder_${type}_${formatToISODate(date)}`, JSON.stringify(orderedIds));
};

export const getInvoicesByDateRange = (start: string, end: string) => getAllInvoices().filter(i => i.date >= start && i.date <= end);

export const searchAllInvoices = (query: string, options: any) => {
    const term = query.toLowerCase().trim();
    if (!term) return [];
    
    const settings = loadSettings();
    const productMap = new Map(settings.products.map(p => [p.id, p.name.toLowerCase()]));
    const farmers = getFarmers();
    const farmerMap = new Map(farmers.map(f => [f.id, f.name.toLowerCase()]));
    
    return getAllInvoices().filter(inv => {
        const isEntry = 'sellerName' in inv;
        const currentType = isEntry ? 'entry' : 'exit';
        
        if (options.type !== 'all' && currentType !== options.type) return false;

        const searchableContent: string[] = [];
        searchableContent.push(productMap.get(inv.productId) || '');
        searchableContent.push((inv.driverName || '').toLowerCase());
        searchableContent.push(inv.date);
        
        if (isEntry) {
            const entry = inv as Entry;
            searchableContent.push((entry.sellerName || '').toLowerCase());
            searchableContent.push((entry.billNumber || '').toString());
            searchableContent.push((entry.origin || '').toLowerCase());
            searchableContent.push(entry.billWeight?.toString());
            searchableContent.push(entry.scaleWeight?.toString());
            searchableContent.push(entry.transportCost?.toString());
        } else {
            const exit = inv as Exit;
            searchableContent.push(farmerMap.get(exit.farmerId) || '');
            searchableContent.push((exit.invoiceNumber || '').toString());
            if (exit.productVariant) searchableContent.push(exit.productVariant.toLowerCase());
            searchableContent.push(exit.weight?.toString());
        }

        return searchableContent.some(content => content && content.includes(term));
    }).sort((a,b) => b.createdAt - a.createdAt);
};

// --- Formulas, Production, Adjustments, Logs ---
export const getFormulas = (): Formula[] => {
    const list = dataStore.getItem(FORMULAS_KEY);
    return Array.isArray(list) ? list.filter(f => !f.deletedAt) : [];
};

export const saveFormula = async (f: any): Promise<Formula> => {
    const fs = getFormulas();
    const newFormula = { ...f, id: f.id || `f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, createdAt: Date.now(), updatedAt: Date.now() };
    fs.push(newFormula);
    await dataStore.setItem(FORMULAS_KEY, fs);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest('/api/formulas', {
        method: 'POST',
        body: JSON.stringify(newFormula),
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'create',
            entityType: 'poultryAppFormulas',
            data: newFormula,
            timestamp: Date.now()
        });
    }
    return newFormula;
};

export const updateFormula = async (f: any): Promise<void> => {
    const fs = getFormulas();
    const i = fs.findIndex((x: any) => x.id === f.id);
    if (i > -1) {
        const updated = { ...fs[i], ...f, updatedAt: Date.now() };
        fs[i] = updated;
        await dataStore.setItem(FORMULAS_KEY, fs);

        // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
        const apiRes = await sendRestRequest(`/api/formulas/${encodeURIComponent(f.id)}`, {
            method: 'PUT',
            body: JSON.stringify(f),
        });

        if (!apiRes.success) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'update',
                entityType: 'poultryAppFormulas',
                data: updated,
                timestamp: Date.now()
            });
        }
    }
};

export const deleteFormula = async (id: string): Promise<void> => {
    const fs = getFormulas().filter((f: any) => f.id !== id);
    await dataStore.setItem(FORMULAS_KEY, fs);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest(`/api/formulas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'delete',
            entityType: 'poultryAppFormulas',
            data: { id },
            timestamp: Date.now()
        });
    }
};

export const getProductionRecords = (): ProductionRecord[] => {
    const list = dataStore.getItem(PRODUCTION_KEY);
    return Array.isArray(list) ? list.filter(p => !p.deletedAt) : [];
};

export const addProductionRecord = async (r: any): Promise<ProductionRecord> => {
    const rs = getProductionRecords();
    const newRecord: ProductionRecord = { ...r, id: r.id || `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, createdAt: Date.now(), updatedAt: Date.now() };
    rs.push(newRecord);
    await dataStore.setItem(PRODUCTION_KEY, rs);
    invalidateInventoryCache();

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL (DB Transaction)
    const apiRes = await sendRestRequest('/api/production', {
        method: 'POST',
        body: JSON.stringify(newRecord),
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'create',
            entityType: 'poultryAppProduction',
            data: newRecord,
            timestamp: Date.now()
        });
    }
    return newRecord;
};

export const deleteProductionRecord = async (id: string): Promise<void> => {
    const rs = getProductionRecords().filter(r => r.id !== id);
    await dataStore.setItem(PRODUCTION_KEY, rs);
    invalidateInventoryCache();

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL (DB Transaction)
    const apiRes = await sendRestRequest(`/api/production/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'delete',
            entityType: 'poultryAppProduction',
            data: { id },
            timestamp: Date.now()
        });
    }
};

export const getProductionRecordsByDate = (d: Date) => {
    const s = formatToISODate(d);
    return getProductionRecords().filter((r: any) => r.date === s);
};

export const getInventoryAdjustments = (): InventoryAdjustment[] => {
    const list = dataStore.getItem(ADJUSTMENTS_KEY);
    return Array.isArray(list) ? list.filter(a => !a.deletedAt) : [];
};

export const addInventoryAdjustment = async (a: any): Promise<InventoryAdjustment> => {
    const as = getInventoryAdjustments();
    const newAdj: InventoryAdjustment = { ...a, id: a.id || `a_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, createdAt: Date.now(), updatedAt: Date.now() };
    as.push(newAdj);
    await dataStore.setItem(ADJUSTMENTS_KEY, as);
    invalidateInventoryCache();

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL (DB Transaction)
    const apiRes = await sendRestRequest('/api/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
            date: newAdj.date,
            productId: newAdj.productId,
            newQuantity: newAdj.newQuantity,
            reason: newAdj.reason,
        }),
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'create',
            entityType: 'poultryAppAdjustments',
            data: newAdj,
            timestamp: Date.now()
        });
    }
    return newAdj;
};

export const getLogs = (): Log[] => {
    const list = dataStore.getItem(LOGS_KEY);
    return Array.isArray(list) ? list : [];
};

export const logAction = async (action: string, type: string, item: any, oldD?: any, newD?: any) => {
    const logs = getLogs();
    const newLog: Log = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: Date.now(),
        action,
        actionText: `${type} ${action}`,
        type,
        details: JSON.stringify(item).substring(0, 200),
        by: 'user'
    } as any;
    logs.unshift(newLog);
    if (logs.length > 1000) logs.pop();
    await dataStore.setItem(LOGS_KEY, logs);
    await enqueueMutation({
        id: crypto.randomUUID(),
        action: 'create',
        entityType: 'poultryAppLogs',
        data: newLog,
        timestamp: Date.now()
    });
};

// --- BACKUP AND RESTORE (Server-backed authoritative snapshot) ---

export interface ImportSummary {
    restoredTables: Record<string, number>;
    verifiedCounts?: Record<string, number>;
    skippedTables?: string[];
    totalRows?: number;
    /** true when only the local offline cache could be restored (server unreachable). */
    localOnly?: boolean;
}

/**
 * Export a COMPLETE, restorable snapshot of the authoritative server data.
 * The JSON returned here is exactly what importData() accepts.
 */
export const exportData = async (): Promise<string> => {
    try {
        const res = await fetch('/api/backup/export', { method: 'GET', credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object' && data.tables) {
                return JSON.stringify(data, null, 2);
            }
        }
    } catch (_err) {
        // Fall back to the local cache snapshot when the server is unreachable.
    }

    // Fallback: client-side offline cache snapshot
    const db = await initDB();
    const keys = await db.getAllKeys('store');
    const values = await db.getAll('store');
    const snapshot: Record<string, any> = {};
    keys.forEach((key, i) => { snapshot[key as string] = values[i]; });
    return JSON.stringify(snapshot, null, 2);
};

/**
 * Import a backup. Throws a precise, user-facing error when the restore fails -
 * a failed restore must never be reported as success by the UI.
 */
export const importData = async (jsonData: string): Promise<ImportSummary> => {
    let parsed: any;
    try {
        parsed = JSON.parse(jsonData);
    } catch {
        throw new Error('فایل پشتیبان نامعتبر است (JSON خوانده نشد).');
    }

    const isServerSnapshot = parsed && typeof parsed === 'object' && parsed.tables && typeof parsed.tables === 'object';

    if (isServerSnapshot) {
        const res = await fetch('/api/backup/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: jsonData,
        });
        const payload = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            throw new Error(payload?.error || `بازیابی ناموفق بود (HTTP ${res.status}).`);
        }

        invalidateInventoryCache();
        try { await hydrateFromServer(); } catch { /* local refresh is best-effort */ }

        return {
            restoredTables: payload.restoredTables || {},
            verifiedCounts: payload.verifiedCounts,
            skippedTables: payload.skippedTables,
            totalRows: payload.totalRows,
        };
    }

    // Legacy / offline-cache snapshot (key -> value map from an earlier local export).
    const ignoredKeys = new Set(['success', 'file', 'fileName', 'format', 'sizeBytes', 'downloadUrl', 'error']);
    const db = await initDB();
    let restored = 0;
    for (const key in parsed) {
        if (ignoredKeys.has(key)) continue;
        memoryCache[key] = parsed[key];
        await db.put('store', parsed[key], key);
        restored++;
    }
    if (restored === 0) {
        throw new Error('فایل پشتیبان شامل داده‌ی قابل بازیابی نبود.');
    }
    invalidateInventoryCache();
    try { await hydrateFromServer(); } catch { /* local refresh is best-effort */ }
    return { restoredTables: { local: restored }, localOnly: true };
};


import { runLegacyMigration } from './legacyMigration';
export const migrateLegacyData = async () => {
    await runLegacyMigration();

    await initDB();
    
    // Purge old business data from window.localStorage to enforce PostgreSQL/IndexedDB as source of truth
    const businessKeys = [SETTINGS_KEY, INVOICES_KEY, LOGS_KEY, FORMULAS_KEY, PRODUCTION_KEY, ADJUSTMENTS_KEY, FARMERS_KEY, DRIVERS_KEY, ORIGINS_KEY];
    for (const k of businessKeys) {
        const legacyVal = window.localStorage.getItem(k);
        if (legacyVal) {
            try {
                const parsed = JSON.parse(legacyVal);
                if (!dataStore.getItem(k)) {
                    await dataStore.setItem(k, parsed);
                }
            } catch (_err) {
                // Ignore invalid JSON in legacy key
            }
            // REMOVE from localStorage so business data is no longer held there (Requirement 2 & 4)
            window.localStorage.removeItem(k);
        }
    }

    if (!dataStore.getItem(SETTINGS_KEY)) {
        await dataStore.setItem(SETTINGS_KEY, DEFAULT_SETTINGS);
    }
    for (const k of [INVOICES_KEY, LOGS_KEY, FORMULAS_KEY, PRODUCTION_KEY, ADJUSTMENTS_KEY, FARMERS_KEY, DRIVERS_KEY]) {
        if (!dataStore.getItem(k)) await dataStore.setItem(k, []);
    }
    if (!dataStore.getItem(ORIGINS_KEY)) {
        await dataStore.setItem(ORIGINS_KEY, ['شمال', 'جنوب', 'مرکز', 'غرب', 'شرق', 'وارداتی']);
    }
};

// --- Warehouse Inventory Status ---
export const getInventoryStatusAsync = async (until: Date): Promise<Map<string, number>> => {
    const untilDateStr = formatToISODate(until);

    if (navigator.onLine) {
        try {
            const res = await sendRestRequest<{ stock: Record<string, number>; date: string }>(
                `/api/inventory/status?until=${encodeURIComponent(untilDateStr)}`
            );
            if (res.success && res.data?.stock) {
                const settings = loadSettings();
                const stockMap = new Map<string, number>();
                settings.products.forEach(p => stockMap.set(p.id, 0));
                for (const [pId, qty] of Object.entries(res.data.stock)) {
                    stockMap.set(pId, qty);
                }
                authoritativeStockCache.set(untilDateStr, { timestamp: Date.now(), data: stockMap });
                return stockMap;
            }
        } catch {
            // Fallback to local computation
        }
    }

    // Fallback: compute from local cache if offline
    return getInventoryStatus(until);
};

export const getInventoryStatus = (until: Date): Map<string, number> => {
    const untilDateStr = formatToISODate(until);
    const cached = authoritativeStockCache.get(untilDateStr);
    if (cached && Date.now() - cached.timestamp < 30000) {
        return cached.data;
    }

    const settings = loadSettings();
    const inventory = new Map<string, number>();
    settings.products.forEach(p => inventory.set(p.id, 0));

    const allTransactions: any[] = [];
    getAllInvoices().forEach(inv => allTransactions.push({ date: inv.date, createdAt: inv.createdAt, type: 'invoice', data: inv }));
    getProductionRecords().forEach(prod => allTransactions.push({ date: prod.date, createdAt: prod.createdAt, type: 'production', data: prod }));
    getInventoryAdjustments().forEach(adj => allTransactions.push({ date: adj.date, createdAt: adj.createdAt, type: 'adjustment', data: adj }));

    allTransactions.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const formulaMap = new Map(getFormulas().map(f => [f.finishedGoodId, f.items]));

    for (const tx of allTransactions) {
        if (tx.date > untilDateStr) continue;
        if (tx.type === 'invoice') {
            const inv = tx.data;
            const current = inventory.get(inv.productId) || 0;
            if ('sellerName' in inv) inventory.set(inv.productId, current + safeParseFloat(inv.scaleWeight));
            else inventory.set(inv.productId, current - safeParseFloat(inv.weight));
        } else if (tx.type === 'production') {
            const prod = tx.data;
            inventory.set(prod.finishedGoodId, (inventory.get(prod.finishedGoodId) || 0) + safeParseFloat(prod.quantityProduced));
            formulaMap.get(prod.finishedGoodId)?.forEach(item => {
                const currentRaw = inventory.get(item.productId) || 0;
                inventory.set(item.productId, currentRaw - (safeParseFloat(item.quantity) * safeParseFloat(prod.quantityProduced)));
            });
        } else if (tx.type === 'adjustment') {
            inventory.set(tx.data.productId, safeParseFloat(tx.data.newQuantity));
        }
    }
    return inventory;
};

export const getAdvancedInventoryReport = async (startDate: Date, endDate: Date, startEntryId?: string, startExitId?: string): Promise<any[]> => {
    const settings = loadSettings();
    const openingDate = new Date(startDate);
    openingDate.setDate(openingDate.getDate() - 1);
    
    const openingInv = getInventoryStatus(openingDate);
    const closingInv = getInventoryStatus(endDate);
    const startDateStr = formatToISODate(startDate);
    const endDateStr = formatToISODate(endDate);
    
    const allInvoices = getAllInvoices();
    
    let entryCutoffTime = 0;
    let exitCutoffTime = 0;

    if (startEntryId) {
        const entry = allInvoices.find(i => i.id === startEntryId);
        if (entry) entryCutoffTime = entry.createdAt;
    }
    if (startExitId) {
        const exit = allInvoices.find(i => i.id === startExitId);
        if (exit) exitCutoffTime = exit.createdAt;
    }

    const invoices = allInvoices.filter(i => {
        if (i.date < startDateStr || i.date > endDateStr) return false;
        
        if ('sellerName' in i) { // Entry
             if (entryCutoffTime > 0 && i.createdAt <= entryCutoffTime) return false;
        } else { // Exit
             if (exitCutoffTime > 0 && i.createdAt <= exitCutoffTime) return false;
        }
        return true;
    });

    const productions = getProductionRecords().filter(p => p.date >= startDateStr && p.date <= endDateStr);
    const formulaMap = new Map(getFormulas().map(f => [f.finishedGoodId, f.items]));

    const report: Record<string, any> = {};
    settings.products.forEach(p => {
        report[p.id] = {
            productId: p.id, productName: p.name, opening: openingInv.get(p.id) || 0, closing: closingInv.get(p.id) || 0,
            entries: 0, exits: 0, produced: 0, consumed: 0, adjustments: 0
        };
    });

    invoices.forEach(inv => {
        if ('sellerName' in inv) report[inv.productId].entries += safeParseFloat((inv as Entry).scaleWeight);
        else report[inv.productId].exits += safeParseFloat((inv as Exit).weight);
    });

    productions.forEach(prod => {
        report[prod.finishedGoodId].produced += safeParseFloat(prod.quantityProduced);
        formulaMap.get(prod.finishedGoodId)?.forEach(item => {
            report[item.productId].consumed += safeParseFloat(item.quantity) * safeParseFloat(prod.quantityProduced);
        });
    });

    for (const id in report) {
        const item = report[id];
        const expected = item.opening + item.entries + item.produced - item.exits - item.consumed;
        item.adjustments = item.closing - expected;
    }
    return Object.values(report);
};

export const getDashboardData = (chartDays: number = 7): any => {
    const today = new Date();
    const inventory = getInventoryStatus(today);
    const settings = loadSettings();
    let rawWeight = 0; let finishedWeight = 0;
    const rawDist: any[] = [];

    settings.products.forEach(p => {
        const stock = inventory.get(p.id) || 0;
        if (p.type === 'rawMaterial') {
            rawWeight += stock;
            if (stock > 0) rawDist.push({ name: p.name, value: stock });
        } else finishedWeight += stock;
    });

    const todayStr = formatToISODate(today);
    const allInvoices = getAllInvoices();
    const todayEntries = allInvoices.filter(i => i.date === todayStr && 'sellerName' in i).length;
    const todayExits = allInvoices.filter(i => i.date === todayStr && !('sellerName' in i)).length;

    const lastDaysData: any[] = [];
    const finishedGoodIds = new Set(settings.products.filter(p => p.type === 'finishedGood').map(p => p.id));
    
    for (let i = chartDays - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dStr = formatToISODate(d);
        let entrySum = 0; let exitSum = 0;
        allInvoices.forEach(inv => {
            if (inv.date === dStr) {
                if ('sellerName' in inv) entrySum += safeParseFloat((inv as Entry).scaleWeight);
                else if (finishedGoodIds.has(inv.productId)) exitSum += safeParseFloat((inv as Exit).weight);
            }
        });
        lastDaysData.push({ date: d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }), entry: entrySum, exit: exitSum });
    }

    const farmers = getFarmers();
    let activeBroods = 0;
    farmers.forEach(f => { f.broods?.forEach(b => { if (!b.endDate) activeBroods++; }); });

    return { activeBroodsCount: activeBroods, rawMaterialWeight: rawWeight, finishedGoodWeight: finishedWeight, rawMaterialDistribution: rawDist, todayEntriesCount: todayEntries, todayExitsCount: todayExits, lastDaysData };
};

export const renameDriver = async (oldName: string, newName: string): Promise<number> => {
    const invs = getAllInvoices();
    let count = 0;
    const updated = invs.map(i => {
        if (i.driverName === oldName) { count++; return { ...i, driverName: newName.trim(), updatedAt: Date.now() }; }
        return i;
    });
    if (count > 0) await saveAllInvoices(updated);
    
    const drivers = getDrivers();
    const newDrivers = drivers.filter(d => d !== oldName);
    if (!newDrivers.includes(newName.trim()) && newName.trim()) {
        newDrivers.push(newName.trim());
    }
    await saveDrivers(newDrivers);
    
    return count;
};

export const renameFarmer = async (id: string, newName: string): Promise<void> => {
    const fs = getFarmers();
    const updated = fs.map(f => f.id === id ? { ...f, name: newName.trim(), updatedAt: Date.now() } : f);
    await saveFarmers(updated);
    const target = updated.find(f => f.id === id);
    if (target) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'update',
            entityType: 'poultryAppFarmers',
            data: target,
            timestamp: Date.now()
        });
    }
};

export const mergeFarmers = async (sourceId: string, targetId: string): Promise<{ invoiceCount: number }> => {
    const invs = getAllInvoices();
    let count = 0;
    const updatedInvs = invs.map(i => {
        if ('farmerId' in i && i.farmerId === sourceId) { count++; return { ...i, farmerId: targetId, updatedAt: Date.now() }; }
        return i;
    });
    await saveAllInvoices(updatedInvs);
    const fs = getFarmers();
    const sourceFarmer = fs.find(f => f.id === sourceId);
    const targetFarmer = fs.find(f => f.id === targetId);
    if (sourceFarmer && targetFarmer) {
        targetFarmer.broods = [...(targetFarmer.broods || []), ...(sourceFarmer.broods || [])];
        targetFarmer.updatedAt = Date.now();
    }
    await saveFarmers(fs.filter(f => f.id !== sourceId));
    await deleteFarmer(sourceId);
    if (targetFarmer) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'update',
            entityType: 'poultryAppFarmers',
            data: targetFarmer,
            timestamp: Date.now()
        });
    }
    return { invoiceCount: count };
};

export const mergeProducts = async (sourceId: string, targetId: string): Promise<void> => {
    const allInvoices = getAllInvoices();
    let updatedInvoices = allInvoices.map(inv => inv.productId === sourceId ? { ...inv, productId: targetId, updatedAt: Date.now() } : inv);
    await saveAllInvoices(updatedInvoices);

    const productions = getProductionRecords();
    const updatedProductions = productions.map(p => p.finishedGoodId === sourceId ? { ...p, finishedGoodId: targetId, updatedAt: Date.now() } : p);
    await dataStore.setItem(PRODUCTION_KEY, updatedProductions);

    const formulas = getFormulas();
    const updatedFormulas = formulas.map(f => {
        let changed = false;
        let newFinishedId = f.finishedGoodId;
        if (f.finishedGoodId === sourceId) { newFinishedId = targetId; changed = true; }
        
        const newItems = f.items.map(item => {
            if (item.productId === sourceId) { changed = true; return { ...item, productId: targetId }; }
            return item;
        });

        const uniqueItems: any[] = [];
        newItems.forEach(item => {
            const existing = uniqueItems.find(i => i.productId === item.productId);
            if (existing) existing.quantity += item.quantity;
            else uniqueItems.push(item);
        });

        return changed ? { ...f, finishedGoodId: newFinishedId, items: uniqueItems, updatedAt: Date.now() } : f;
    });
    await dataStore.setItem(FORMULAS_KEY, updatedFormulas);

    const adjustments = getInventoryAdjustments();
    const updatedAdjustments = adjustments.map(a => a.productId === sourceId ? { ...a, productId: targetId, updatedAt: Date.now() } : a);
    await dataStore.setItem(ADJUSTMENTS_KEY, updatedAdjustments);

    const settings = loadSettings();
    const newProducts = settings.products.filter(p => p.id !== sourceId);
    const newQuotas = settings.feedQuotas?.filter(q => q.productId !== sourceId) || [];
    const newDurations = { ...settings.productPhaseDurations };
    delete newDurations[sourceId];

    const newSettings = { ...settings, products: newProducts, feedQuotas: newQuotas, productPhaseDurations: newDurations };
    await saveSettings(newSettings);
    
    await logAction('merged', 'product', { sourceId, targetId });
};

export const mergeDrivers = async (sourceName: string, targetName: string): Promise<number> => {
    return renameDriver(sourceName, targetName); 
};

export const getOrigins = (): string[] => {
    const list = dataStore.getItem(ORIGINS_KEY);
    if (Array.isArray(list) && list.length > 0) return list;
    return ['شمال', 'جنوب', 'مرکز', 'غرب', 'شرق', 'وارداتی'];
};

export const saveOrigins = async (origins: string[]): Promise<void> => {
    await dataStore.setItem(ORIGINS_KEY, origins);
};

export const addOrigin = async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const origins = getOrigins();
    if (!origins.includes(trimmed)) {
        await saveOrigins([...origins, trimmed]);

        // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
        const apiRes = await sendRestRequest('/api/origins', {
            method: 'POST',
            body: JSON.stringify({ name: trimmed }),
        });

        if (!apiRes.success) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'create',
                entityType: 'poultryAppOrigins',
                data: { id: trimmed, name: trimmed },
                timestamp: Date.now()
            });
        }
    }
};

export const deleteOrigin = async (nameToDelete: string): Promise<void> => {
    const origins = getOrigins().filter(o => o !== nameToDelete);
    await saveOrigins(origins);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest(`/api/origins/${encodeURIComponent(nameToDelete)}`, {
        method: 'DELETE',
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'delete',
            entityType: 'poultryAppOrigins',
            data: { id: nameToDelete, name: nameToDelete },
            timestamp: Date.now()
        });
    }
};

// --- Server-side Direct API Operations (PostgreSQL Source of Truth) ---
export const fetchInvoicesFromServer = async (params: {
    page?: number;
    limit?: number;
    type?: 'entry' | 'exit';
    search?: string;
    startDate?: string;
    endDate?: string;
    farmerId?: string;
    productId?: string;
}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.type) query.set('type', params.type);
    if (params.search) query.set('search', params.search);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.farmerId) query.set('farmerId', params.farmerId);
    if (params.productId) query.set('productId', params.productId);

    const res = await fetch(`/api/invoices?${query.toString()}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch invoices from server');
    return await res.json();
};

export const fetchInventoryStatusFromServer = async (untilDate?: string) => {
    const url = untilDate ? `/api/inventory/status?until=${encodeURIComponent(untilDate)}` : '/api/inventory/status';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch inventory status from server');
    return await res.json();
};

export const fetchInventoryTransactionsFromServer = async (params: {
    productId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}) => {
    const query = new URLSearchParams();
    if (params.productId) query.set('productId', params.productId);
    if (params.type) query.set('type', params.type);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`/api/inventory/transactions?${query.toString()}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch inventory transactions from server');
    return await res.json();
};

export const createInvoiceOnServer = async (invoiceData: any) => {
    const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(invoiceData),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Failed to create invoice on server');
    }
    return await res.json();
};

export const updateInvoiceOnServer = async (id: string, invoiceData: any) => {
    const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(invoiceData),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Failed to update invoice on server');
    }
    return await res.json();
};

export const deleteInvoiceOnServer = async (id: string) => {
    const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Failed to delete invoice on server');
    }
    return await res.json();
};


export const hydrateFromServer = async (): Promise<boolean> => {
    try {
        const apiRes = await sendRestRequest('/api/invoices');
        if (apiRes && apiRes.success !== false) { 
            let fetchedInvoices = apiRes.data || (Array.isArray(apiRes) ? apiRes : apiRes.invoices);
            if (!Array.isArray(fetchedInvoices)) {
                console.error("Hydration failed: Expected array of invoices, got something else.");
                return false;
            }
            await saveAllInvoices(fetchedInvoices);
            return true;
        }
    } catch (e) {
        console.error('Hydration failed DEBUG:', e);
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
                apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(mutation.payload.id)}`, { method: 'PUT', headers: { 'X-Operation-Id': mutation.id }, body: JSON.stringify(mutation.payload) });
            } else if (mutation.action === 'delete') {
                apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(mutation.payload.id)}`, { method: 'DELETE', headers: { 'X-Operation-Id': mutation.id } });
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
