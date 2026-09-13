
import { Settings, Entry, Exit, Log, Remittance, Product, Formula, ProductionRecord, InventoryAdjustment, Farmer, Brood } from '../types';
import { formatToISODate, formatDate } from '../utils/formatters';

const SETTINGS_KEY = 'poultryAppSettings';
const INVOICES_KEY = 'poultryAppInvoices';
const LOGS_KEY = 'poultryAppLogs';
const FORMULAS_KEY = 'poultryAppFormulas';
const PRODUCTION_KEY = 'poultryAppProduction';
const ADJUSTMENTS_KEY = 'poultryAppAdjustments';
const FARMERS_KEY = 'poultryAppFarmers';
const DRIVERS_KEY = 'poultryAppDrivers';

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

// --- Settings ---
export const loadSettings = (): Settings => {
    const settingsStr = localStorage.getItem(SETTINGS_KEY);
    if (settingsStr) {
        try {
            const stored = JSON.parse(settingsStr);
            return { ...DEFAULT_SETTINGS, ...stored };
        } catch (error) {
            return DEFAULT_SETTINGS;
        }
    }
    return DEFAULT_SETTINGS;
};

export const saveSettings = (settings: Settings): void => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

// --- Farmers ---
export const getFarmers = (): Farmer[] => {
    const farmersStr = localStorage.getItem(FARMERS_KEY);
    if (!farmersStr) return [];
    try {
        const list = JSON.parse(farmersStr);
        if (Array.isArray(list)) {
            // Sort farmers alphabetically by name (Persian support)
            return list.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'fa'));
        }
        return [];
    } catch (e) {
        return [];
    }
};

export const saveFarmers = (farmers: Farmer[]): void => {
    localStorage.setItem(FARMERS_KEY, JSON.stringify(farmers));
};

// --- Drivers ---
export const getDrivers = (): string[] => {
    const driversStr = localStorage.getItem(DRIVERS_KEY);
    if (!driversStr) return [];
    try {
        const data = JSON.parse(driversStr);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
};

export const saveDrivers = (drivers: string[]): void => {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers.sort((a, b) => a.localeCompare(b, 'fa'))));
};

export const addDriver = async (name: string): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const drivers = getDrivers();
    if (!drivers.includes(trimmedName)) {
        saveDrivers([...drivers, trimmedName]);
    }
};

export const deleteDriver = async (nameToDelete: string): Promise<void> => {
    saveDrivers(getDrivers().filter(d => d !== nameToDelete));
};

export const deleteDrivers = async (namesToDelete: string[]): Promise<void> => {
    const toDeleteSet = new Set(namesToDelete);
    saveDrivers(getDrivers().filter(d => !toDeleteSet.has(d)));
};

// --- Invoices ---
export const getAllInvoices = (): Remittance[] => {
    const invoicesStr = localStorage.getItem(INVOICES_KEY);
    if (!invoicesStr) return [];
    try {
        return JSON.parse(invoicesStr);
    } catch (e) {
        return [];
    }
};

const saveAllInvoices = (invoices: Remittance[]): void => {
    localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
};

export const getInvoicesByDate = <T extends Remittance>(type: 'entry' | 'exit', date: Date): T[] => {
    const allInvoices = getAllInvoices();
    const dateStr = formatToISODate(date);
    let filtered = allInvoices.filter(inv => 
        (('sellerName' in inv) ? 'entry' : 'exit') === type && inv.date === dateStr
    ) as T[];

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
        } catch (e) {}
    }
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
};

export const addInvoice = async (invoiceData: any, type: 'entry' | 'exit'): Promise<void> => {
    const allInvoices = getAllInvoices();
    const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let newInvoice: any = { ...invoiceData, id, createdAt: Date.now() };
    
    if (type === 'entry') {
        if (newInvoice.wastage === undefined) {
             newInvoice.wastage = safeParseFloat(newInvoice.scaleWeight) - safeParseFloat(newInvoice.billWeight);
        }
    }
    
    allInvoices.push(newInvoice);
    saveAllInvoices(allInvoices);
    
    const key = `sortOrder_${type}_${newInvoice.date}`;
    const currentOrder = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify([...currentOrder, id]));
    
    if (newInvoice.driverName?.trim()) {
        addDriver(newInvoice.driverName);
    }
    if (type === 'entry' && newInvoice.origin?.trim()) {
        addOrigin(newInvoice.origin);
    }
    await logAction('created', type, newInvoice);
};

