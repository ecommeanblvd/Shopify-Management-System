CREATE TYPE "public"."transfer_status" AS ENUM('draft', 'in_transit', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_title" text,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_id_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_transfer_idx" ON "inventory_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_status_idx" ON "inventory_transfers" USING btree ("status");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "transfer_code_seq" START WITH 100000;--> statement-breakpoint
INSERT INTO "warehouses" ("code", "name") VALUES ('HN', 'Hà Nội') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "warehouses" ("code", "name") VALUES ('SG', 'Sài Gòn') ON CONFLICT ("code") DO NOTHING;