ALTER TABLE "shopify_order_lines" ADD COLUMN "cost_override" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "shipping_cost_override" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "shipping_cost_override_note" text;