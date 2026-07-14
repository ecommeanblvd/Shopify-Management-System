ALTER TABLE "shopify_sync_state" ADD COLUMN "backfill_phase" text;--> statement-breakpoint
ALTER TABLE "shopify_sync_state" ADD COLUMN "backfill_object_count" integer;--> statement-breakpoint
ALTER TABLE "shopify_sync_state" ADD COLUMN "backfill_total" integer;--> statement-breakpoint
ALTER TABLE "shopify_sync_state" ADD COLUMN "backfill_ingested" integer;--> statement-breakpoint
ALTER TABLE "shopify_sync_state" ADD COLUMN "backfill_progress_at" timestamp;
