CREATE TABLE "lifecycle_sla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"target_hours" integer NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_sla_key_unique" UNIQUE("key")
);

CREATE TABLE "order_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"current_stage" text DEFAULT 'placed' NOT NULL,
	"exception" boolean DEFAULT false NOT NULL,
	"exception_note" text,
	"placed_at" timestamp,
	"production_start_at" timestamp,
	"production_confirmed_at" timestamp,
	"production_eta" date,
	"goods_received_at" timestamp,
	"qc_pass_at" timestamp,
	"packed_at" timestamp,
	"shipped_at" timestamp,
	"in_transit_at" timestamp,
	"out_for_delivery_at" timestamp,
	"delivered_at" timestamp,
	"return_processing_at" timestamp,
	"refunded_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"deadline" timestamp,
	"delay_status" text DEFAULT 'on_track' NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_lifecycle_order_id_unique" UNIQUE("order_id")
);

ALTER TABLE "order_lifecycle" ADD CONSTRAINT "order_lifecycle_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_lifecycle" ADD CONSTRAINT "order_lifecycle_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "order_lifecycle_stage_idx" ON "order_lifecycle" ("current_stage");
CREATE INDEX "order_lifecycle_delay_idx" ON "order_lifecycle" ("delay_status");
CREATE INDEX "order_lifecycle_store_idx" ON "order_lifecycle" ("store_id");

INSERT INTO "lifecycle_sla" ("key", "target_hours", "note") VALUES
	('placed_to_production', 24, 'Đặt hàng → push brand'),
	('production', 240, 'Push brand → hàng về kho (ưu tiên ETA brand nếu có)'),
	('qc', 48, 'Hàng về kho → QC pass'),
	('pack', 48, 'QC pass (hoặc placed nếu đủ kho) → packed'),
	('ship', 24, 'Packed → bàn giao carrier'),
	('deliver', 168, 'Shipped → delivered')
ON CONFLICT ("key") DO NOTHING;
