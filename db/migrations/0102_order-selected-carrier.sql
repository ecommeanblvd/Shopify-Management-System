ALTER TABLE "shopify_orders" ADD COLUMN "selected_carrier_key" text;
--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "selected_carrier_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "selected_carrier_by" text;
