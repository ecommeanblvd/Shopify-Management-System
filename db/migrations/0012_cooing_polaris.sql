ALTER TABLE "stores" ADD COLUMN "cost_currency" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "fx_cost_per_order_currency" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cost_fx_updated_at" timestamp;