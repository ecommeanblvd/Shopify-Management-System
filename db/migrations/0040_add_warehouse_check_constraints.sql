ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_qty_on_hand_nonneg" CHECK ("qty_on_hand" >= 0);--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_qty_reserved_nonneg" CHECK ("qty_reserved" >= 0);
