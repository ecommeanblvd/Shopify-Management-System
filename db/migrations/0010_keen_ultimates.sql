CREATE TABLE "shipping_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"tracking_number" text NOT NULL,
	"invoice_period_start" date NOT NULL,
	"invoice_period_end" date NOT NULL,
	"actual_cost" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_line_id" text NOT NULL,
	"sku" text,
	"vendor" text,
	"product_title" text NOT NULL,
	"variant_title" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"discount_alloc" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_order_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_refund_id" text NOT NULL,
	"refunded_at" timestamp NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text,
	CONSTRAINT "shopify_order_refunds_shopify_refund_id_unique" UNIQUE("shopify_refund_id")
);
--> statement-breakpoint
CREATE TABLE "shopify_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_order_id" text NOT NULL,
	"shopify_order_number" text NOT NULL,
	"created_at_shopify" timestamp NOT NULL,
	"processed_at_shopify" timestamp NOT NULL,
	"cancelled_at_shopify" timestamp,
	"financial_status" text NOT NULL,
	"fulfillment_status" text,
	"currency" text NOT NULL,
	"gross_line_total" numeric(14, 2) NOT NULL,
	"total_discount" numeric(14, 2) NOT NULL,
	"total_shipping" numeric(14, 2) NOT NULL,
	"total_tax" numeric(14, 2) NOT NULL,
	"total_price" numeric(14, 2) NOT NULL,
	"ship_country" text,
	"ship_weight_kg" numeric(10, 3),
	"raw_payload" jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "shopify_orders_shopify_order_id_unique" UNIQUE("shopify_order_id")
);
--> statement-breakpoint
CREATE TABLE "shopify_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"backfill_status" text DEFAULT 'idle' NOT NULL,
	"backfill_cursor" text,
	"backfill_started_at" timestamp,
	"backfill_finished_at" timestamp,
	"backfill_error" text,
	"last_webhook_at" timestamp,
	"last_cron_sync_at" timestamp,
	"last_cron_cursor" text,
	CONSTRAINT "shopify_sync_state_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
CREATE TABLE "shopify_webhook_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"shopify_webhook_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" text NOT NULL,
	"error" text,
	"payload_hash" text NOT NULL,
	CONSTRAINT "shopify_webhook_log_shopify_webhook_id_unique" UNIQUE("shopify_webhook_id")
);
--> statement-breakpoint
CREATE TABLE "sku_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"cost_per_unit" numeric(14, 4) NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"source" text NOT NULL,
	"uploaded_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipping_invoices" ADD CONSTRAINT "shipping_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_invoices" ADD CONSTRAINT "shipping_invoices_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_lines" ADD CONSTRAINT "shopify_order_lines_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_refunds" ADD CONSTRAINT "shopify_order_refunds_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD CONSTRAINT "shopify_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_sync_state" ADD CONSTRAINT "shopify_sync_state_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_webhook_log" ADD CONSTRAINT "shopify_webhook_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_costs" ADD CONSTRAINT "sku_costs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_costs" ADD CONSTRAINT "sku_costs_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_invoices_store_tracking_idx" ON "shipping_invoices" USING btree ("store_id","tracking_number");--> statement-breakpoint
CREATE INDEX "shipping_invoices_carrier_period_idx" ON "shipping_invoices" USING btree ("carrier_account_id","invoice_period_start");--> statement-breakpoint
CREATE INDEX "shopify_order_lines_order_idx" ON "shopify_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shopify_order_lines_sku_idx" ON "shopify_order_lines" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "shopify_order_lines_vendor_idx" ON "shopify_order_lines" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "shopify_order_refunds_order_idx" ON "shopify_order_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shopify_order_refunds_refunded_at_idx" ON "shopify_order_refunds" USING btree ("refunded_at");--> statement-breakpoint
CREATE INDEX "shopify_orders_store_processed_idx" ON "shopify_orders" USING btree ("store_id","processed_at_shopify");--> statement-breakpoint
CREATE INDEX "shopify_orders_cancelled_idx" ON "shopify_orders" USING btree ("cancelled_at_shopify");--> statement-breakpoint
CREATE INDEX "shopify_webhook_log_store_received_idx" ON "shopify_webhook_log" USING btree ("store_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_costs_store_sku_from_idx" ON "sku_costs" USING btree ("store_id","sku","effective_from");--> statement-breakpoint
CREATE INDEX "sku_costs_lookup_idx" ON "sku_costs" USING btree ("store_id","sku","effective_from");