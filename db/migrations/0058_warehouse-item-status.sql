CREATE TYPE "public"."warehouse_item_status" AS ENUM('pending', 'in_stock', 'staging', 'allocated', 'picked', 'shipped', 'qc_failed', 'returned_to_vendor');--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "current_warehouse_code" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "stock_status" "warehouse_item_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "gri_stock_pick_idx" ON "goods_receipt_items" USING btree ("sku","stock_status","current_warehouse_code");