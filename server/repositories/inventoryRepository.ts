import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { inventory_transactions } from '../db/schema';

export interface InventoryLedgerParams {
  productId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export const getInventoryTransactionsPaginated = async (params: InventoryLedgerParams) => {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(200, Math.max(1, params.limit || 50));
  const offset = (page - 1) * limit;

  const conditions: any[] = [];

  if (params.productId) {
    conditions.push(eq(inventory_transactions.productId, params.productId));
  }
  if (params.type) {
    conditions.push(eq(inventory_transactions.type, params.type));
  }
  if (params.startDate) {
    conditions.push(sql`${inventory_transactions.date} >= ${params.startDate}`);
  }
  if (params.endDate) {
    conditions.push(sql`${inventory_transactions.date} <= ${params.endDate}`);
  }

  const whereClause = conditions.length > 0 ? (conditions.length > 1 ? and(...conditions) : conditions[0]) : undefined;

  const [totalRows, data] = await Promise.all([
    whereClause
      ? db.select({ count: sql<number>`count(*)` }).from(inventory_transactions).where(whereClause)
      : db.select({ count: sql<number>`count(*)` }).from(inventory_transactions),
    whereClause
      ? db.select().from(inventory_transactions).where(whereClause).orderBy(desc(inventory_transactions.date), desc(inventory_transactions.createdAt)).limit(limit).offset(offset)
      : db.select().from(inventory_transactions).orderBy(desc(inventory_transactions.date), desc(inventory_transactions.createdAt)).limit(limit).offset(offset),
  ]);

  const total = Number(totalRows[0]?.count || 0);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};
