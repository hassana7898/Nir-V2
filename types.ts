
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
}

export interface Farmer {
    id: string;
    name: string;
    broods: Brood[];
    isHidden?: boolean;
    isDeleted?: boolean;
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
