CREATE TABLE "shipment_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"carrier_account_id" uuid,
	"tracking_number" text NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"base" numeric(14, 2),
	"fuel" numeric(14, 2),
	"remote" numeric(14, 2),
	"demand" numeric(14, 2),
	"direct_signature" numeric(14, 2),
	"vat" numeric(14, 2),
	"gogreen" numeric(14, 2),
	"discount" numeric(14, 2),
	"elevated_risk" numeric(14, 2),
	"source" text NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment_charges" ADD CONSTRAINT "shipment_charges_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_charges" ADD CONSTRAINT "shipment_charges_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_charges_source_hash_idx" ON "shipment_charges" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX "shipment_charges_shipment_idx" ON "shipment_charges" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_charges_tracking_idx" ON "shipment_charges" USING btree ("tracking_number");