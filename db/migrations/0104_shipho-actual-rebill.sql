ALTER TABLE "ship_ho_orders" ADD COLUMN "actual_weight_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "actual_charged_vnd" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "actual_bill_breakdown" jsonb;
