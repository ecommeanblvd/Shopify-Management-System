ALTER TABLE "shipments" ADD COLUMN "delivery_status" text;
ALTER TABLE "shipments" ADD COLUMN "delivered_at" timestamp;
ALTER TABLE "shipments" ADD COLUMN "last_tracked_at" timestamp;
ALTER TABLE "shipments" ADD COLUMN "track_detail" text;
