const fs = require('fs');
let schema = fs.readFileSync('server/db/schema.ts', 'utf8');

// Helper to inject a column definition before the closing bracket of the column definitions
function injectColumn(tableVar, columnDef) {
    const regex = new RegExp(`export const ${tableVar} = pgTable\\([^\\{]+\\{([\\s\\S]*?)\\},`);
    const match = schema.match(regex);
    if (match) {
        const columns = match[1];
        const newColumns = columns.replace(/\\s+$/, '') + `\n  ${columnDef},\n`;
        schema = schema.replace(match[0], match[0].replace(columns, newColumns));
    }
}

// 1. Add integer("version").default(1).notNull() to all mutable business tables
const tablesToVersion = [
    'product_categories', 'products', 'farmers', 'drivers', 'origins', 
    'invoices', 'batches', 'formulas', 'formula_items', 
    'production_records', 'inventory_adjustments'
];

// Ensure integer is imported
if (!schema.includes('integer(')) {
    schema = schema.replace(/timestamp,?\\s*/, 'timestamp, integer, ');
}

tablesToVersion.forEach(t => {
    injectColumn(t, 'version: integer("version").default(1).notNull()');
});

// 2. Add legacy columns to invoices
injectColumn('invoices', 'status: text("status").default("active")');
injectColumn('invoices', 'notes: text("notes")');
injectColumn('invoices', 'createdBy: text("created_by")');
injectColumn('invoices', 'updatedBy: text("updated_by")');

// 3. Update sync_mutations to serve as idempotency_keys
schema = schema.replace(
    /export const sync_mutations = pgTable\("sync_mutations"[\s\S]*?\)\);/,
    `export const sync_mutations = pgTable("sync_mutations", {
  id: text("id").primaryKey(), // Using operationId as PK
  entityType: text("entity_type").notNull(),
  action: text("action").notNull(),
  payload: json("payload"), // Will store the request fingerprint or payload
  userId: text("user_id").references(() => users.id),
  resourceId: text("resource_id"),
  requestFingerprint: text("request_fingerprint"),
  status: text("status").default("success"),
  originalResult: json("original_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ 
  createdAtIdx: index("sync_mutations_created_at_idx").on(t.createdAt),
  operationFingerprintIdx: index("sync_mutations_fingerprint_idx").on(t.id, t.requestFingerprint)
}));`
);

fs.writeFileSync('server/db/schema.ts', schema);
