
import { Settings, Entry, Exit, Log, Remittance, Product, Formula, ProductionRecord, InventoryAdjustment, Farmer, Brood, WeighbridgeListResult, WeighbridgeRecord, WeighbridgeStats, WeighbridgeCandidatesResult, WeighbridgeReport, WeighbridgeDayGoodsReport } from '../types';
import { formatToISODate, formatDate } from '../utils/formatters';

import { ApiResponse, ApiError, ApiErrorCode } from '../shared/apiContract';
import { v4 as uuidv4 } from 'uuid';
import { setCacheItem, getCacheItem, enqueueMutation, memoryCache } from './dbStore';

import { initDB, moveToFailedMutations, updateMutation, MAX_SYNC_RETRIES } from './dbStore';
import { clearLocalAuth } from './authService';
import { farmerNameKey, findClosestName, normalizePersianText, normalizePhone } from '../shared/persianText';
import { mergeBroods, softDeleteBrood, restoreBroodInList, activeBroods, deletedBroods, isBroodDeleted } from '../shared/broodMerge';

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
    entryPageTitles: [],
    exitPageTitles: [],
    enabledMenus: { warehouses: true, inventoryAnalysis: true, production: true, weighbridge: true },
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


const UNAUTHORIZED_EVENT = 'nir:unauthorized';

/**
 * Broadcast a session expiry so the UI can drop to the login screen instead of rendering an
 * empty authenticated shell. Clears the local auth mirror first.
 */
export const notifyUnauthorized = (): void => {
    try { clearLocalAuth(); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
};

/** Subscribe to 401/session-expiry events. Returns an unsubscribe function. */
export const onUnauthorized = (handler: () => void): (() => void) => {
    if (typeof window === 'undefined') return () => { /* noop */ };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
};

// --- Global sync status (additive, UI-only) ------------------------------------------
// A tiny observable so the UI can render a single global online/offline/syncing
// indicator without reaching into the IndexedDB outbox. Module-level state, never
// persisted, and it never throws (a status broadcast must not break the sync path).
export interface SyncState {
    syncing: boolean;
    lastSyncAt: number | null;
}

const syncState: SyncState = { syncing: false, lastSyncAt: null };

/** Window event dispatched whenever the sync lifecycle/state changes. */
export const SYNC_STATE_EVENT = 'sync_state_changed';

/** Read a snapshot of the current sync state. Always returns a fresh copy. */
export const getSyncState = (): SyncState => ({ ...syncState });

/**
 * Merge a patch into the sync state and notify subscribers. Guarded with try/catch so a
 * status broadcast can never throw back into callers (including `triggerSync`).
 */
const setSyncState = (patch: Partial<SyncState>): void => {
    Object.assign(syncState, patch);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_STATE_EVENT));
    } catch { /* never let a UI status update break the sync path */ }
};

export const sendRestRequest = async <T = any>(
    url: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> => {
    if (!navigator.onLine) {
        return { success: false, error: { code: 'OFFLINE', message: 'شما آفلاین هستید' } }; // Network equivalent
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

        if (response.status === 401) notifyUnauthorized();

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            // A 2xx IS a success. Some routes (and array payloads) omit the explicit flag, and the
            // outbox used to treat those as failures and retry an already-applied mutation forever.
            if (data && typeof data === 'object' && !Array.isArray(data) && (data as any).success === undefined) {
                return { ...(data as any), success: true } as ApiResponse<T>;
            }
            return data as ApiResponse<T>;
        }

        // Non-2xx: ALWAYS hand back a structured error that carries the HTTP status, even when the
        // server replied with a plain string body (`{ error: 'Invalid sync mutation.' }`) or HTML.
        // Without the status the outbox cannot tell a permanent rejection (400/422) from a
        // transient outage, and mutations clog the queue as "ghost" items forever.
        return normalizeHttpError(data, response.status) as ApiResponse<T>;
    } catch (error: any) {
        return { success: false, error: { code: 'OFFLINE', message: 'خطای شبکه' } };
    }
};

/** HTTP status -> contract error code, used when the server body carries no structured code. */
export const httpErrorCodeForStatus = (status: number): ApiErrorCode => {
    if (status === 401) return 'AUTH_FAILED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 408) return 'TIMEOUT';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 400 && status < 500) return 'VALIDATION_FAILED'; // 400/422/... = the payload itself is rejected
    return 'SERVER_ERROR';
};

/** Build a contract-shaped error out of an arbitrary (possibly unstructured) HTTP failure body. */
const normalizeHttpError = (body: any, status: number): ApiResponse<never> => {
    const fallbackCode = httpErrorCodeForStatus(status);
    const fallbackMessage = `خطای سرور (HTTP ${status})`;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { success: false, error: { code: fallbackCode, message: fallbackMessage, status } };
    }

    const raw = (body as any).error;
    if (raw && typeof raw === 'object') {
        return {
            success: false,
            error: {
                code: (raw.code || fallbackCode) as ApiErrorCode,
                message: raw.message || fallbackMessage,
                details: raw.details,
                status,
            },
        };
    }

    return {
        success: false,
        error: {
            code: fallbackCode,
            message: (typeof raw === 'string' && raw.trim() ? raw : (body as any).message) || fallbackMessage,
            status,
        },
    };
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
            payload: settings,
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

// --- Farmer duplicate detection (reconciliation UI + "did you mean...?" prompts) --------------

export interface DuplicateFarmerSuggestion {
    farmer: Farmer;
    name: string;
    kind: 'exact' | 'close';
    distance: number;
    invoiceCount: number;
}

/** Exit invoices currently attached to this farmer id. */
export const countExitsForFarmer = (farmerId: string): number =>
    getAllInvoices().filter((i: any) => i.farmerId === farmerId).length;

/**
 * The closest existing farmer to a (possibly typo/variant) name, with how many invoices hang off
 * each candidate - the reconciliation UI orders by "who owns the history".
 */
export const findDuplicateFarmer = (name: string, excludeId?: string, maxDistance = 2): DuplicateFarmerSuggestion | null => {
    if (!String(name || '').trim()) return null;
    const candidates = getFarmers().filter(f => f.id !== excludeId);
    const suggestion = findClosestName(name, candidates, (f) => f.name, maxDistance);
    if (!suggestion) return null;
    return {
        farmer: suggestion.candidate,
        name: suggestion.name,
        kind: suggestion.kind,
        distance: suggestion.distance,
        invoiceCount: countExitsForFarmer(suggestion.candidate.id),
    };
};

/** All farmer groups that share the same normalised name (i.e. server-side duplicates). */
export const findDuplicateFarmerGroups = (): { key: string; farmers: Farmer[] }[] => {
    const groups = new Map<string, Farmer[]>();
    for (const farmer of getFarmers()) {
        if ((farmer as any).isDeleted) continue;
        const key = farmerNameKey(farmer.name);
        if (!key) continue;
        const bucket = groups.get(key) || [];
        bucket.push(farmer);
        groups.set(key, bucket);
    }
    return Array.from(groups.entries())
        .filter(([, list]) => list.length > 1)
        .map(([key, list]) => ({ key, farmers: list }));
};

/**
 * Exit invoices that point at a farmer the UI cannot resolve (deleted/unknown id). Those are the
 * rows that render as «ناشناس»; the reconciliation UI lets the user re-link them.
 */
export interface OrphanInvoiceGroup {
    farmerId: string;
    invoiceIds: string[];
    totalWeight: number;
    lastDate: string;
    driverNames: string[];
}