export const updateInvoice = async (id: string, updates: any): Promise<void> => {
    const allInvoices = getAllInvoices();
    const index = allInvoices.findIndex(inv => inv.id === id);
    if (index > -1) {
        const original = allInvoices[index];
        const updated = { ...original, ...updates };
        const type = 'sellerName' in updated ? 'entry' : 'exit';

        if (updates.date && updates.date !== original.date) {
            const oldKey = `sortOrder_${type}_${original.date}`;
            localStorage.setItem(oldKey, JSON.stringify(JSON.parse(localStorage.getItem(oldKey) || '[]').filter((oId: string) => oId !== id)));
            const newKey = `sortOrder_${type}_${updates.date}`;
            const newOrder = JSON.parse(localStorage.getItem(newKey) || '[]');
            if (!newOrder.includes(id)) localStorage.setItem(newKey, JSON.stringify([...newOrder, id]));
        }

        if ('scaleWeight' in updated && 'billWeight' in updated && updates.wastage === undefined) {
            (updated as any).wastage = safeParseFloat(updated.scaleWeight) - safeParseFloat(updated.billWeight);
        }
        allInvoices[index] = updated;
        saveAllInvoices(allInvoices);
        
        const updateKeys = Object.keys(updates);
        if (!(updateKeys.length === 1 && updateKeys[0] === 'isPageBreak')) {
            await logAction('updated', type, updated, original.date, updated.date);
        }
        if (updated.driverName?.trim()) addDriver(updated.driverName);
        if (type === 'entry' && updated.origin?.trim()) addOrigin(updated.origin);
    }
};

export const deleteInvoice = async (id: string): Promise<void> => {
    const allInvoices = getAllInvoices();
    const invoice = allInvoices.find(inv => inv.id === id);
    if (invoice) {
        const type = 'sellerName' in invoice ? 'entry' : 'exit';
        saveAllInvoices(allInvoices.filter(inv => inv.id !== id));
        const key = `sortOrder_${type}_${invoice.date}`;
        localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key) || '[]').filter((oId: string) => oId !== id)));
        await logAction('deleted', type, invoice);
    }
};

export const bulkMoveInvoicesByIds = async (type: 'entry' | 'exit', ids: string[], targetDate: Date): Promise<number> => {
    if (ids.length === 0) return 0;
    const targetDateStr = formatToISODate(targetDate);
    const allInvoices = getAllInvoices();
    
    // Identify source dates to clean up sort orders
    const sourceDates = new Set<string>();
    const updated = allInvoices.map(inv => {
        if (ids.includes(inv.id)) {
            sourceDates.add(inv.date);
            return { ...inv, date: targetDateStr };
        }
        return inv;
    });
    saveAllInvoices(updated);

    // Update target sort order
    const targetKey = `sortOrder_${type}_${targetDateStr}`;
    const targetOrder = JSON.parse(localStorage.getItem(targetKey) || '[]');
    localStorage.setItem(targetKey, JSON.stringify([...targetOrder, ...ids]));

    // Update source sort orders (Remove moved IDs)
    sourceDates.forEach(sourceDate => {
        if (sourceDate !== targetDateStr) {
            const sourceKey = `sortOrder_${type}_${sourceDate}`;
            const sourceOrder = JSON.parse(localStorage.getItem(sourceKey) || '[]');
            const newSourceOrder = sourceOrder.filter((id: string) => !ids.includes(id));
            localStorage.setItem(sourceKey, JSON.stringify(newSourceOrder));
        }
    });

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

        // Collect all searchable text from this invoice
        const searchableContent: string[] = [];
        
        // Basic Metadata
        searchableContent.push(productMap.get(inv.productId) || '');
        searchableContent.push((inv.driverName || '').toLowerCase()); // Safe lowercase
        searchableContent.push(inv.date);
        
        if (isEntry) {
            const entry = inv as Entry;
            searchableContent.push((entry.sellerName || '').toLowerCase());
            searchableContent.push((entry.billNumber || '').toString());
            searchableContent.push((entry.origin || '').toLowerCase());
            // Numeric fields
            searchableContent.push(entry.billWeight?.toString());
            searchableContent.push(entry.scaleWeight?.toString());
            searchableContent.push(entry.transportCost?.toString());
        } else {
            const exit = inv as Exit;
            searchableContent.push(farmerMap.get(exit.farmerId) || '');
            searchableContent.push((exit.invoiceNumber || '').toString());
            // Search product variant as well
            if (exit.productVariant) searchableContent.push(exit.productVariant.toLowerCase());
            // Numeric fields
            searchableContent.push(exit.weight?.toString());
        }

        // Filter out undefined/null content and check if includes term
        return searchableContent.some(content => content && content.includes(term));
    }).sort((a,b) => b.createdAt - a.createdAt);
};

