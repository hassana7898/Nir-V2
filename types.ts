
export type ProductType = 'rawMaterial' | 'finishedGood';

export interface Product {
    id: string;
    name: string;
    type: ProductType;
    isDeleted?: boolean;
}

export interface Entry {
    id: string;
    date: string; // YYYY-MM-DD
    sellerName: string;
    productId: string;
    billWeight: number;
    scaleWeight: number;
    wastage: number;
    factory?: string;
    billNumber: string;
    origin: string;
    transportCost: number;
    driverName: string;
    driverPhone: string;
    driverIBAN: string;
    createdAt: number; // timestamp
    isPageBreak?: boolean;
    notes?: string;
    sortOrder?: number | null; // per-day manual position delivered by the server (NULL = unpositioned)
}

export interface ExceptionalFeed {
    productId: string;
    weight: number;
    reason: string;
    date: string; // YYYY-MM-DD
}

export interface Brood {
    id: string;
    startDate: string; // YYYY-MM-DD
    chickCount: number;
    endDate?: string; // YYYY-MM-DD
    startInvoiceId?: string; // Optional: Link to a starting exit invoice
    exceptionalFeed: ExceptionalFeed[];
    finalChickenWeight?: number; // Total weight of chicken sold at the end
    includedInvoiceIds?: string[]; // Manually include exit invoice IDs
    excludedInvoiceIds?: string[]; // Manually exclude exit invoice IDs
    activeProductsAtCreation?: string[]; // Which products were active when this brood was created
    /**
     * SOFT-DELETE flag (ISO timestamp). A deleted period is NEVER removed from the JSON array: it is
     * kept for restore (recycle bin) and hidden from every active list/dropdown/form.
     */
    deletedAt?: string | null;
}

export interface Farmer {
    id: string;
    name: string;
    broods: Brood[];
    phone?: string;
    isHidden?: boolean;
    isDeleted?: boolean;
    updatedAt?: number;
}


export interface Exit {
    id:string;
    date: string; // YYYY-MM-DD
    farmerId: string;
    productId: string;
    weight: number;
    driverName: string;
    invoiceNumber: string;
    productVariant?: string; // New field for sub-type or description
    isCrumble?: boolean; // New field for Crumble checkbox
    createdAt: number; // timestamp
    isPageBreak?: boolean;
    notes?: string;
    sortOrder?: number | null; // per-day manual position delivered by the server (NULL = unpositioned)
}

/**
 * Driver record (server `drivers` table). The app mostly stores drivers as plain names, but the
 * image/PDF importer needs the full row shape - this type used to be missing entirely, which broke
 * `npx tsc --noEmit` for ImageImportModal.
 */
export interface Driver {
    id?: string;
    name: string;
    phone?: string | null;
    iban?: string | null;
}

export type Remittance = Entry | Exit;

export interface ProductionRecord {
    id: string;
    date: string; // YYYY-MM-DD
    finishedGoodId: string;
    quantityProduced: number; // kg
    createdAt: number; // timestamp
}

export interface InventoryAdjustment {
    id: string;
    date: string; // YYYY-MM-DD
    productId: string;
    newQuantity: number;
    reason: string;
    createdAt: number; // timestamp
}

export interface FormulaItem {
    productId: string;
    quantity: number; // How much of this product is needed to make 1kg of the finished good
}

export interface Formula {
    id: string;
    finishedGoodId: string;
    items: FormulaItem[]; // List of raw materials
}

export interface Log {
    timestamp: number;
    action: 'created' | 'updated' | 'deleted' | 'moved' | 'bulkMoved' | 'adjusted' | 'migrated';
    actionText: string;
    type: 'entry' | 'exit' | 'bulkMove' | 'formula' | 'product' | 'production' | 'inventory_adjustment' | 'farmer' | 'system';
    details: string;
    by: string;
}

export interface Settings {
    factoryName: string;
    factoryLogo: string | null;
    entryPrintTitle: string;
    exitPrintTitle: string;
    // Per-page print titles (index 0 = page 1 = the master title). Additive: stored inside the
    // settings JSON blob, so existing installations keep working without a migration.
    entryPageTitles?: string[];
    exitPageTitles?: string[];
    // Globally switchable sidebar sections (ADMIN-controlled). Missing/true = visible, so existing
    // installations keep exactly the current behaviour.
    enabledMenus?: {
        warehouses?: boolean;
        inventoryAnalysis?: boolean;
        production?: boolean;
        weighbridge?: boolean;
    };
    entrySignatures: [string, string, string, string];
    entrySignatureNames?: [string, string, string, string];
    exitSignatures: [string, string, string, string];
    exitSignatureNames?: [string, string, string, string];
    products: Product[];
    feedQuotas: { productId: string; quotaPerChick: number }[]; // in grams
    totalBroodDays?: number; // Target total duration (e.g. 50)
    productPhaseDurations?: { [productId: string]: number }; // Duration in days for each product phase
    printBoldText?: boolean;
}

