CREATE TYPE "public"."qc_result" AS ENUM('pending', 'pass', 'fail');--> statement-breakpoint
CREATE TYPE "public"."receipt_item_disposition" AS ENUM('pending', 'allocate_to_order', 'store', 'return_to_brand');--> statement-breakpoint
CREATE TYPE "public"."receipt_source_type" AS ENUM('retail_for_order', 'consignment', 'po');--> statement-breakpoint
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"sku" text,
	"product_title" text,
	"variant_title" text,
	"photo_key" text,
	"qc_result" "qc_result" DEFAULT 'pending' NOT NULL,
	"qc_fail_reason" text,
	"qc_fail_photo_key" text,
	"qc_checked_by" text,
	"qc_checked_at" timestamp,
	"disposition" "receipt_item_disposition" DEFAULT 'pending' NOT NULL,
	"vendor_return_doc_key" text,
	"brand_request_id" uuid,
	"fulfillment_line_id" uuid,
	"order_id" uuid,
	"dom_price" numeric(14, 2),
	"dom_price_currency" text,
	"global_price" numeric(14, 2),
	"global_price_currency" text,
	"weight_kg" numeric(10, 3),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_items_unit_code_unique" UNIQUE("unit_code")
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"warehouse_code" text DEFAULT 'HN' NOT NULL,
	"source_type" "receipt_source_type" NOT NULL,
	"vendor" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"received_by" text,
	"handover_doc_key" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_qc_checked_by_user_id_fk" FOREIGN KEY ("qc_checked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_brand_request_id_brand_order_requests_id_fk" FOREIGN KEY ("brand_request_id") REFERENCES "public"."brand_order_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_fulfillment_line_id_order_fulfillment_lines_id_fk" FOREIGN KEY ("fulfillment_line_id") REFERENCES "public"."order_fulfillment_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_items_receipt_idx" ON "goods_receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_items_qc_idx" ON "goods_receipt_items" USING btree ("qc_result");--> statement-breakpoint
CREATE INDEX "goods_receipt_items_line_idx" ON "goods_receipt_items" USING btree ("fulfillment_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_items_disposition_idx" ON "goods_receipt_items" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "goods_receipts_source_idx" ON "goods_receipts" USING btree ("source_type");