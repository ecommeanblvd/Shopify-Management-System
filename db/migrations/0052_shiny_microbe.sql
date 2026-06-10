CREATE TYPE "public"."inventory_movement_reason" AS ENUM('receipt_po', 'receipt_consignment', 'receipt_return', 'auto_allocate', 'release_allocation', 'pick', 'manual_adjust', 'transfer_in', 'transfer_out', 'migration');--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_inventory_id" uuid NOT NULL,
	"delta_on_hand" integer DEFAULT 0 NOT NULL,
	"delta_reserved" integer DEFAULT 0 NOT NULL,
	"reason" "inventory_movement_reason" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"actor" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouse_inventory" DROP CONSTRAINT "warehouse_inventory_sku_unique";--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD COLUMN "warehouse_code" text DEFAULT 'HN' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_inventory_id_warehouse_inventory_id_fk" FOREIGN KEY ("warehouse_inventory_id") REFERENCES "public"."warehouse_inventory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_inv_idx" ON "inventory_movements" USING btree ("warehouse_inventory_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_reason_idx" ON "inventory_movements" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_inventory_sku_warehouse_idx" ON "warehouse_inventory" USING btree ("sku","warehouse_code");--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_reserved_lte_on_hand" CHECK ("warehouse_inventory"."qty_reserved" <= "warehouse_inventory"."qty_on_hand");