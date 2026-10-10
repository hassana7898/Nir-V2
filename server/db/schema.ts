import { pgTable, text, timestamp, json, decimal, index, boolean, integer, serial } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("ADMIN").notNull(),
  fullName: text("full_name"),
  // TOTP (2FA). totpSecret holds the pending/active base32 secret; is2faEnabled is only
  // set true after the user proves possession by verifying a code from their authenticator.
  totpSecret: text("totp_secret"),
  is2faEnabled: boolean("is_2fa_enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const warehouses = pgTable("warehouses", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").unique(),
  location: text("location"),
  manager: text("manager"),
  capacity: decimal("capacity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({ nameIdx: index("warehouses_name_idx").on(t.name) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ tokenIdx: index("sessions_token_idx").on(t.token), userIdIdx: index("sessions_user_id_idx").on(t.userId), expiresAtIdx: index("sessions_expires_at_idx").on(t.expiresAt) }));

export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  data: json("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const product_categories = pgTable("product_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  code: text("code").unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  categoryId: text("category_id").references(() => product_categories.id),
  unit: text("unit").default("kg"),
  minStock: decimal("min_stock"),
  // Derived cache maintained transactionally from inventory_transactions. Never client-writable.
  currentStock: decimal("current_stock").default("0"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),

}, (t) => ({ nameIdx: index("products_name_idx").on(t.name), typeIdx: index("products_type_idx").on(t.type), categoryIdIdx: index("products_category_id_idx").on(t.categoryId) }));

export const farmers = pgTable("farmers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  broods: json("broods"),
  isHidden: boolean("is_hidden").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("farmers_updated_at_idx").on(t.updatedAt), nameIdx: index("farmers_name_idx").on(t.name) }));

export const drivers = pgTable("drivers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  iban: text("iban"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("drivers_updated_at_idx").on(t.updatedAt), nameIdx: index("drivers_name_idx").on(t.name) }));

export const origins = pgTable("origins", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("origins_updated_at_idx").on(t.updatedAt) }));

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  date: text("date").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  productName: text("product_name"),
  driverName: text("driver_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  sellerName: text("seller_name"),
  billWeight: decimal("bill_weight"),
  scaleWeight: decimal("scale_weight"),
  factory: text("factory"),
  billNumber: text("bill_number"),
  origin: text("origin"),
  transportCost: decimal("transport_cost"),
  driverPhone: text("driver_phone"),
  driverIBAN: text("driver_iban"),
  wastage: decimal("wastage"),
  farmerId: text("farmer_id").references(() => farmers.id),
  weight: decimal("weight"),
  invoiceNumber: text("invoice_number"),
  productVariant: text("product_variant"),
  isCrumble: boolean("is_crumble").default(false),
  isPageBreak: boolean("is_page_break").default(false),
  // Per-day print/edit position carried by legacy `sortOrder_entry_*` / `sortOrder_exit_*` keys.
  sortOrder: integer("sort_order"),

  version: integer("version").default(1).notNull(),

  status: text("status").default("active"),

  notes: text("notes"),

  createdBy: text("created_by"),

  updatedBy: text("updated_by"),
}, (t) => ({ updatedAtIdx: index("invoices_updated_at_idx").on(t.updatedAt), dateIdx: index("invoices_date_idx").on(t.date), typeIdx: index("invoices_type_idx").on(t.type), productIdIdx: index("invoices_product_id_idx").on(t.productId), farmerIdIdx: index("invoices_farmer_id_idx").on(t.farmerId) }));

export const batches = pgTable("batches", {
  id: text("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  productId: text("product_id").notNull().references(() => products.id),
  productionRecordId: text("production_record_id"),
  initialQuantity: decimal("initial_quantity").notNull(),
  remainingQuantity: decimal("remaining_quantity").notNull(),
  productionDate: text("production_date"),
  expiryDate: text("expiry_date"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ productIdIdx: index("batches_product_id_idx").on(t.productId), batchNumberIdx: index("batches_batch_number_idx").on(t.batchNumber) }));

export const formulas = pgTable("formulas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  finishedGoodId: text("finished_good_id").notNull().references(() => products.id),
  // Kept temporarily as a compatibility mirror for the existing client. formula_items is authoritative.
  items: json("items").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("formulas_updated_at_idx").on(t.updatedAt), finishedGoodIdIdx: index("formulas_finished_good_id_idx").on(t.finishedGoodId) }));