export const findOrphanInvoiceGroups = (): OrphanInvoiceGroup[] => {
    const known = new Set(getFarmers().map(f => f.id));
    const groups = new Map<string, OrphanInvoiceGroup>();
    for (const invoice of getAllInvoices() as any[]) {
        const farmerId = invoice?.farmerId;
        if (!farmerId || known.has(farmerId)) continue;
        const group: OrphanInvoiceGroup = groups.get(farmerId) ?? { farmerId, invoiceIds: [], totalWeight: 0, lastDate: '', driverNames: [] };
        group.invoiceIds.push(invoice.id);
        group.totalWeight += Number(invoice.weight || 0);
        if (invoice.date && invoice.date > group.lastDate) group.lastDate = invoice.date;
        const driver = String(invoice.driverName || '').trim();
        if (driver && !group.driverNames.includes(driver)) group.driverNames.push(driver);
        groups.set(farmerId, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.invoiceIds.length - a.invoiceIds.length);
};

// Shape sent to the API: exactly the columns the farmers route accepts.
// CRITICAL: `id` MUST be included. Without it the server generated a brand-new randomUUID for
// every POST, so each save produced a second row that no invoice referenced - that is what turned
// farmers into «ناشناس» and created duplicate rows on every edit.
const farmerApiPayload = (f: any) => ({
    id: f?.id ? String(f.id) : undefined,
    name: normalizePersianText(f?.name ?? ''),
    phone: f?.phone === undefined || f?.phone === null || String(f.phone).trim() === '' ? null : normalizePhone(f.phone),
    broods: Array.isArray(f?.broods) ? f.broods : [],
    isHidden: Boolean(f?.isHidden),
});

const farmerApiPayloadChanged = (a: any, b: any): boolean =>
    JSON.stringify(farmerApiPayload(a)) !== JSON.stringify(farmerApiPayload(b));

/**
 * Persist the farmer list.
 *
 * 1) The local cache is written FIRST, so the UI never waits on the network (offline-first).
 * 2) The DIFF against the previous cache is then pushed to PostgreSQL: POST for new farmers,
 *    PUT for changed ones, DELETE for removed ones (or ones flagged `isDeleted`). Every failed
 *    call is queued in the outbox instead, so nothing is lost while offline.
 *
 * WHY THIS IS A FIX: this function used to write ONLY to the local cache. `hydrateFromServer`
 * REPLACES the farmers cache with the server rows on every load, so any change made through it
 * (archiving a brood = setting `endDate`, deleting/adding a brood, renaming/hiding a farmer, the
 * import modals) silently vanished on the next hydration - the "Archive does nothing" bug.
 *
 * @returns true only when every difference reached the server (or was queued for retry).
 */
export const saveFarmers = async (farmers: Farmer[]): Promise<boolean> => {
    const previousRaw = dataStore.getItem(FARMERS_KEY);
    const previous: Farmer[] = Array.isArray(previousRaw) ? previousRaw : [];

    await dataStore.setItem(FARMERS_KEY, farmers);

    const previousById = new Map(previous.map(f => [f.id, f]));
    const nextIds = new Set(farmers.map(f => f.id));
    let allPersisted = true;
    // localId -> serverId, filled when the server reused an existing farmer for this name.
    const remaps = new Map<string, string>();

    const queue = async (action: 'create' | 'update' | 'delete', payload: any) => {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action,
            entityType: 'poultryAppFarmers',
            payload,
        });
    };

    for (const farmer of farmers) {
        const prev = previousById.get(farmer.id);
        const markedDeleted = Boolean((farmer as any).isDeleted || (farmer as any).deletedAt);

        if (markedDeleted) {
            // A farmer flagged as deleted locally becomes a server-side soft delete.
            if (prev && !((prev as any).isDeleted || (prev as any).deletedAt)) {
                const res = await sendRestRequest(`/api/farmers/${encodeURIComponent(farmer.id)}`, { method: 'DELETE' });
                if (!res.success) { await queue('delete', { id: farmer.id }); allPersisted = false; }
            }
            continue;
        }

        if (!prev || (prev as any).isDeleted || (prev as any).deletedAt) {
            // New - or locally revived after a delete: POST upserts and clears deletedAt.
            const res = await sendRestRequest<any>('/api/farmers', { method: 'POST', body: JSON.stringify(farmerApiPayload(farmer)) });
            if (!res.success) { await queue('create', farmer); allPersisted = false; }
            else if (res.data?.reused && res.data?.id && res.data.id !== farmer.id) {
                // The server already had this person under another id (normalised-name match):
                // remember the remap so the local id is re-linked instead of living on as a twin.
                remaps.set(farmer.id, res.data.id);
            }
            continue;
        }

        if (!farmerApiPayloadChanged(prev, farmer)) continue;

        const res = await sendRestRequest(`/api/farmers/${encodeURIComponent(farmer.id)}`, {
            method: 'PUT',
            body: JSON.stringify(farmerApiPayload(farmer)),
        });
        if (!res.success) { await queue('update', farmer); allPersisted = false; }
    }

    // Farmers that disappeared from the list (merge, delete) are soft-deleted on the server too.
    for (const prev of previous) {
        if (nextIds.has(prev.id)) continue;
        if ((prev as any).isDeleted || (prev as any).deletedAt) continue;
        const res = await sendRestRequest(`/api/farmers/${encodeURIComponent(prev.id)}`, { method: 'DELETE' });
        if (!res.success) { await queue('delete', { id: prev.id }); allPersisted = false; }
    }

    // Re-link local ids the server resolved to an existing row (duplicate prevention). Without
    // this the local twin would keep its own id while the server row keeps another one - exactly
    // the split identity that made invoices show «ناشناس».
    if (remaps.size > 0) await applyFarmerIdRemaps(remaps);

    return allPersisted;
};

/**
 * Re-link every local reference from `localId` to the authoritative `serverId`.
 * `invoices.farmerId` is remapped in the cache AND pushed to the server (adopt endpoint), so the
 * two sides can never keep pointing at different farmer rows.
 */
export const applyFarmerIdRemaps = async (remaps: Map<string, string>): Promise<number> => {
    let touchedInvoices = 0;

    // Raw cache: a remap rewrites ids, so every unrelated row must stay untouched by definition.
    const farmers = rawFarmers();
    const nextFarmers = farmers.map(f => remaps.has(f.id) ? { ...f, id: remaps.get(f.id) as string } : f);
    // A remap can collapse two local twins into one row: keep the first occurrence only.
    const deduped: Farmer[] = [];
    const seen = new Set<string>();
    for (const farmer of nextFarmers) {
        if (seen.has(farmer.id)) continue;
        seen.add(farmer.id);
        deduped.push(farmer);
    }
    await dataStore.setItem(FARMERS_KEY, deduped);

    const invoices = getAllInvoices();
    const adoptedIdsByFarmer = new Map<string, string[]>();
    const nextInvoices = invoices.map((invoice: any) => {
        const target = invoice?.farmerId ? remaps.get(invoice.farmerId) : undefined;
        if (!target) return invoice;
        touchedInvoices += 1;
        const list = adoptedIdsByFarmer.get(target) || [];
        list.push(invoice.id);
        adoptedIdsByFarmer.set(target, list);
        return { ...invoice, farmerId: target };
    });
    if (touchedInvoices > 0) {
        await dataStore.setItem(INVOICES_KEY, nextInvoices);
        invalidateInventoryCache();
    }

    // Best effort server-side re-link: the ids are now unambiguous, so a failure only means the
    // next sync/hydration will re-attempt it (the local cache is already consistent).
    for (const [targetId, invoiceIds] of adoptedIdsByFarmer) {
        await adoptInvoicesToFarmer(targetId, invoiceIds).catch(() => 0);
    }

    return touchedInvoices;
};

export const addFarmer = async (farmerData: Partial<Farmer>): Promise<Farmer> => {
    const farmers = rawFarmers();
    const newFarmer: Farmer = {
        id: farmerData.id || `f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        // Sanitised on the way in: Arabic ي/ك and stray spaces must never create a second identity.
        name: normalizePersianText(farmerData.name) || 'مرغدار جدید',
        broods: farmerData.broods || [],
        isHidden: Boolean(farmerData.isHidden),
    };
    if (farmerData.phone !== undefined && String(farmerData.phone).trim() !== '') {
        newFarmer.phone = normalizePhone(farmerData.phone);
    }
    // Never create a local twin: if a farmer with the same normalised name already exists here,
    // reuse that row (the server applies the same rule).
    const localTwin = farmers.find(f => f.id !== newFarmer.id && farmerNameKey(f.name) === farmerNameKey(newFarmer.name));
    if (localTwin) {
        localTwin.broods = mergeBroodLists(localTwin.broods, newFarmer.broods);
        localTwin.phone = localTwin.phone || newFarmer.phone;
        await dataStore.setItem(FARMERS_KEY, farmers);
        return localTwin;
    }

    farmers.push(newFarmer);
    await dataStore.setItem(FARMERS_KEY, farmers);

    // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
    const apiRes = await sendRestRequest<any>('/api/farmers', {
        method: 'POST',
        headers: { 'X-Operation-Id': crypto.randomUUID() },
        body: JSON.stringify(farmerApiPayload(newFarmer)),
    });

    if (!apiRes.success) {
        await enqueueMutation({
            id: crypto.randomUUID(),
            action: 'create',
            entityType: 'poultryAppFarmers',
            payload: newFarmer,
        });
        return newFarmer;
    }

    // The server may have folded this into an existing row (same normalised name): re-link local
    // references so invoices never end up attached to a farmer id the server does not have.
    const serverId = apiRes.data?.id ? String(apiRes.data.id) : null;
    if (serverId && apiRes.data?.reused && serverId !== newFarmer.id) {
        await applyFarmerIdRemaps(new Map([[newFarmer.id, serverId]]));
        const adopted = getFarmers().find(f => f.id === serverId);
        if (adopted) return adopted;
    }
    return newFarmer;
};

export const updateFarmer = async (id: string, updates: Partial<Farmer>): Promise<void> => {
    // Raw cache again: this function WRITES back what it read.
    const farmers = rawFarmers();
    const index = farmers.findIndex(f => f.id === id);
    if (index > -1) {
        // Sanitise before persisting (same rule as create): a rename must not fork the identity.
        const sanitized: Partial<Farmer> = { ...updates };
        if (updates.name !== undefined) sanitized.name = normalizePersianText(updates.name);
        if (updates.phone !== undefined) {
            sanitized.phone = String(updates.phone).trim() === '' ? undefined : normalizePhone(updates.phone);
        }
        const updated = { ...farmers[index], ...sanitized };
        farmers[index] = updated;
        await dataStore.setItem(FARMERS_KEY, farmers);

        // Primary path when ONLINE: REST API -> Node/Express -> Drizzle -> PostgreSQL
        const apiRes = await sendRestRequest(`/api/farmers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(sanitized),
        });

        if (!apiRes.success) {
            await enqueueMutation({
                id: crypto.randomUUID(),
                action: 'update',
                entityType: 'poultryAppFarmers',
                payload: updated,
            });
        }
    }
};

