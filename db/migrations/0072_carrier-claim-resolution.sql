ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'credited';--> statement-breakpoint
ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'accepted';--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "recovered_vnd" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "credit_note_number" text;--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "credit_note_file_key" text;
