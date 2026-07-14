ALTER TABLE "ship_ho_orders" ADD COLUMN "reconcile_decision" text;--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "reconcile_decision_at" timestamp;--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "reconcile_decision_by" text;--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "claim_reason" text;