export const deleteFarmer = async (id: string): Promise<void> => {
    // Raw cache: filtering the UI list here would drop other soft-deleted farmers as a side effect.
    const farmers = rawFarmers();
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
            payload: { id },
        });
    }
};

/**
 * The RAW farmers cache (including soft-deleted rows).
 *
 * `getFarmers()` filters/sorts for the UI - it must NEVER be used as the base of a write, because
 * writing it back would silently drop every soft-deleted farmer from IndexedDB (addFarmer,
 * updateFarmer and deleteFarmer all used to do exactly that).
 */
const rawFarmers = (): Farmer[] => {
    const raw = dataStore.getItem(FARMERS_KEY);
    return Array.isArray(raw) ? raw : [];
};

// --- Broods (periods): SOFT delete, restore, and active filtering -------------------------------

/**
 * Local reconcile of one period's soft-delete flag (the server is authoritative and already
 * changed; this only mirrors it so the UI updates instantly without waiting for hydration).
 */
const applyBroodFlagLocally = async (farmerId: string, broodId: string, mode: 'delete' | 'restore', deletedAt?: string | null) => {
    // rawFarmers(): this mirrors a server change, so it must keep every other row byte-identical
    // (including soft-deleted farmers).
    const farmers = rawFarmers();
    let touched = false;
    const next = farmers.map(farmer => {
        if (farmer.id !== farmerId) return farmer;
        touched = true;
        return {
            ...farmer,
            broods: mode === 'delete'
                ? softDeleteBrood<Brood>(farmer.broods, broodId, deletedAt || new Date().toISOString())
                : restoreBroodInList<Brood>(farmer.broods, broodId),
        };
    });
    if (!touched) return;
    await dataStore.setItem(FARMERS_KEY, next);
};

/**
 * SOFT-delete one period. The row keeps the object with a `deletedAt` flag - nothing is lost, and
 * the recycle bin can restore it.
 *
 * Deliberately SERVER-FIRST: a destructive change must not be applied locally when the server did
 * not accept it, otherwise the two sides would disagree about whether the period exists.
 */
export const deleteBrood = async (farmerId: string, broodId: string): Promise<string> => {
    const res = await sendRestRequest<any>(
        `/api/farmers/${encodeURIComponent(farmerId)}/broods/${encodeURIComponent(broodId)}`,
        { method: 'DELETE', headers: { 'X-Operation-Id': crypto.randomUUID() } },
    );
    if (!res.success) {
        throw new Error(res.error?.message || 'حذف دوره ناموفق بود. اتصال سرور را بررسی کنید.');
    }
    const deletedAt = res.data?.deletedAt ? String(res.data.deletedAt) : new Date().toISOString();
    await applyBroodFlagLocally(farmerId, broodId, 'delete', deletedAt);
    await logAction('updated', 'farmer', { id: farmerId, name: '' }).catch(() => {});
    return deletedAt;
};

/** Restore a soft-deleted period (clears its `deletedAt` flag on the server, then locally). */
export const restoreBrood = async (farmerId: string, broodId: string): Promise<void> => {
    const res = await sendRestRequest<any>(
        `/api/farmers/${encodeURIComponent(farmerId)}/broods/${encodeURIComponent(broodId)}/restore`,
        { method: 'PUT', headers: { 'X-Operation-Id': crypto.randomUUID() } },
    );
    if (!res.success) {
        throw new Error(res.error?.message || 'بازیابی دوره ناموفق بود. اتصال سرور را بررسی کنید.');
    }
    await applyBroodFlagLocally(farmerId, broodId, 'restore');
    await logAction('updated', 'farmer', { id: farmerId, name: '' }).catch(() => {});
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
                payload: { id: trimmed, name: trimmed },
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
            payload: { id: nameToDelete, name: nameToDelete },
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

// --- Invoice ordering helpers (newest-first, deterministic, non-mutating) ---
// Resolve a numeric millisecond timestamp for any invoice:
//  1) numeric `createdAt` (server rows via coerceMs),
//  2) parseable `createdAt` string/date,
//  3) the millisecond stamp embedded in generated ids (`inv_<ms>_<rand>` and the legacy
//     `local_<ms>_<rand>` shape written by the pre-V2 importer),
//  4) 0 as a last resort so the comparator never yields NaN.
export const createdMs = (inv: any): number => {
    const c = inv?.createdAt;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (c) {
        const parsed = typeof c === 'string' ? Date.parse(c) : new Date(c).getTime();
        if (Number.isFinite(parsed)) return parsed;
    }
    // Both id shapes embed epoch-ms as the first 13-digit group. Ignoring `local_` ids made
    // them resolve to 0 and jump to the TOP of a chronological list.
    const m = /^(?:inv|local)_(\d{10,})_/.exec(String(inv?.id ?? ''));
    if (m) return Number(m[1]);
    return 0;
};

// Newest-first with a deterministic descending-id tiebreaker. Always returns a NEW array,
// so it is safe to apply to shared/cached arrays without mutating them in place.
export const sortNewestFirst = <T extends Remittance>(list: T[]): T[] =>
    [...list].sort((a, b) => (createdMs(b) - createdMs(a)) || String(b.id).localeCompare(String(a.id)));

// Chronological order (oldest -> newest) with a deterministic id tiebreaker.
// This is the DISPLAY DEFAULT: a freshly added invoice belongs at the BOTTOM of its day, in the
// natural order the invoices were physically issued. (The previous default was newest-first,
// which made every new invoice jump to row 1 - reversed by the user's request on 2026-09-16.)
export const sortChronological = <T extends Remittance>(list: T[]): T[] =>
    [...list].sort((a, b) => (createdMs(a) - createdMs(b)) || String(a.id).localeCompare(String(b.id)));

// Read the authoritative per-day manual position of an invoice as delivered by the server.
// The DB column is `sort_order` (integer, 0-based, per type+date); the API serializes it as
// `sortOrder`. Accept both spellings and numeric strings so the fallback never silently no-ops.
const serverOrdinal = (inv: any): number | null => {
    const v = inv?.sortOrder ?? inv?.sort_order;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
};

// Reconstruct the manual order for one (type,date) from the server `sort_order` ordinal.
// Rows that carry no ordinal (brand-new invoices) are appended newest-first. Returns `null`
// when nothing carries an ordinal, so the caller keeps the default newest-first order.
const orderIdsFromServer = <T extends Remittance>(filtered: T[]): string[] | null => {
    const withOrdinal = filtered.filter(inv => serverOrdinal(inv) !== null);
    if (withOrdinal.length === 0) return null;
    const ordered = [...withOrdinal].sort((a, b) => {
        const d = (serverOrdinal(a) as number) - (serverOrdinal(b) as number);
        return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
    });
    const listed = new Set(ordered.map(inv => inv.id));
    const remainder = sortChronological(filtered.filter(inv => !listed.has(inv.id)));
    return [...ordered.map(inv => inv.id), ...remainder.map(inv => inv.id)];
};

// --- Server-authoritative manual order (device-sync fix) --------------------------------
// `sort_order` is the Source of Truth: every hydration rebuilds the per-day localStorage
// layout from the server ordinals, so a device holding a stale layout can no longer disagree
// with the device that last dragged those rows. Rows WITHOUT an ordinal (brand-new invoices)
// stay at the BOTTOM in chronological order, exactly like the saved-layout remainder.
export const ORDER_SYNCED_EVENT = 'nir:order_synced';

// Buckets this device saved very recently: a hydration that lands while the PUT is still in
// flight must not clobber the layout the user just committed on this very device.
const recentLocalOrderWrites: Record<string, number> = {};
const ORDER_WRITE_GRACE_MS = 15000;

const applyServerOrderToLocalPreferences = (invoices: Remittance[]): number => {
    const buckets = new Map<string, Remittance[]>();
    invoices.forEach(inv => {
        if (!inv || !inv.id || !inv.date) return;
        const bucket = `${('sellerName' in inv) ? 'entry' : 'exit'}_${inv.date}`;
        const rows = buckets.get(bucket);
        if (rows) rows.push(inv); else buckets.set(bucket, [inv]);
    });

    const now = Date.now();
    let changed = 0;

    buckets.forEach((rows, bucket) => {
        const withOrdinal = rows.filter(inv => serverOrdinal(inv) !== null);
        if (withOrdinal.length === 0) return;                                            // nothing authoritative to apply
        if (now - (recentLocalOrderWrites[bucket] || 0) < ORDER_WRITE_GRACE_MS) return;  // our own save is still in flight

        const ordered = [...withOrdinal].sort((a, b) => {
            const d = (serverOrdinal(a) as number) - (serverOrdinal(b) as number);
            return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
        });
        const listed = new Set(ordered.map(inv => inv.id));
        const remainder = sortChronological(rows.filter(inv => !listed.has(inv.id)));
        const next = JSON.stringify([...ordered.map(inv => inv.id), ...remainder.map(inv => inv.id)]);

        const key = `sortOrder_${bucket}`;
        if (localStorage.getItem(key) !== next) {
            localStorage.setItem(key, next);
            changed += 1;
        }
    });

    return changed;
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
            if (Array.isArray(orderedIds) && orderedIds.length > 0) {
                const invoiceMap = new Map(filtered.map(inv => [inv.id, inv]));
                const sortedInvoices: T[] = [];
                orderedIds.forEach((id: string) => {
                    const invoice = invoiceMap.get(id);
                    if (invoice) {
                        sortedInvoices.push(invoice as T);
                        invoiceMap.delete(id);
                    }
                });
                // Keep the saved manual order for listed ids, but order the remaining (unlisted)
                // invoices newest-first instead of leaving them in raw cache order.
                return [...sortedInvoices, ...sortChronological(Array.from(invoiceMap.values()) as T[])];
            }
            // Treat an empty saved array the same as a missing key, so the durable fallback
            // below can repopulate it.
        } catch (_e) {
            // Sort order parsing error, fallback to default order
        }
    }

    // Durable fallback (the HTTPS-origin / fresh-device failsafe): when this browser has no
    // saved manual order for the day, rebuild it from the server's per-day `sort_order`
    // ordinal and SEED the local preference, so the manual layout reproduces itself on any
    // new origin, cache clear, or device without a console step.
    const serverOrderIds = orderIdsFromServer(filtered);
    if (serverOrderIds) {
        try {
            localStorage.setItem(sortOrderKey, JSON.stringify(serverOrderIds));
        } catch (_e) {
            // Private mode / quota: still apply the order for this render.
        }
        const byId = new Map<string, T>(filtered.map(inv => [inv.id, inv]));
        return serverOrderIds.map(id => byId.get(id)).filter((inv): inv is T => inv !== undefined);
    }

    // Chronological (oldest first) with a deterministic id tiebreaker. This is the failsafe
    // order: it never depends on `createdAt` being present, so locally created / offline /
    // not-yet-hydrated rows sort correctly instead of degrading to id-only order - and a new
    // invoice lands at the BOTTOM of its day.
    return sortChronological(filtered);
};


