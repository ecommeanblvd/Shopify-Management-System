ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_warehouse_inventory_id_warehouse_inventory_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_inventory_id_warehouse_inventory_id_fk" FOREIGN KEY ("warehouse_inventory_id") REFERENCES "public"."warehouse_inventory"("id") ON DELETE restrict ON UPDATE no action;