export const formula_items = pgTable("formula_items", {
  id: text("id").primaryKey(),
  formulaId: text("formula_id").notNull().references(() => formulas.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  percentage: decimal("percentage"),
  quantity: decimal("quantity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  version: integer("version").default(1).notNull(),
}, (t) => ({ formulaIdIdx: index("formula_items_formula_id_idx").on(t.formulaId), productIdIdx: index("formula_items_product_id_idx").on(t.productId) }));

export const production_records = pgTable("production_records", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  finishedGoodId: text("finished_good_id").notNull().references(() => products.id),
  formulaId: text("formula_id").references(() => formulas.id),
  quantityProduced: decimal("quantity_produced").notNull(),
  batchNumber: text("batch_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("production_records_updated_at_idx").on(t.updatedAt), dateIdx: index("production_records_date_idx").on(t.date), finishedGoodIdIdx: index("production_records_finished_good_id_idx").on(t.finishedGoodId) }));

export const inventory_adjustments = pgTable("inventory_adjustments", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  newQuantity: decimal("new_quantity").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  version: integer("version").default(1).notNull(),
}, (t) => ({ updatedAtIdx: index("inventory_adjustments_updated_at_idx").on(t.updatedAt), dateIdx: index("inventory_adjustments_date_idx").on(t.date), productIdIdx: index("inventory_adjustments_product_id_idx").on(t.productId) }));

export const inventory_transactions = pgTable("inventory_transactions", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  type: text("type").notNull(),
  quantity: decimal("quantity").notNull(),
  balanceAfter: decimal("balance_after"),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  // Immutable-ledger link: a reversal entry points at the transaction it reverses.
  reversalOf: text("reversal_of"),
  batchId: text("batch_id").references(() => batches.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ productIdIdx: index("inventory_transactions_product_id_idx").on(t.productId), dateIdx: index("inventory_transactions_date_idx").on(t.date), referenceIdIdx: index("inventory_transactions_reference_id_idx").on(t.referenceId), typeIdx: index("inventory_transactions_type_idx").on(t.type) }));

export const logs = pgTable("logs", {
  id: text("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  action: text("action").notNull(),
  actionText: text("action_text"),
  type: text("type"),
  details: text("details"),
  by: text("by"),
}, (t) => ({ timestampIdx: index("logs_timestamp_idx").on(t.timestamp), typeIdx: index("logs_type_idx").on(t.type) }));

// Server-authoritative audit trail (ردپای کاربران).
// Unlike `logs` (client-authored history that the browser decides to send), every row here is
// written INSIDE the same transaction as the change it describes: it cannot diverge from the data,
// cannot be skipped by the client, and always carries the authenticated actor.
export const audit_logs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  username: text("username"),
  role: text("role"),
  action: text("action").notNull(),      // CREATE | UPDATE | DELETE | REORDER | BULK_MOVE | ...
  entity: text("entity").notNull(),      // invoice | ...
  targetIds: json("target_ids"),         // string[] of affected invoice ids
  summary: json("summary"),              // { changes: [{ field, label, from, to }], context?: {...} }
  details: text("details"),              // Persian one-line summary for the UI
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
  actionIdx: index("audit_logs_action_idx").on(t.action),
  userIdx: index("audit_logs_user_id_idx").on(t.userId),
  entityIdx: index("audit_logs_entity_idx").on(t.entity),
}));