export const addInvoice = async (invoiceData: any, type: 'entry' | 'exit'): Promise<void> => {
    const operationId = uuidv4();
    const id = invoiceData.id || `inv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    // Stamp a client-side createdAt so ordering works immediately, even before the next
    // server round-trip/hydration (previously locally-created rows had no createdAt at all).
    const newInvoice = { ...invoiceData, id, type, createdAt: (typeof invoiceData?.createdAt === 'number' && Number.isFinite(invoiceData.createdAt)) ? invoiceData.createdAt : Date.now() };
    if (type === 'exit' && newInvoice.farmerId) {
        const _farmer = getFarmers().find((f: any) => f.id === newInvoice.farmerId);
        if (_farmer && _farmer.name) newInvoice.farmerName = _farmer.name;
    }
    if (type === 'entry') {
        // The افت (deduction) is ALWAYS derived from the two weights - a client-side value is never
        // trusted. Regression: "ثبت و افزودن محصول دیگر" used to leave `wastage: 0` in the form
        // state, so the second row was persisted with a zero deduction.
        newInvoice.wastage = safeParseFloat(newInvoice.scaleWeight) - safeParseFloat(newInvoice.billWeight);
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

    // Copy before mutating: getAllInvoices() hands out the LIVE cache array, so pushing into it
    // would mutate shared state (and could diverge from IndexedDB if the persist step fails).
    const allInvoices = [...getAllInvoices()];
    allInvoices.push(newInvoice);
    await saveAllInvoices(allInvoices);
    
    try {
        const key = `sortOrder_${type}_${newInvoice.date}`;
        const currentOrder = JSON.parse(localStorage.getItem(key) || '[]');
        // APPEND so a newly added invoice lands at the BOTTOM of the day's list, matching the
        // natural chronological flow (the day reads oldest -> newest, top -> bottom).
        localStorage.setItem(key, JSON.stringify([...currentOrder.filter((x: string) => x !== id), id]));
    } catch (e) {}
    
    if (newInvoice.driverName?.trim()) await addDriver(newInvoice.driverName).catch(() => {});
    if (type === 'entry' && newInvoice.origin?.trim()) await addOrigin(newInvoice.origin).catch(() => {});
    invalidateInventoryCache();
    await logAction('created', type, newInvoice).catch(() => {});
};

export const updateInvoice = async (id: string, updates: any): Promise<void> => {
    // Copy before mutating (same reason as addInvoice): the cache array is shared, not a value.
    const allInvoices = [...getAllInvoices()];
    const index = allInvoices.findIndex(inv => inv.id === id);
    if (index === -1) return;
    
    const original = allInvoices[index];
    const expectedVersion = (original as any).version || 1;
    const operationId = uuidv4();
    const updated = { ...original, ...updates };
    const type = 'sellerName' in updated ? 'entry' : 'exit';
    
    if ('scaleWeight' in updated && 'billWeight' in updated) {
        // Same rule as create: the entry deduction is derived, never taken from the caller.
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
            return { ...inv, date: targetDateStr } as any;
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
                payload: inv,
            });
        }
    }

    await logAction('bulkMoved', 'bulkMove', { count: ids.length, subType: type }).catch(() => {});
    return ids.length;
};

// Push the manual per-day order to the server so it survives a cache clear and reaches other
// devices. Deliberately non-blocking: localStorage stays the source of truth for the rendered
// order, so a failure here (offline, expired session, VIEWER role) only logs and never disturbs
// the UI. The server derives the ordinals from this exact id sequence, so the two cannot drift.
export const syncOrderToServer = async (
    type: 'entry' | 'exit',
    date: Date,
    orderedIds: string[]
): Promise<boolean> => {
    const payload = { type, date: formatToISODate(date), orderedIds };
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) timer = setTimeout(() => controller.abort(), 10000);
        const res = await sendRestRequest<any>('/api/invoices/order', {
            method: 'PUT',
            headers: { 'X-Operation-Id': uuidv4() },
            body: JSON.stringify(payload),
            ...(controller ? { signal: controller.signal } : {}),
        });
        if (!res.success) {
            // Expected for a VIEWER (403) or an expired session (401) - not an error the user
            // must see, because the local layout was already applied.
            console.warn('[NIR] server order sync skipped:', res.error?.code || 'UNKNOWN');
            return false;
        }
        return true;
    } catch (error: any) {
        console.warn('[NIR] server order sync failed (local order kept):', error?.message || error);
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
};

export const saveOrderForDate = async (type: 'entry' | 'exit', date: Date, orderedIds: string[]): Promise<void> => {
    const bucket = `${type}_${formatToISODate(date)}`;
    // 1) Local write first, synchronously: the visible order must never wait on the network.
    localStorage.setItem(`sortOrder_${bucket}`, JSON.stringify(orderedIds));
    // 2) Mark the bucket so a hydration landing while the PUT is still in flight cannot clobber
    //    the layout the user just committed here.
    recentLocalOrderWrites[bucket] = Date.now();
    // 2) Durable background write. Fire-and-forget on purpose: the caller awaits this function
    //    before showing its "layout saved" toast, so awaiting the round-trip here would put the
    //    network (or a 10s timeout) in front of the user's click. The promise is intentionally
    //    not awaited - syncOrderToServer never rejects and only logs.
    void syncOrderToServer(type, date, orderedIds);
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

        // Invoice free-text (Persian «توضیحات»). The authoritative server column is
        // `invoices.notes` and it exists on BOTH entry and exit rows. Read defensively
        // (null/undefined safe) and tolerate legacy `description`/`details` aliases so
        // offline/local search keeps working regardless of which key carries the text.
        for (const freeTextField of ['notes', 'note', 'description', 'details'] as const) {
            const rawFreeText = (inv as any)[freeTextField];
            if (typeof rawFreeText === 'string' && rawFreeText) {
                searchableContent.push(rawFreeText.toLowerCase());
            }
        }

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
    const newFormula = { ...f, id: f.id || `fml_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` } as any;
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
            payload: newFormula,
        });
    }
    return newFormula;
};

export const updateFormula = async (f: any): Promise<void> => {
    const fs = getFormulas();
    const i = fs.findIndex((x: any) => x.id === f.id);
    if (i > -1) {
        const updated = { ...fs[i], ...f };
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
                payload: updated,
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
            payload: { id },
        });
    }
};

export const getProductionRecords = (): ProductionRecord[] => {
    const list = dataStore.getItem(PRODUCTION_KEY);
    return Array.isArray(list) ? list.filter(p => !p.deletedAt) : [];
};

export const addProductionRecord = async (r: any): Promise<ProductionRecord> => {
    const rs = getProductionRecords();
    const newRecord = { ...r, id: r.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` } as any;
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
            payload: newRecord,
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
            payload: { id },
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
    const newAdj = { ...a, id: a.id || `adj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` } as any;
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
            payload: newAdj,
        });
    }
    return newAdj;
};

