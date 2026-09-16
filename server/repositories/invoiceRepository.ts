import { eq, and, isNull, desc, asc, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { invoices } from '../db/schema';

export interface InvoiceQueryParams {
  page?: number;
  limit?: number;
  type?: 'entry' | 'exit';
  search?: string;
  startDate?: string;
  endDate?: string;
  farmerId?: string;
  productId?: string;
}

export const findInvoicesWithPagination = async (params: InvoiceQueryParams) => {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(200, Math.max(1, params.limit || 50));
  const offset = (page - 1) * limit;

  const conditions = [isNull(invoices.deletedAt)];

  if (params.type) {
    conditions.push(eq(invoices.type, params.type));
  }
  if (params.farmerId) {
    conditions.push(eq(invoices.farmerId, params.farmerId));
  }
  if (params.productId) {
    conditions.push(eq(invoices.productId, params.productId));
  }
  if (params.startDate) {
    conditions.push(sql`${invoices.date} >= ${params.startDate}`);
  }
  if (params.endDate) {
    conditions.push(sql`${invoices.date} <= ${params.endDate}`);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(invoices.driverName, q),
        ilike(invoices.sellerName, q),
        ilike(invoices.billNumber, q),
        ilike(invoices.invoiceNumber, q),
        ilike(invoices.productName, q),
        // Invoice free-text (Persian «توضیحات»). The only free-text column on the
        // `invoices` table is `notes` (`invoices.notes`); it is shared by BOTH entry
        // and exit rows, so this single predicate covers both invoice kinds.
        ilike(invoices.notes, q),
        // Exit sub-type / description free-text (already surfaced in the UI).
        ilike(invoices.productVariant, q)
      )!
    );
  }

  const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

  const [totalRows, data] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(invoices).where(whereClause),
    db.select().from(invoices).where(whereClause).orderBy(desc(invoices.date), desc(invoices.createdAt), desc(invoices.id)).limit(limit).offset(offset),
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
