CREATE TYPE "public"."brand_request_confirm_status" AS ENUM('awaiting', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."brand_request_send_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
ALTER TYPE "public"."fulfillment_line_status" ADD VALUE 'brand_requested';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_line_status" ADD VALUE 'brand_confirmed';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_line_status" ADD VALUE 'brand_rejected';--> statement-breakpoint
CREATE TABLE "brand_order_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_line_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"brand_slug" text,
	"sku" text,
	"qty" integer NOT NULL,
	"send_status" "brand_request_send_status" DEFAULT 'pending' NOT NULL,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp,
	"external_ref" text,
	"confirm_status" "brand_request_confirm_status" DEFAULT 'awaiting' NOT NULL,
	"expected_delivery_date" date,
	"note" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_order_requests_fulfillment_line_id_unique" UNIQUE("fulfillment_line_id")
);
--> statement-breakpoint
ALTER TABLE "brand_order_requests" ADD CONSTRAINT "brand_order_requests_fulfillment_line_id_order_fulfillment_lines_id_fk" FOREIGN KEY ("fulfillment_line_id") REFERENCES "public"."order_fulfillment_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_order_requests" ADD CONSTRAINT "brand_order_requests_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_order_requests_confirm_idx" ON "brand_order_requests" USING btree ("confirm_status");--> statement-breakpoint
CREATE INDEX "brand_order_requests_order_idx" ON "brand_order_requests" USING btree ("order_id");