// --- Audit trail (server-authoritative, ADMIN/MANAGER only) --------------------------------
// Reads rows written by the backend inside the same transaction as each invoice change, so the
// trail cannot be edited or omitted by a browser.
export interface AuditChange { field: string; label: string; from: any; to: any; }

export interface AuditLogRow {
    id: string;
    userId?: string | null;
    username?: string | null;
    role?: string | null;
    action: string;
    entity: string;
    targetIds?: string[] | null;
    summary?: { changes?: AuditChange[]; context?: any } | null;
    details?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string | number;
}

export interface AuditQuery {
    page?: number;
    limit?: number;
    action?: string;
    entity?: string;
    user?: string;
    from?: string;
    to?: string;
    search?: string;
}

export const fetchAuditLogs = async (
    query: AuditQuery = {}
): Promise<{ logs: AuditLogRow[]; total: number; page: number; limit: number; totalPages: number } | null> => {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || String(value).trim() === '') return;
        qs.set(key, String(value));
    });

    const res = await sendRestRequest<any>(`/api/audit?${qs.toString()}`);
    if (!res.success) {
        // Expected for a VIEWER (403) or an expired session (401): the caller shows a notice.
        console.warn('[NIR] audit fetch skipped:', res.error?.code || res.error?.message || 'UNKNOWN');
        return null;
    }
    return res.data;
};

// --- Reporting dashboard (server-aggregated, ADMIN/MANAGER/ACCOUNTING) ----------------------
// Purely additive: the values come from GET /api/reports/summary (SUM/GROUP BY in PostgreSQL).
export interface ReportSummaryRow {
    productId: string;
    productName: string;
    type: string;
    rows: number;
    totalWeight: number;
    billWeight: number;
    wastage: number;
    transportCost: number;
}
export interface ReportVariantRow { type: string; variant: string; rows: number; totalWeight: number; }
export interface ReportDayRow { date: string; type: string; rows: number; totalWeight: number; }
// Drivers / logistics (entry + exit invoices): per-driver service, weight and freight breakdown.
export interface ReportDriverRow {
    driver: string;
    entryServices: number;
    exitServices: number;
    totalServices: number;
    entryWeight: number;
    exitWeight: number;
    totalWeight: number;
    entryCost: number;
    exitCost: number;
    totalCost: number;
    lastDate: string;
}
export interface ReportSummary {
    startDate: string;
    endDate: string;
    generatedAt: string;
    totals: {
        entryWeight: number; exitWeight: number; entryRows: number; exitRows: number;
        billWeight: number; wastage: number; transportCost: number; netWeight: number; rows: number;
    };
    byProduct: ReportSummaryRow[];
    byVariant: ReportVariantRow[];
    byDay: ReportDayRow[];
    byDriver: ReportDriverRow[];
    driverTotals: {
        drivers: number;
        entryServices: number;
        exitServices: number;
        totalServices: number;
        entryWeight: number;
        exitWeight: number;
        totalWeight: number;
        entryCost: number;
        exitCost: number;
        totalCost: number;
    };
}

export const fetchReportSummary = async (startDate: string, endDate: string): Promise<ReportSummary | null> => {
    const qs = new URLSearchParams({ startDate, endDate });
    const res = await sendRestRequest<ReportSummary>(`/api/reports/summary?${qs.toString()}`, { method: 'GET' });
    if (!res.success) {
        // 403 for a VIEWER, 401 for an expired session: the dashboard shows a notice instead.
        console.warn('[NIR] report summary skipped:', res.error?.code || res.error?.message || 'UNKNOWN');
        return null;
    }
    return res.data as ReportSummary;
};

export const getLogs = (): Log[] => {
    const list = dataStore.getItem(LOGS_KEY);
    return Array.isArray(list) ? list : [];
};

export const logAction = async (action: string, type: string, item: any, oldD?: any, newD?: any) => {
    const logs = getLogs();
    const newLog: Log = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
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
        payload: newLog,
    });
};

// --- BACKUP AND RESTORE (Server-backed authoritative snapshot) ---

export interface ImportSummary {
    restoredTables: Record<string, number>;
    verifiedCounts?: Record<string, number>;
    skippedTables?: string[];
    totalRows?: number;
    skippedKeys?: string[];
    warnings?: string[];
    /** true when only the local offline cache could be restored (server unreachable). */
    localOnly?: boolean;
    /** true when a pre-V2 (legacy) backup was migrated server-side. */
    legacy?: boolean;
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
    const keys = await db.getAllKeys('cache');
    const values = await db.getAll('cache');
    const snapshot: Record<string, any> = {};
    keys.forEach((key, i) => { snapshot[key as string] = values[i]; });
    return JSON.stringify(snapshot, null, 2);
};

/**
 * Import a backup. Throws a precise, user-facing error when the restore fails -
 * a failed restore must never be reported as success by the UI.
 */