/* ---------------------------------------------------------------- weighbridge */

/** Status of a weighbridge ticket: unmapped (تخصیص‌نیافته) | mapped (تخصیص‌یافته) | archived. */
export type WeighbridgeStatus = 'unmapped' | 'mapped' | 'archived';

export interface WeighbridgeInvoiceRef {
    id: string;
    type: string;
    date: string;
    productName: string | null;
    invoiceNumber: string | null;
    billNumber: string | null;
    driverName: string | null;
    scaleWeight: string | null;
    weight: string | null;
    farmerId: string | null;
    sellerName: string | null;
    /** نام مشتری: sale -> مرغدار (farmers.name), purchase -> فروشنده (seller_name). */
    customerName?: string | null;
    farmerName?: string | null;
}

export interface WeighbridgeRecord {
    id: number;
    externalId: number;
    ticketNumber: string | null;
    plateNumber: string | null;
    driverName: string | null;
    carrierCompany: string | null;
    grossWeight: string | null;
    tareWeight: string | null;
    netWeight: string | null;
    weighTime: string | null;
    status: WeighbridgeStatus | string;
    /** Load direction from the weighing software's in/out flag: 'entry' (ورود) | 'exit' (خروج) | null. */
    direction: 'entry' | 'exit' | null;
    /** The flag exactly as the vendor software wrote it (e.g. «ورودی»), kept for traceability. */
    directionLabel: string | null;
    /** Bill of lading (`BillOfLading`) from the vendor software. */
    billOfLading?: string | null;
    /** Destination / farm (`Destination`) from the vendor software. */
    destination?: string | null;
    /** Goods / material name (`Goods`) from the vendor software. */
    goods?: string | null;
    /** Customer name (`CustomerName`) as recorded by the weighing software. */
    customerName?: string | null;
    mappedRemittanceId: string | null;
    /** Remittance number (`ShomareHavale`) — the حواله number, distinct from the ticket serial (externalId). */
    remittanceNumber?: string | null;
    /** The vendor flag exactly as written (`InOutFlag`), kept for traceability. */
    directionRaw?: string | null;
    /** TRUE after the operator overrode the direction by hand («ویرایش نوع») — survives re-syncs. */
    directionLocked?: boolean;
    /** Invoice weight minus the ticket's net weight for a LINKED ticket (null when unknown). */
    weightDelta?: number | null;
    /**
     * For an UNMAPPED ticket: an already-registered invoice carrying the same شماره حواله
     * (invoice_number / bill_number) — the UI shows it as a «حواله ثبت شد ✓» tick for مغایرت.
     */
    existingInvoice?: {
        id: string;
        type: string;
        date: string;
        productName: string | null;
        invoiceNumber: string | null;
        billNumber: string | null;
        scaleWeight: string | null;
        weight: string | null;
        farmerId?: string | null;
        sellerName?: string | null;
        customerName?: string | null;
        farmerName?: string | null;
    } | null;
    /** TRUE when the registered remittance found is of the OTHER type than the ticket's direction. */
    existingTypeMismatch?: boolean;
    source: string | null;
    lastSyncedAt: string | null;
    createdAt: string;
    updatedAt: string;
    /** Present on list/detail responses when the ticket is linked to an invoice. */
    invoice?: WeighbridgeInvoiceRef | null;
}

export interface WeighbridgeCounts {
    unmapped: number;
    mapped: number;
    archived: number;
    total: number;
    /** Tickets with a NET weight (خالص‌شده — both weighings done). */
    netted?: number;
    /** Tickets still waiting for the second weighing. */
    pending?: number;
}

export interface WeighbridgeListResult {
    data: WeighbridgeRecord[];
    total: number;
    counts: WeighbridgeCounts;
    limit: number;
    offset: number;
}

export interface WeighbridgeStats extends WeighbridgeCounts {
    lastSyncedAt: string | null;
    newestWeighTime: string | null;
    workerBundlePresent: boolean;
    workerBundlePath?: string;
}

