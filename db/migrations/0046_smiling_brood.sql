CREATE TYPE "public"."shopify_push_status" AS ENUM('pending', 'pushed', 'failed');--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shopify_fulfillment_id" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shopify_push_status" "shopify_push_status";--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shopify_push_error" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shopify_pushed_at" timestamp;