export const importData = async (jsonData: string, options: { wipe?: boolean } = {}): Promise<ImportSummary> => {
    let parsed: any;
    try {
        parsed = JSON.parse(jsonData);
    } catch {
        throw new Error('فایل پشتیبان نامعتبر است (JSON خوانده نشد).');
    }

    const isServerSnapshot = parsed && typeof parsed === 'object' && parsed.tables && typeof parsed.tables === 'object';

    // Pre-V2 backups are a flat `poultryApp*` key -> value map. They MUST go through the
    // server: writing them to the local cache (the old behaviour) is why a restore once
    // "saved" but the application still had no data.
    const LEGACY_KEYS = ['poultryAppSettings', 'poultryAppProducts', 'poultryAppFarmers', 'poultryAppDrivers', 'poultryAppOrigins', 'poultryAppFormulas', 'poultryAppInvoices', 'poultryAppAdjustments', 'poultryAppProduction', 'poultryAppLogs', 'origins'];
    const isLegacySnapshot = !isServerSnapshot && parsed && typeof parsed === 'object' && LEGACY_KEYS.some((k) => (parsed as any)[k] !== undefined);

    if (isLegacySnapshot) {
        // Purely client-side preferences that live in localStorage (print ordering, language)
        // are restored locally; everything else is migrated server-side in one transaction.
        for (const key of Object.keys(parsed)) {
            if (!key.startsWith('sortOrder_') && key !== 'i18nextLng') continue;
            try {
                const value = parsed[key];
                window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            } catch { /* best-effort: quota / private mode */ }
        }

        const res = await fetch(`/api/backup/restore-legacy${options.wipe ? '?wipe=true' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: jsonData,
        });
        const payload = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            throw new Error(payload?.error || `بازیابی پشتیبان قدیمی ناموفق بود (HTTP ${res.status}).`);
        }

        invalidateInventoryCache();
        try { await hydrateFromServer(); } catch { /* local refresh is best-effort */ }

        return {
            restoredTables: payload.restoredTables || {},
            verifiedCounts: payload.verifiedCounts,
            skippedTables: payload.skippedKeys,
            skippedKeys: payload.skippedKeys,
            warnings: payload.warnings,
            totalRows: payload.totalRows,
            legacy: true,
        };
    }

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
        await db.put('cache', parsed[key], key);
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
const authoritativeStockCache = new Map<string, { timestamp: number, payload: Map<string, number> }>();
const invalidateInventoryCache = () => { authoritativeStockCache.clear(); };
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
        return cached.payload;
    }

    const settings = loadSettings();
    const inventory = new Map<string, number>();
    settings.products.forEach(p => inventory.set(p.id, 0));

    // Build the ledger view from the hydrated cache (invoices + production + adjustments).
    // Previously this array was always empty, so every stock figure read 0 even with data loaded.
    const allTransactions: any[] = [
        ...getAllInvoices().map((inv: any) => ({ date: inv.date, createdAt: inv.createdAt || 0, type: 'invoice', data: inv })),
        ...getProductionRecords().map((p: any) => ({ date: p.date, createdAt: p.createdAt || 0, type: 'production', data: p })),
        ...getInventoryAdjustments().map((a: any) => ({ date: a.date, createdAt: a.createdAt || 0, type: 'adjustment', data: a })),
    ];

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
    const cleanName = normalizePersianText(newName);
    if (!cleanName) throw new Error('نام مرغدار نمی‌تواند خالی باشد.');
    const fs = getFarmers();
    const updated = fs.map((f: any) => f.id === id ? { ...f, name: cleanName } : f);
    // saveFarmers now persists the change itself (and queues it only when the API call fails),
    // so the extra enqueueMutation that used to live here would double-write on the next sync.
    await saveFarmers(updated);
};

export const mergeFarmers = async (sourceId: string, targetId: string): Promise<{ invoiceCount: number }> => {
    if (!sourceId || !targetId) throw new Error('انتخاب مرغدار مبدا و مقصد الزامی است.');
    if (sourceId === targetId) throw new Error('مرغدار مبدا و مقصد نمی‌توانند یکسان باشند.');

    const res = await sendRestRequest<any>('/api/farmers/merge', {
        method: 'POST',
        headers: { 'X-Operation-Id': crypto.randomUUID() },
        body: JSON.stringify({ sourceId, targetId }),
    });

    if (!res.success) {
        // Merging is a server-authoritative cascade (one SQL transaction). Applying it locally
        // while offline would leave the two sides disagreeing about who owns the invoices, so it
        // is refused with a clear message instead of half-applied.
        throw new Error(res.error?.message || 'ادغام مرغدار ناموفق بود. اتصال سرور را بررسی کنید.');
    }

    const movedInvoices = Number(res.data?.movedInvoices || 0);

    // Local reconcile: the source farmer and its references are re-pointed to the target, so the
    // UI is correct immediately (and hydration confirms the server state right after).
    const fs = getFarmers();
    const sourceFarmer = fs.find(f => f.id === sourceId);
    const targetFarmer = fs.find(f => f.id === targetId);

    await applyFarmerIdRemaps(new Map([[sourceId, targetId]]));

    if (sourceFarmer && targetFarmer) {
        // rawFarmers() as the write base: using the filtered UI list here would drop every
        // soft-deleted farmer row from IndexedDB.
        const merged = rawFarmers().map(f => f.id === targetId
            ? { ...f, broods: mergeBroodLists(f.broods, sourceFarmer.broods), phone: f.phone || sourceFarmer.phone, updatedAt: Date.now() }
            : f);
        await dataStore.setItem(FARMERS_KEY, merged.filter(f => f.id !== sourceId && f.id !== sourceFarmer.id));
    }

    logAction('updated', 'farmer', { id: targetId, name: targetFarmer?.name || targetId }).catch(() => {});
    await hydrateFromServer().catch(() => false);

    return { invoiceCount: movedInvoices };
};

/** Brood (period) union used by the local reconcile: the SAME deep de-duplication as the server. */
const mergeBroodLists = (base: Brood[] | undefined, extra: Brood[] | undefined): Brood[] =>
    mergeBroods(base as any, extra as any) as unknown as Brood[];

/**
 * Re-link a set of invoices to a farmer (adoption).
 * Updates the local cache first (so the «ناشناس» label disappears immediately) and then the
 * server in one transaction. Returns how many rows actually changed.
 */
export const reassignInvoicesToFarmer = async (targetId: string, invoiceIds: string[]): Promise<number> => {
    const target = String(targetId || '');
    const ids = new Set((invoiceIds || []).filter(Boolean));
    if (!target || ids.size === 0) return 0;

    const invoices = getAllInvoices();
    let localChanged = 0;
    const nextInvoices = invoices.map((invoice: any) => {
        if (!ids.has(invoice.id) || invoice.farmerId === target) return invoice;
        localChanged += 1;
        return { ...invoice, farmerId: target };
    });
    if (localChanged > 0) {
        await dataStore.setItem(INVOICES_KEY, nextInvoices);
        invalidateInventoryCache();
    }

    const serverMoved = await adoptInvoicesToFarmer(target, Array.from(ids)).catch(() => 0);
    return Math.max(localChanged, serverMoved);
};

/**
 * Attach orphaned exit invoices (rows whose farmer was deleted by the old buggy merge) to a
 * farmer. Returns how many rows the server re-linked.
 */
export const adoptInvoicesToFarmer = async (targetId: string, invoiceIds: string[]): Promise<number> => {
    const ids = Array.from(new Set((invoiceIds || []).filter(Boolean)));
    if (!targetId || ids.length === 0) return 0;

    const res = await sendRestRequest<any>(`/api/farmers/${encodeURIComponent(targetId)}/adopt-invoices`, {
        method: 'POST',
        headers: { 'X-Operation-Id': crypto.randomUUID() },
        body: JSON.stringify({ invoiceIds: ids }),
    });
    if (!res.success) return 0;
    return Number(res.data?.movedInvoices || 0);
};

export const mergeProducts = async (sourceId: string, targetId: string): Promise<void> => {
    const allInvoices = getAllInvoices();
    const updatedInvoices = allInvoices.map((i: any) => i.productId === sourceId ? { ...i, productId: targetId } : i);
    await saveAllInvoices(updatedInvoices);

    const productions = getProductionRecords();
    const updatedProductions = productions.map((p: any) => p.productId === sourceId ? { ...p, productId: targetId } : p);
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

        return { ...f, finishedGoodId: newFinishedId, items: uniqueItems };
    });
    await dataStore.setItem(FORMULAS_KEY, updatedFormulas);

    const adjustments = getInventoryAdjustments();
    const updatedAdjustments = adjustments.map((a: any) => a.productId === sourceId ? { ...a, productId: targetId } : a);
    await dataStore.setItem(ADJUSTMENTS_KEY, updatedAdjustments);

    const settings = loadSettings();
    const newProducts = settings.products.filter(p => p.id !== sourceId);
    const newQuotas = settings.feedQuotas?.filter(q => q.productId !== sourceId) || [];
    const newDurations = { ...settings.productPhaseDurations };
    delete newDurations[sourceId];

    const newSettings = { ...settings, products: newProducts, feedQuotas: newQuotas, productPhaseDurations: newDurations };
    await saveSettings(newSettings);
    
    await logAction('merged', 'product', { sourceId, targetId }).catch(() => {});
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
                payload: { id: trimmed, name: trimmed },
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
            payload: { id: nameToDelete, name: nameToDelete },
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


const coerceMs = (v: any): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = Date.parse(String(v ?? ''));
    return Number.isFinite(t) ? t : 0;
};

const coerceNum = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
};

/**
 * Map an authoritative server invoice row onto the client Remittance shape.
 *
 * IMPORTANT: every screen distinguishes entry from exit with the expression
 * `'sellerName' in invoice`. Server rows always carry a `sellerName` key (null for
 * exits), so an exit that keeps the key is mis-rendered as an entry. We therefore
 * DELETE `sellerName` from exit rows here.
 */
const mapServerInvoice = (r: any): Remittance => {
    const isEntry = r?.type === 'entry' || (r?.type == null && r?.sellerName != null);
    if (isEntry) {
        const entry: any = {
            ...r,
            sellerName: r.sellerName ?? '',
            billWeight: coerceNum(r.billWeight),
            scaleWeight: coerceNum(r.scaleWeight),
            wastage: coerceNum(r.wastage),
            transportCost: coerceNum(r.transportCost),
            createdAt: coerceMs(r.createdAt),
        };
        // Key-presence convention the whole UI relies on:
        //   entry -> `'sellerName' in inv` === true  AND  `'farmerId' in inv` === false
        //   exit  -> `'sellerName' in inv` === false AND  `'farmerId' in inv` === true
        // The server sends every column for both shapes, so the opposite key must be removed.
        // (reports/global-search/analysis detect entries via 'sellerName';
        //  farmers/active-broods/analysis detect exits via 'farmerId'.)
        delete entry.farmerId;
        return entry as Entry;
    }
    const exit: any = {
        ...r,
        weight: coerceNum(r.weight),
        createdAt: coerceMs(r.createdAt),
    };
    delete exit.sellerName; // <- keeps `'sellerName' in inv` === false for exits
    return exit as Exit;
};

/**
 * Hydrate the entire local cache from the authoritative server snapshot.
 *
 * This is the fix for the "UI is empty after a cache clear" outage: previously the app
 * only ever pulled invoices, and only as a side effect of a sync/import, so a freshly
 * cleared browser showed nothing. Every screen reads synchronously from the local cache,
 * so we must prime every dataset here before any page renders.
 */
export const hydrateFromServer = async (): Promise<boolean> => {
    const write = async (key: string, value: any): Promise<void> => {
        memoryCache[key] = value;
        const db = await initDB();
        await db.put('cache', value, key);
    };

    try {
        const res = await fetch('/api/sync/state', { credentials: 'include', cache: 'no-store' });
        if (res.status === 401) {
            // Session expired: never hold an authenticated-but-empty shell on screen.
            notifyUnauthorized();
            return false;
        }
        if (res.ok) {
            const s = await res.json();
            if (s && typeof s === 'object') {
                if (s.settings && typeof s.settings === 'object') {
                    await write(SETTINGS_KEY, { ...DEFAULT_SETTINGS, ...s.settings });
                }
                if (Array.isArray(s.invoices)) {
                    const serverInvoices = s.invoices.map(mapServerInvoice);
                    await write(INVOICES_KEY, serverInvoices);
                    // Server ordinals are authoritative: rebuild the per-day layouts from them so
                    // every device renders the same order for the same day.
                    if (applyServerOrderToLocalPreferences(serverInvoices) > 0) {
                        if (typeof window !== 'undefined') window.dispatchEvent(new Event(ORDER_SYNCED_EVENT));
                    }
                }
                if (Array.isArray(s.farmers)) {
                    await write(FARMERS_KEY, s.farmers.map((f: any) => ({
                        ...f,
                        broods: Array.isArray(f.broods) ? f.broods : [],
                        updatedAt: coerceMs(f.updatedAt),
                    })));
                }
                if (Array.isArray(s.drivers)) {
                    await write(DRIVERS_KEY, s.drivers.map((d: any) => (typeof d === 'string' ? d : d?.name)).filter(Boolean));
                }
                if (Array.isArray(s.origins)) {
                    await write(ORIGINS_KEY, s.origins.map((o: any) => (typeof o === 'string' ? o : o?.name)).filter(Boolean));
                }
                if (Array.isArray(s.formulas)) {
                    await write(FORMULAS_KEY, s.formulas.map((f: any) => ({
                        id: f.id,
                        finishedGoodId: f.finishedGoodId,
                        items: (Array.isArray(f.items) ? f.items : []).map((i: any) => ({ productId: i.productId, quantity: coerceNum(i.quantity) })),
                    })));
                }
                if (Array.isArray(s.production)) {
                    await write(PRODUCTION_KEY, s.production.map((p: any) => ({ ...p, quantityProduced: coerceNum(p.quantityProduced), createdAt: coerceMs(p.createdAt) })));
                }
                if (Array.isArray(s.adjustments)) {
                    await write(ADJUSTMENTS_KEY, s.adjustments.map((a: any) => ({ ...a, newQuantity: coerceNum(a.newQuantity), createdAt: coerceMs(a.createdAt) })));
                }
                if (Array.isArray(s.logs)) {
                    await write(LOGS_KEY, s.logs.map((l: any) => ({ ...l, timestamp: coerceMs(l.timestamp) })));
                }
                invalidateInventoryCache();
                return true;
            }
        }
    } catch (e) {
        console.error('Full hydration from /api/sync/state failed:', e);
    }

    // Fallback: the old invoices-only path (kept so an older server build still hydrates something).
    try {
        const apiRes: any = await sendRestRequest('/api/invoices');
        const candidates = [apiRes?.data, apiRes?.invoices, apiRes?.data?.data, Array.isArray(apiRes) ? apiRes : null];
        const invoices = candidates.find((c) => Array.isArray(c));
        if (Array.isArray(invoices)) {
            const serverInvoices = invoices.map(mapServerInvoice);
            await saveAllInvoices(serverInvoices);
            if (applyServerOrderToLocalPreferences(serverInvoices) > 0) {
                if (typeof window !== 'undefined') window.dispatchEvent(new Event(ORDER_SYNCED_EVENT));
            }
            invalidateInventoryCache();
            return true;
        }
        console.error('Hydration failed: expected an array of invoices.');
    } catch (e) {
        console.error('Hydration fallback failed:', e);
    }
    return false;
};

/**
 * How the outbox must react to one failed mutation.
 *
 *  - applied   : already applied by the server (idempotency key reuse) -> drop it
 *  - defer     : connectivity / session / throttling problem -> keep it, do NOT burn retries
 *  - permanent : the payload itself is rejected (validation 400/422, conflict, unknown
 *                reference, forbidden) -> dead-letter at once, because retrying cannot ever
 *                make it valid. This is what stops "ghost" items filling the queue.
 *  - retry     : transient server-side problem -> retry until MAX_SYNC_RETRIES
 */
export type SyncFailureDisposition = 'applied' | 'defer' | 'permanent' | 'retry';

/** Error codes that can never be fixed by retrying the exact same payload. */
export const PERMANENT_SYNC_CODES: string[] = [
    'VALIDATION_FAILED',
    'CONFLICT',
    'INSUFFICIENT_STOCK',
    'UNKNOWN_FARMER',
    'UNKNOWN_PRODUCT',
    'NOT_FOUND',
    'FORBIDDEN',
    'IDEMPOTENCY_KEY_REUSE',
];

/** Error codes that mean "try again later" and must never consume the retry budget. */
export const DEFERRED_SYNC_CODES: string[] = ['OFFLINE', 'NETWORK', 'TIMEOUT', 'RATE_LIMITED', 'AUTH_FAILED'];

/**
 * Classify a failed mutation. Pure and dependency-free so it can be unit-tested, and the HTTP
 * status is authoritative: ANY 4xx (except 401/408/429) is a permanent rejection even when the
 * server replied with an unstructured body and therefore no usable `code`.
 */
export const classifySyncError = (error?: { code?: string; status?: number; message?: string } | null): SyncFailureDisposition => {
    const code = String(error?.code ?? '');
    const status = typeof error?.status === 'number' ? error.status : undefined;

    // Session/permission problems must not destroy user data: an expired session (401) is
    // deferred, a role problem (403) is permanent but stays reviewable in the dead-letter store.
    if (code === 'AUTH_FAILED' || status === 401) return 'defer';
    if (code === 'IDEMPOTENCY_KEY_REUSE') return 'applied';
    if (code === 'OFFLINE' || code === 'NETWORK' || code === 'TIMEOUT' || code === 'RATE_LIMITED') return 'defer';
    if (status === 408 || status === 429) return 'defer';
    if (status !== undefined && status >= 400 && status < 500) return 'permanent';
    if (PERMANENT_SYNC_CODES.includes(code)) return 'permanent';
    return 'retry';
};

/**
 * Drain the retryable outbox.
 *
 * Retry policy (see `classifySyncError`):
 *  - success                                -> removed from the queue
 *  - IDEMPOTENCY_KEY_REUSE                  -> already applied by the server, removed
 *  - OFFLINE / 401 / 429 / timeout          -> kept, retryCount untouched, try again later
 *  - validation/stock/conflict/not-found    -> moved to `failedMutations` (dead-letter) at once,
 *                                              because retrying cannot make them valid
 *  - retries exhausted (MAX_SYNC_RETRIES)   -> moved to `failedMutations`
 * Dead-lettered mutations never sit in syncQueue again, so they can no longer block
 * hydration for every other change, and the queue can never fill with ghost items.
 */
export const triggerSync = async (): Promise<boolean> => {
    const db = await initDB();
    const pending = await db.getAllFromIndex('syncQueue', 'by-status', 'pending');
    if (pending.length === 0) return true;

    // Publish the "syncing" lifecycle so the global status indicator can reflect it.
    // The finally block guarantees the flag always settles; setSyncState never throws.
    setSyncState({ syncing: true });
    try {
        let allSuccess = true;
        const deadLetter = async (mutation: any, code?: string, message?: string) => {
            await moveToFailedMutations(mutation.id, { code, message });
        };
        const scheduleRetry = async (mutation: any, code?: string, message?: string) => {
            const retryCount = (mutation.retryCount || 0) + 1;
            if (retryCount >= MAX_SYNC_RETRIES) {
                await deadLetter(mutation, code, message);
            } else {
                await updateMutation({ ...mutation, retryCount, status: 'pending', lastError: message });
                allSuccess = false;
            }
        };

        for (const mutation of pending) {
            try {
                let apiRes;
                if (mutation.entityType === 'invoices') {
                    // REST invoice routes (require X-Operation-Id) — unchanged behaviour.
                    if (mutation.action === 'create') {
                        apiRes = await sendRestRequest('/api/invoices', { method: 'POST', headers: { 'X-Operation-Id': mutation.id }, body: JSON.stringify(mutation.payload) });
                    } else if (mutation.action === 'update') {
                        apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(mutation.payload.id)}`, { method: 'PUT', headers: { 'X-Operation-Id': mutation.id }, body: JSON.stringify(mutation.payload) });
                    } else {
                        apiRes = await sendRestRequest(`/api/invoices/${encodeURIComponent(mutation.payload.id)}`, { method: 'DELETE', headers: { 'X-Operation-Id': mutation.id } });
                    }
                } else {
                    // Unified sync endpoint handles settings/farmers/drivers/origins/formulas/
                    // production/adjustments/logs/invoices via { id, action, entityType, data }.
                    apiRes = await sendRestRequest('/api/sync', {
                        method: 'POST',
                        headers: { 'X-Operation-Id': mutation.id },
                        body: JSON.stringify({ id: mutation.id, action: mutation.action, entityType: mutation.entityType, data: mutation.payload }),
                    });
                }

                if (apiRes?.success) {
                    await db.delete('syncQueue', mutation.id);
                    continue;
                }

                const failure = (apiRes as any)?.error as { code?: string; status?: number; message?: string } | undefined;
                const code = failure?.code;
                const message = failure?.message;
                const disposition = classifySyncError(failure);

                if (disposition === 'applied') {
                    // The server already applied this exact operationId - nothing left to do.
                    await db.delete('syncQueue', mutation.id);
                } else if (disposition === 'defer') {
                    // Connectivity/session/throttle: keep it and do NOT burn a retry attempt.
                    allSuccess = false;
                } else if (disposition === 'permanent') {
                    await deadLetter(mutation, code || (failure?.status ? httpErrorCodeForStatus(failure.status) : 'VALIDATION_FAILED'), message);
                    allSuccess = false;
                } else {
                    await scheduleRetry(mutation, code || 'SERVER_ERROR', message);
                }
            } catch (e: any) {
                await scheduleRetry(mutation, 'NETWORK', e?.message);
            }
        }

        if (allSuccess) await hydrateFromServer();
        return allSuccess;
    } finally {
        setSyncState({ syncing: false, lastSyncAt: Date.now() });
    }
};

