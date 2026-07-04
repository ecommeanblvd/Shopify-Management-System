CREATE TABLE "customer_account_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_configs_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
CREATE TABLE "customer_account_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_customer_id" text NOT NULL,
	"order_number" text,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_loyalty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_customer_id" text NOT NULL,
	"tier" text NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_account_configs" ADD CONSTRAINT "customer_account_configs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_account_assets" ADD CONSTRAINT "customer_account_assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_return_requests" ADD CONSTRAINT "customer_return_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_return_requests" ADD CONSTRAINT "customer_return_requests_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_loyalty" ADD CONSTRAINT "customer_loyalty_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_account_assets_store_idx" ON "customer_account_assets" ("store_id");
--> statement-breakpoint
CREATE INDEX "customer_return_requests_store_status_idx" ON "customer_return_requests" ("store_id","status");
--> statement-breakpoint
CREATE INDEX "customer_return_requests_customer_idx" ON "customer_return_requests" ("store_id","shopify_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_loyalty_uq" ON "customer_loyalty" ("store_id","shopify_customer_id");
--> statement-breakpoint
CREATE INDEX "shopify_orders_customer_expr_idx" ON "shopify_orders" ("store_id", ((raw_payload->'customer'->>'id')));