// --- Formulas, Production, Adjustments, Logs ---
export const getFormulas = (): Formula[] => JSON.parse(localStorage.getItem(FORMULAS_KEY) || '[]');
export const saveFormula = (f: any) => { const fs = getFormulas(); const n = { ...f, id: `f_${Date.now()}` }; fs.push(n); localStorage.setItem(FORMULAS_KEY, JSON.stringify(fs)); return n; };
export const updateFormula = (f: any) => { const fs = getFormulas(); const i = fs.findIndex((x: any) => x.id === f.id); if (i > -1) { fs[i] = f; localStorage.setItem(FORMULAS_KEY, JSON.stringify(fs)); } };
export const deleteFormula = (id: string) => localStorage.setItem(FORMULAS_KEY, JSON.stringify(getFormulas().filter((f: any) => f.id !== id)));

export const getProductionRecords = (): ProductionRecord[] => JSON.parse(localStorage.getItem(PRODUCTION_KEY) || '[]');
export const addProductionRecord = (r: any) => { const rs = getProductionRecords(); const n = { ...r, id: `p_${Date.now()}`, createdAt: Date.now() }; rs.push(n); localStorage.setItem(PRODUCTION_KEY, JSON.stringify(rs)); return n; };
export const getProductionRecordsByDate = (d: Date) => { const s = formatToISODate(d); return getProductionRecords().filter((r: any) => r.date === s); };

export const getInventoryAdjustments = (): InventoryAdjustment[] => JSON.parse(localStorage.getItem(ADJUSTMENTS_KEY) || '[]');
export const addInventoryAdjustment = (a: any) => { const as = getInventoryAdjustments(); const n = { ...a, id: `a_${Date.now()}`, createdAt: Date.now() }; as.push(n); localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(as)); return n; };

export const getLogs = (): Log[] => JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
export const logAction = async (action: string, type: string, item: any, oldD?: any, newD?: any) => {
    const logs = getLogs();
    logs.unshift({ timestamp: Date.now(), action, actionText: `${type} ${action}`, type, details: JSON.stringify(item).substring(0, 200), by: 'user' } as any);
    if (logs.length > 1000) logs.pop();
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
};

// --- ABSOLUTE BACKUP SYSTEM (Snapshot everything in LocalStorage) ---
export const exportData = (): string => {
    const data: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
            try {
                data[key] = JSON.parse(localStorage.getItem(key) || 'null');
            } catch {
                data[key] = localStorage.getItem(key);
            }
        }
    }
    return JSON.stringify(data, null, 2);
};

export const importData = (jsonData: string): void => {
    const allData = JSON.parse(jsonData);
    localStorage.clear();
    for (const key in allData) {
        const val = allData[key];
        // Ensure values are stored as stringified JSON in localStorage to maintain structure
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    }
};

export const migrateLegacyData = () => {
    [INVOICES_KEY, LOGS_KEY, FORMULAS_KEY, PRODUCTION_KEY, ADJUSTMENTS_KEY, FARMERS_KEY].forEach(k => { if (!localStorage.getItem(k)) localStorage.setItem(k, '[]'); });
};

// --- Warehouse Inventory Status ---
export const getInventoryStatus = (until: Date): Map<string, number> => {
    const settings = loadSettings();
    const inventory = new Map<string, number>();
    settings.products.forEach(p => inventory.set(p.id, 0));
    const untilDateStr = formatToISODate(until);

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
        // Calculated Closing = Opening + Inputs - Outputs
        const expected = item.opening + item.entries + item.produced - item.exits - item.consumed;
        // The adjustments field shows the discrepancy between calculated and actual (real) closing
        // If we filtered out some entries/exits via startID, 'expected' will differ from reality, 
        // so 'adjustments' effectively shows the net weight of skipped transactions + actual adjustments.
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
        if (i.driverName === oldName) { count++; return { ...i, driverName: newName.trim() }; }
        return i;
    });
    if (count > 0) saveAllInvoices(updated);
    
    // Also remove old driver from driver list and add new one
    const drivers = getDrivers();
    const newDrivers = drivers.filter(d => d !== oldName);
    if (!newDrivers.includes(newName.trim()) && newName.trim()) {
        newDrivers.push(newName.trim());
    }
    saveDrivers(newDrivers);
    
    return count;
};

