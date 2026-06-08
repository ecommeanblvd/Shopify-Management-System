CREATE TYPE "public"."fulfillment_line_status" AS ENUM('pending_check', 'in_stock', 'out_of_stock', 'picked', 'packed', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_order_status" AS ENUM('received', 'checking', 'awaiting_brand', 'ready_to_pick', 'picking', 'packed', 'shipped');--> statement-breakpoint
CREATE TABLE "order_fulfillment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "fulfillment_order_status" DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_fulfillment_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_fulfillment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"line_id" uuid,
	"from_status" text,
	"to_status" text,
	"actor" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_fulfillment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"sku" text,
	"qty" integer NOT NULL,
	"status" "fulfillment_line_status" DEFAULT 'pending_check' NOT NULL,
	"warehouse_inventory_id" uuid,
	"allocated_qty" integer DEFAULT 0 NOT NULL,
	"shipment_id" uuid,
	"picked_at" timestamp,
	"packed_at" timestamp,
	"shipped_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_fulfillment_lines_order_line_id_unique" UNIQUE("order_line_id")
);
--> statement-breakpoint
CREATE TABLE "warehouse_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"product_title" text,
	"variant_title" text,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"qty_reserved" integer DEFAULT 0 NOT NULL,
	"shelf" text,
	"floor" text,
	"bin" text,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_inventory_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "order_fulfillment" ADD CONSTRAINT "order_fulfillment_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_events" ADD CONSTRAINT "order_fulfillment_events_fulfillment_id_order_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."order_fulfillment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_lines" ADD CONSTRAINT "order_fulfillment_lines_fulfillment_id_order_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."order_fulfillment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_lines" ADD CONSTRAINT "order_fulfillment_lines_order_line_id_shopify_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."shopify_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_lines" ADD CONSTRAINT "order_fulfillment_lines_warehouse_inventory_id_warehouse_inventory_id_fk" FOREIGN KEY ("warehouse_inventory_id") REFERENCES "public"."warehouse_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_lines" ADD CONSTRAINT "order_fulfillment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_fulfillment_status_idx" ON "order_fulfillment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_fulfillment_lines_ful_idx" ON "order_fulfillment_lines" USING btree ("fulfillment_id");