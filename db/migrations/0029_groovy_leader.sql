CREATE TYPE "public"."packaging_type" AS ENUM('bag', 'box');--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"tracking_number" text,
	"carrier_key" text,
	"dim_length_cm" numeric(8, 2),
	"dim_width_cm" numeric(8, 2),
	"dim_height_cm" numeric(8, 2),
	"actual_weight_kg" numeric(10, 3),
	"packaging_type" "packaging_type",
	"label_created_at" timestamp,
	"log_unique_code" text,
	"origin_hub" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_accounts" ADD COLUMN "dim_divisor_cm3_per_kg" numeric(8, 2) DEFAULT '5000';--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_log_unique_code_idx" ON "shipments" USING btree ("log_unique_code");