/* ------------------------------------------------------------------ reporting */

/** Grand totals of a report range (گزارش‌گیری باسکول). Weights are kilograms. */
export interface WeighbridgeReportTotals {
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    /** Average of the tickets that HAVE a net weight (a pending ticket has none). */
    avgNet: number;
    maxNet: number;
    minNet: number;
    netted: number;
    pending: number;
    mapped: number;
    unmapped: number;
    archived: number;
    entryTickets: number;
    exitTickets: number;
    /** Tare of tickets still waiting for their second weighing (excluded from the sums above). */
    pendingTare: number;
    pendingGross: number;
    plates: number;
    customers: number;
    firstDay: string | null;
    lastDay: string | null;
}

/** One row of «جزئیات هر کالا». */
export interface WeighbridgeReportGoodsRow {
    goods: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    avgNet: number;
    maxNet: number;
    minNet: number;
    netted: number;
    pending: number;
    mapped: number;
    unmapped: number;
    archived: number;
    pendingTare: number;
    /** وزن پر tickets still waiting for their second weighing are holding (excluded from `gross`). */
    pendingGross: number;
    firstDay: string | null;
    lastDay: string | null;
}

/** One DAY of the time series — the client buckets these into day/week/month. */
export interface WeighbridgeReportDayRow {
    day: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    netted: number;
    pending: number;
    entryTickets: number;
    exitTickets: number;
    pendingTare: number;
    pendingGross: number;
}

/**
 * One «روز × کالا» line — the detail behind the daily report: on 1405/07/19 «ذرت» and «سویا» are two
 * lines and the day's own total («جمع روز») is their sum. `net` counts netted tickets only; the weight
 * of the tickets still waiting for their second weighing is reported separately.
 */
export interface WeighbridgeReportDayGoodsRow {
    day: string;
    goods: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    netted: number;
    pending: number;
    pendingTare: number;
    pendingGross: number;
    entryTickets: number;
    exitTickets: number;
}

export interface WeighbridgeReportDirectionRow {
    direction: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    pending: number;
    pendingTare: number;
}

export interface WeighbridgeReportCustomerRow {
    customer: string;
    tickets: number;
    gross: number;
    tare: number;
    net: number;
    pending: number;
    lastDay: string | null;
}

export interface WeighbridgeReportPlateRow {
    plate: string;
    tickets: number;
    net: number;
    pending: number;
}

export interface WeighbridgeReport {
    range: { from: string | null; to: string | null };
    totals: WeighbridgeReportTotals;
    byGoods: WeighbridgeReportGoodsRow[];
    byDay: WeighbridgeReportDayRow[];
    byDirection: WeighbridgeReportDirectionRow[];
    byCustomer: WeighbridgeReportCustomerRow[];
    byPlate: WeighbridgeReportPlateRow[];
}

/**
 * GET /api/weighbridge/report/daily — the «روز × کالا» matrix behind the printable report: one line per
 * (day, کالا) plus server-side grand totals, computed with exactly the same filters as the list. Its own
 * endpoint because the report tab only asks for it when the daily detail is opened or printed.
 */
export interface WeighbridgeDayGoodsReport {
    range: { from: string | null; to: string | null };
    totals: {
        tickets: number;
        gross: number;
        tare: number;
        net: number;
        netted: number;
        pending: number;
        pendingTare: number;
        pendingGross: number;
    };
    rows: WeighbridgeReportDayGoodsRow[];
}

export interface WeighbridgeCandidate {
    id: string;
    type: string;
    date: string;
    productName: string | null;
    invoiceNumber: string | null;
    billNumber: string | null;
    driverName: string | null;
    driverPhone: string | null;
    sellerName: string | null;
    farmerId: string | null;
    /** نام مشتری (مرغدار برای خروج، فروشنده برای ورود). */
    customerName?: string | null;
    billWeight: string | null;
    scaleWeight: string | null;
    weight: string | null;
    /** The candidate's driver matches the ticket's driver. */
    driverMatch: boolean;
    /** The invoice already carries a scale weight. */
    alreadyWeighed: boolean;
}

export interface WeighbridgeCandidatesResult {
    data: WeighbridgeCandidate[];
    window: { from: string; to: string; isoFrom?: string; isoTo?: string; days: number; type: string };
    record: {
        id: number;
        plateNumber: string | null;
        driverName: string | null;
        netWeight: string | null;
        weighTime: string | null;
    };
}