export const renameFarmer = async (id: string, newName: string): Promise<void> => {
    const fs = getFarmers();
    saveFarmers(fs.map(f => f.id === id ? { ...f, name: newName.trim() } : f));
};

export const mergeFarmers = async (sourceId: string, targetId: string): Promise<{ invoiceCount: number }> => {
    const invs = getAllInvoices();
    let count = 0;
    const updatedInvs = invs.map(i => {
        if ('farmerId' in i && i.farmerId === sourceId) { count++; return { ...i, farmerId: targetId }; }
        return i;
    });
    saveAllInvoices(updatedInvs);
    const fs = getFarmers();
    const sourceFarmer = fs.find(f => f.id === sourceId);
    const targetFarmer = fs.find(f => f.id === targetId);
    if (sourceFarmer && targetFarmer) {
        targetFarmer.broods = [...(targetFarmer.broods || []), ...(sourceFarmer.broods || [])];
    }
    saveFarmers(fs.filter(f => f.id !== sourceId));
    return { invoiceCount: count };
};

export const mergeProducts = async (sourceId: string, targetId: string): Promise<void> => {
    // 1. Update Invoices
    const allInvoices = getAllInvoices();
    let updatedInvoices = allInvoices.map(inv => inv.productId === sourceId ? { ...inv, productId: targetId } : inv);
    saveAllInvoices(updatedInvoices);

    // 2. Update Production Records
    const productions = getProductionRecords();
    const updatedProductions = productions.map(p => p.finishedGoodId === sourceId ? { ...p, finishedGoodId: targetId } : p);
    localStorage.setItem(PRODUCTION_KEY, JSON.stringify(updatedProductions));

    // 3. Update Formulas
    const formulas = getFormulas();
    const updatedFormulas = formulas.map(f => {
        let changed = false;
        // Check main product
        let newFinishedId = f.finishedGoodId;
        if (f.finishedGoodId === sourceId) { newFinishedId = targetId; changed = true; }
        
        // Check items
        const newItems = f.items.map(item => {
            if (item.productId === sourceId) { changed = true; return { ...item, productId: targetId }; }
            return item;
        });

        // Merge duplicates in items if any
        const uniqueItems: any[] = [];
        newItems.forEach(item => {
            const existing = uniqueItems.find(i => i.productId === item.productId);
            if (existing) existing.quantity += item.quantity;
            else uniqueItems.push(item);
        });

        return changed ? { ...f, finishedGoodId: newFinishedId, items: uniqueItems } : f;
    });
    localStorage.setItem(FORMULAS_KEY, JSON.stringify(updatedFormulas));

    // 4. Update Inventory Adjustments
    const adjustments = getInventoryAdjustments();
    const updatedAdjustments = adjustments.map(a => a.productId === sourceId ? { ...a, productId: targetId } : a);
    localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(updatedAdjustments));

    // 5. Update Settings (Products list, Quotas, Durations)
    const settings = loadSettings();
    
    // Remove source product
    const newProducts = settings.products.filter(p => p.id !== sourceId);
    
    // Update Quotas
    const newQuotas = settings.feedQuotas?.filter(q => q.productId !== sourceId) || [];
    
    // Update Durations
    const newDurations = { ...settings.productPhaseDurations };
    delete newDurations[sourceId];

    const newSettings = { ...settings, products: newProducts, feedQuotas: newQuotas, productPhaseDurations: newDurations };
    saveSettings(newSettings);
    
    await logAction('merged', 'product', { sourceId, targetId });
};

export const mergeDrivers = async (sourceName: string, targetName: string): Promise<number> => {
    return renameDriver(sourceName, targetName); 
};
export const getOrigins = (): string[] => {
    const str = localStorage.getItem('origins');
    if (!str) return [];
    try {
        const data = JSON.parse(str);
        return Array.isArray(data) ? data : [];
    } catch { return []; }
};
export const saveOrigins = (origins: string[]): void => {
    localStorage.setItem('origins', JSON.stringify(origins));
};
export const addOrigin = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const origins = getOrigins();
    if (!origins.includes(trimmed)) {
        saveOrigins([...origins, trimmed]);
    }
};
