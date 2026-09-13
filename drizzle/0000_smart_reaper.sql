CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_number" text NOT NULL,
	"product_id" text NOT NULL,
	"production_record_id" text,
	"initial_quantity" numeric NOT NULL,
	"remaining_quantity" numeric NOT NULL,
	"production_date" text,
	"expiry_date" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"iban" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "drivers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"broods" json,
	"is_hidden" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formula_items" (
	"id" text PRIMARY KEY NOT NULL,
	"formula_id" text NOT NULL,
	"product_id" text NOT NULL,
	"percentage" numeric,
	"quantity" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formulas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"finished_good_id" text NOT NULL,
	"items" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"product_id" text NOT NULL,
	"new_quantity" numeric NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"product_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"balance_after" numeric,
	"reference_type" text,
	"reference_id" text,
	"batch_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text,
	"driver_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"seller_name" text,
	"bill_weight" numeric,
	"scale_weight" numeric,
	"factory" text,
	"bill_number" text,
	"origin" text,
	"transport_cost" numeric,
	"driver_phone" text,
	"driver_iban" text,
	"wastage" numeric,
	"farmer_id" text,
	"weight" numeric,
	"invoice_number" text,
	"product_variant" text,
	"is_crumble" boolean DEFAULT false,
	"is_page_break" boolean DEFAULT false,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active',
	"notes" text,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"action_text" text,
	"type" text,
	"details" text,
	"by" text
);
--> statement-breakpoint
CREATE TABLE "origins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "origins_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "production_records" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"finished_good_id" text NOT NULL,
	"formula_id" text,
	"quantity_produced" numeric NOT NULL,
	"batch_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category_id" text,
	"unit" text DEFAULT 'kg',
	"min_stock" numeric,
	"current_stock" numeric DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mutations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"action" text NOT NULL,
	"payload" json,
	"user_id" text,
	"resource_id" text,
	"request_fingerprint" text,
	"status" text DEFAULT 'success',
	"original_result" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'ADMIN' NOT NULL,
	"full_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"location" text,
	"manager" text,
	"capacity" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "warehouses_name_unique" UNIQUE("name"),
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_items" ADD CONSTRAINT "formula_items_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_items" ADD CONSTRAINT "formula_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_finished_good_id_products_id_fk" FOREIGN KEY ("finished_good_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_finished_good_id_products_id_fk" FOREIGN KEY ("finished_good_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_product_id_idx" ON "batches" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "batches_batch_number_idx" ON "batches" USING btree ("batch_number");--> statement-breakpoint
CREATE INDEX "drivers_updated_at_idx" ON "drivers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "drivers_name_idx" ON "drivers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "farmers_updated_at_idx" ON "farmers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "farmers_name_idx" ON "farmers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "formula_items_formula_id_idx" ON "formula_items" USING btree ("formula_id");--> statement-breakpoint
CREATE INDEX "formula_items_product_id_idx" ON "formula_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "formulas_updated_at_idx" ON "formulas" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "formulas_finished_good_id_idx" ON "formulas" USING btree ("finished_good_id");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_updated_at_idx" ON "inventory_adjustments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_date_idx" ON "inventory_adjustments" USING btree ("date");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_product_id_idx" ON "inventory_adjustments" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_transactions_product_id_idx" ON "inventory_transactions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_transactions_date_idx" ON "inventory_transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "inventory_transactions_reference_id_idx" ON "inventory_transactions" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "invoices_updated_at_idx" ON "invoices" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("date");--> statement-breakpoint
CREATE INDEX "invoices_type_idx" ON "invoices" USING btree ("type");--> statement-breakpoint
CREATE INDEX "invoices_product_id_idx" ON "invoices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "invoices_farmer_id_idx" ON "invoices" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "logs_timestamp_idx" ON "logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "logs_type_idx" ON "logs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "origins_updated_at_idx" ON "origins" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "production_records_updated_at_idx" ON "production_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "production_records_date_idx" ON "production_records" USING btree ("date");--> statement-breakpoint
CREATE INDEX "production_records_finished_good_id_idx" ON "production_records" USING btree ("finished_good_id");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("type");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_mutations_created_at_idx" ON "sync_mutations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sync_mutations_fingerprint_idx" ON "sync_mutations" USING btree ("id","request_fingerprint");--> statement-breakpoint
CREATE INDEX "warehouses_name_idx" ON "warehouses" USING btree ("name");