/* ---------------------------------------------------------------- weighbridge API */

export interface WeighbridgeQuery {
    from?: string;
    to?: string;
    plate?: string;
    status?: string;
    /** all | done (خالص‌شده) | pending (در انتظار توزین دوم) */
    net?: string;
    /** entry | exit | unknown — the weighing software's own in/out flag. */
    direction?: string;
    /** Matches the ticket's «نوع کالا» (Goods) as a substring. */
    goods?: string;
    /** Net-weight window in kg («جستجوی وزن»). */
    minNet?: number | string;
    maxNet?: number | string;
    q?: string;
    limit?: number;
    offset?: number;
    /** Report only: how many rows the customer/plate tables return. */
    topCustomers?: number;
}

const weighbridgeQuery = (query: WeighbridgeQuery = {}): string => {
    const params = new URLSearchParams();
    for (const key of ['from', 'to', 'plate', 'status', 'net', 'q', 'direction', 'goods', 'minNet', 'maxNet'] as const) {
        const value = query[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') params.set(key, String(value));
    }
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    if (query.topCustomers) params.set('topCustomers', String(query.topCustomers));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
};

/**
 * GET /api/weighbridge/report — aggregates for the «گزارش‌گیری» tab: totals, per-کالا detail, the
 * daily time series, the entry/exit split and the top customers/plates. Accepts the same filters as
 * the ticket list.
 */
export const fetchWeighbridgeReport = (query: WeighbridgeQuery = {}) =>
    sendRestRequest<WeighbridgeReport>(`/api/weighbridge/report${weighbridgeQuery(query)}`, { cache: 'no-store' });

/**
 * GET /api/weighbridge/report/daily — the «روز × کالا» detail of the report (one line per day and
 * کالا, with the day's own total), fetched on demand when the operator opens or prints the daily
 * breakdown so a full-year report never ships thousands of rows to the browser.
 */
export const fetchWeighbridgeDailyReport = (query: WeighbridgeQuery = {}) =>
    sendRestRequest<WeighbridgeDayGoodsReport>(`/api/weighbridge/report/daily${weighbridgeQuery(query)}`, { cache: 'no-store' });

/** GET /api/weighbridge/records — server-side filtered/paged ticket list + status counters. */
export const fetchWeighbridgeRecords = (query: WeighbridgeQuery = {}) =>
    sendRestRequest<WeighbridgeListResult>(`/api/weighbridge/records${weighbridgeQuery(query)}`, { cache: 'no-store' });

/** GET /api/weighbridge/records/:id — the ticket plus its linked invoice. */
export const fetchWeighbridgeRecord = (id: number) =>
    sendRestRequest<WeighbridgeRecord>(`/api/weighbridge/records/${id}`, { cache: 'no-store' });

/** GET /api/weighbridge/stats — counters + sync metadata. */
export const fetchWeighbridgeStats = () =>
    sendRestRequest<WeighbridgeStats>('/api/weighbridge/stats', { cache: 'no-store' });

/** GET /api/weighbridge/records/:id/candidates — entry/exit invoices near the weigh date. */
export const fetchWeighbridgeCandidates = (id: number, type: 'entry' | 'exit', days = 5, q = '') => {
    const params = new URLSearchParams({ type, days: String(days) });
    if (q.trim()) params.set('q', q.trim());
    return sendRestRequest<WeighbridgeCandidatesResult>(
        `/api/weighbridge/records/${id}/candidates?${params.toString()}`,
        { cache: 'no-store' }
    );
};

/** POST /api/weighbridge/records/:id/map — link the ticket to an invoice and write its net weight. */
export const mapWeighbridgeRecord = (id: number, invoiceId: string) =>
    sendRestRequest<{ recordId: number; invoiceId: string; invoiceType: string; column: string; previousValue: number | null; netWeight: number | null }>(
        `/api/weighbridge/records/${id}/map`,
        { method: 'POST', body: JSON.stringify({ invoiceId }) }
    );

/** POST /api/weighbridge/records/:id/unmap — remove the link. The invoice created from this ticket
 *  is deleted by default (`deleteInvoice:false` only clears the ticket's weight contribution). */
export const unmapWeighbridgeRecord = (id: number, deleteInvoice = true) =>
    sendRestRequest<{ recordId: number; invoiceId: string; invoiceDeleted: boolean; weightReverted: boolean; restoredValue: number | null }>(
        `/api/weighbridge/records/${id}/unmap`,
        { method: 'POST', body: JSON.stringify({ deleteInvoice }) }
    );

/** PATCH /api/weighbridge/records/:id/direction — manual entry/exit override (survives re-syncs). */
export const setWeighbridgeDirection = (id: number, direction: 'entry' | 'exit') =>
    sendRestRequest<{ id: number; direction: string }>(`/api/weighbridge/records/${id}/direction`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
    });

