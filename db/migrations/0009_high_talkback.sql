ALTER TABLE "carrier_surcharges" ADD COLUMN "last_auto_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "last_auto_source" text;