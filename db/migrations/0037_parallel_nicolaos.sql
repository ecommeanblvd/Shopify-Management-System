CREATE TYPE "public"."reconcile_status" AS ENUM('reconciled', 'ignored');--> statement-breakpoint
CREATE TABLE "shipment_reconcile_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "reconcile_status" NOT NULL,
	"note" text,
	"billed_total_at_review" numeric(14, 2),
	"reconciled_by" text,
	"reconciled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_reconcile_status_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD CONSTRAINT "shipment_reconcile_status_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;