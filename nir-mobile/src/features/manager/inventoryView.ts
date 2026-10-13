/**
 * Pure helpers for the manager «انبار و سیلو» screen.
 *
 * The Phase 1 screen read the warehouses endpoint (which returns the physical bins, not stock) and
 * rendered `capacityKg` / `currentStockKg` /
 * `percent` / `productName` — a shape that endpoint has never returned: `warehouses` holds the
 * physical bins, and the only live stock numbers in the system live on `products.current_stock`
 * (maintained by `server/services/inventoryService.ts`). The screen therefore showed nothing real.
 *
 * Live source: GET /api/mobile/manager/kpi -> `inventory: [{ id, name, type, unit, currentStock,
 * minStock }]` (`server/routes/mobile.ts`).
 */

export interface InventoryItem {
  id: string;
  name: string;
  type: string;
  unit: string;
  currentStock: number;
  minStock: number | null;
  isOut: boolean;
  isLow: boolean;
}

export interface InventorySummary {
  totalItems: number;
  totalStockKg: number;
  lowItems: InventoryItem[];
  outItems: InventoryItem[];
  lowCount: number;
  outCount: number;
  healthyCount: number;
  maxStockKg: number;
}

export const INVENTORY_TYPE_LABELS: Record<string, string> = {
  raw: 'مواد اولیه',
  finished: 'خوراک آماده (پلت)',
  additive: 'افزودنی و مکمل',
  packaging: 'بسته‌بندی',
};

export const inventoryTypeLabel = (type: unknown): string => {
  const key = String(type ?? '').trim();
  if (!key) return 'نامشخص';
  return INVENTORY_TYPE_LABELS[key] || key;
};

export const normalizeInventoryItems = (raw: unknown): InventoryItem[] => {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row: any) => {
      const currentStock = Number(row?.currentStock ?? row?.stock ?? 0) || 0;
      const minStockRaw = row?.minStock;
      const minStock = minStockRaw === null || minStockRaw === undefined ? null : Number(minStockRaw);
      return {
        id: String(row?.id ?? row?.name ?? Math.random()),
        name: String(row?.name ?? row?.productName ?? '').trim() || 'قلم بدون نام',
        type: String(row?.type ?? '').trim(),
        unit: String(row?.unit ?? 'kg'),
        currentStock,
        minStock: minStock === null || Number.isFinite(minStock) ? minStock : null,
        isOut: currentStock <= 0,
        isLow: currentStock > 0 && minStock !== null && currentStock < minStock,
      };
    })
    .sort((a, b) => Number(a.isOut) - Number(b.isOut) || a.currentStock - b.currentStock);
};

export const summarizeInventory = (items: InventoryItem[]): InventorySummary => {
  const outItems = items.filter((i) => i.isOut);
  const lowItems = items.filter((i) => i.isLow);
  return {
    totalItems: items.length,
    totalStockKg: items.reduce((sum, i) => sum + i.currentStock, 0),
    lowItems,
    outItems,
    lowCount: lowItems.length,
    outCount: outItems.length,
    healthyCount: items.length - lowItems.length - outItems.length,
    maxStockKg: items.reduce((max, i) => Math.max(max, i.currentStock), 0),
  };
};

export type InventoryFilter = 'all' | 'raw' | 'finished' | 'attention';

export const INVENTORY_FILTER_LABELS: Record<InventoryFilter, string> = {
  all: 'همه اقلام',
  raw: 'مواد اولیه',
  finished: 'خوراک آماده',
  attention: 'کم‌موجود و ناموجود',
};

export const filterInventory = (
  items: InventoryItem[],
  filter: InventoryFilter
): InventoryItem[] => {
  if (filter === 'all') return items;
  if (filter === 'attention') return items.filter((i) => i.isOut || i.isLow);
  return items.filter((i) => i.type === filter);
};

/** Relative bar length, so a table of wildly different stocks still reads at a glance. */
export const stockBarPercent = (item: InventoryItem, maxStockKg: number): number => {
  if (maxStockKg <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((item.currentStock / maxStockKg) * 100)));
};

export type StockTone = 'ok' | 'low' | 'out';

export const stockTone = (item: InventoryItem): StockTone =>
  item.isOut ? 'out' : item.isLow ? 'low' : 'ok';

export const STOCK_TONE_LABELS: Record<StockTone, string> = {
  ok: 'موجودی مطلوب',
  low: 'کمتر از حد بحرانی',
  out: 'ناموجود',
};

export const minStockLabel = (item: InventoryItem): string =>
  item.minStock === null ? 'حد بحرانی تعیین نشده' : `حد بحرانی: ${item.minStock}`;