/** POST /api/weighbridge/sync — run the weighbridge worker once, now, and return its log. */
export const triggerWeighbridgeSync = () =>
    sendRestRequest<{ exitCode: number | null; timedOut: boolean; log: string }>('/api/weighbridge/sync', {
        method: 'POST',
        body: JSON.stringify({}),
    });

/**
 * POST /api/weighbridge/records/:id/create-remittance
 * Creates the entry (purchase) or exit (sale) invoice from the ticket and links them, in one
 * transaction on the server. `payload` carries the operator-confirmed fields.
 */
export const createRemittanceFromWeighbridge = async (
    id: number,
    payload: {
        type: 'entry' | 'exit';
        date: string;
        productId: string;
        productName?: string;
        weight?: number | string | null;
        farmerId?: string;
        farmerName?: string;
        driverName?: string;
        driverPhone?: string;
        driverIBAN?: string;
        billNumber?: string;
        billWeight?: number | string | null;
        origin?: string;
        sellerName?: string;
        invoiceNumber?: string;
        transportCost?: number | string | null;
        notes?: string;
        productVariant?: string;
    }
) => {
    const res = await sendRestRequest<{
        recordId: number;
        invoiceId: string;
        invoiceType: string;
        weightWritten: number | null;
        date: string;
        invoice?: any;
    }>(`/api/weighbridge/records/${id}/create-remittance`, { method: 'POST', body: JSON.stringify(payload) });

    // The invoice is created on the server; mirror it into the local cache so the day's Entry/Exit
    // screens show it immediately (previously it only appeared after a full reload/hydration).
    // NOTE: the API body is FLAT — { success, data: { …, invoice } } — so the row lives in `.data`.
    const created: any = (res as any)?.data?.invoice ?? (res as any)?.invoice;
    if (res.success && created) {
        try {
            const mapped: any = mapServerInvoice(created);
            const all = [...getAllInvoices()];
            if (!all.some((inv: any) => inv.id === mapped.id)) {
                all.push(mapped);
                await saveAllInvoices(all as any);
                // Append to the day's manual order so the new row lands at the bottom of that day.
                const key = `sortOrder_${mapped.type}_${mapped.date}`;
                const cur = JSON.parse(localStorage.getItem(key) || '[]');
                if (Array.isArray(cur) && !cur.includes(mapped.id)) {
                    cur.push(mapped.id);
                    localStorage.setItem(key, JSON.stringify(cur));
                }
            }
        } catch (error) {
            console.warn('[weighbridge] local cache sync after create-remittance failed', error);
        }
    }
    return res;
};