export const sync_mutations = pgTable("sync_mutations", {
  id: text("id").primaryKey(), // Using operationId as PK
  entityType: text("entity_type").notNull(),
  action: text("action").notNull(),
  payload: json("payload"), // Will store the request fingerprint or payload
  userId: text("user_id").references(() => users.id),
  resourceId: text("resource_id"),
  // Canonical idempotency hash of the request payload.
  payloadHash: text("payload_hash"),
  // Deprecated mirror kept for backward compatibility with rows written before the rename.
  requestFingerprint: text("request_fingerprint"),
  status: text("status").default("success"),
  originalResult: json("original_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ 
  createdAtIdx: index("sync_mutations_created_at_idx").on(t.createdAt),
  operationFingerprintIdx: index("sync_mutations_fingerprint_idx").on(t.id, t.requestFingerprint)
}));

/**
 * Weighbridge tickets (باسکول توزین نگار).
 *
 * Rows are imported from the factory's SQL Server `WEIGHNGDB.WeightTable` by the background
 * worker (workers/weighbridge-worker.ts) and keyed by `externalId` = that table's primary key,
 * so re-importing is an idempotent upsert.
 *
 * `mappedRemittanceId` points at the entry (purchase) or exit (sale) invoice this ticket was
 * assigned to; `status` flips to 'mapped' in the same transaction that writes the net weight
 * onto that invoice, and back to 'unmapped' if the link is removed.
 */
export const weighbridge_records = pgTable("weighbridge_records", {
  id: serial("id").primaryKey(),
  externalId: integer("external_id").notNull().unique(),
  ticketNumber: text("ticket_number"),
  plateNumber: text("plate_number"),
  driverName: text("driver_name"),
  carrierCompany: text("carrier_company"),
  /** Goods / material name (`Goods`) exactly as the weighing software wrote it (نوع کالا). */
  goods: text("goods"),
  /** Customer name (`CustomerName`) as the weighing software recorded it for this ticket. */
  customerName: text("customer_name"),
  /**
   * Remittance number (`ShomareHavale`) — the human حواله number. It is NOT the ticket serial
   * (`external_id` = the SQL Server `ID`); both are kept side by side.
   */
  remittanceNumber: text("remittance_number"),
  grossWeight: decimal("gross_weight"),
  tareWeight: decimal("tare_weight"),
  netWeight: decimal("net_weight"),
  /**
   * Wall-clock factory time, kept as a raw string (`mode: 'string'`) on purpose: these are
   * `timestamp without time zone` columns holding the weighing software's own local time, so
   * letting Drizzle build a JS `Date` would re-interpret them in the server's zone and shift the
   * displayed hour by ±3.5h. The raw string is what the UI prints (Jalali + clock).
   */
  weighTime: timestamp("weigh_time", { mode: "string" }),
  /**
   * The weighing software's own in/out flag, normalised to 'entry' (ورود) | 'exit' (خروج) |
   * 'unknown'. It decides which kind of remittance the UI offers for this ticket.
   */
  direction: text("direction").default("unknown").notNull(),
  /**
   * TRUE once the operator has overridden `direction` by hand (the «ویرایش نوع» button). The
   * sync worker then keeps the stored value instead of re-deriving it on every run.
   */
  directionLocked: boolean("direction_locked").notNull().default(false),
  status: text("status").default("unmapped").notNull(),
  mappedRemittanceId: text("mapped_remittance_id").references(() => invoices.id),
  /** Value the invoice's weight column had before this ticket wrote to it (restored on unmap). */
  previousWeightValue: text("previous_weight_value"),
  source: text("source").default("WEIGHNGDB.WeightTable"),
  rawPayload: json("raw_payload"),
  lastSyncedAt: timestamp("last_synced_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  weighTimeIdx: index("weighbridge_records_weigh_time_idx").on(t.weighTime),
  plateIdx: index("weighbridge_records_plate_idx").on(t.plateNumber),
  statusIdx: index("weighbridge_records_status_idx").on(t.status),
  mappedIdx: index("weighbridge_records_mapped_idx").on(t.mappedRemittanceId),
}));
