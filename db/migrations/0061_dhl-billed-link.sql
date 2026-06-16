ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "shipment_id" uuid;
DO $$ BEGIN
  ALTER TABLE "carrier_bill_lines" ADD CONSTRAINT "carrier_bill_lines_shipment_id_shipments_id_fk"
    FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
