ALTER TABLE "goods_receipts" ALTER COLUMN "warehouse_code" SET DEFAULT 'GVM';--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ALTER COLUMN "warehouse_code" SET DEFAULT 'GVM';