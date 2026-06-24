CREATE TABLE "lark_order_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"dispatch_status" text,
	"cx_ff_status" text,
	"delivery_status" text,
	"expected_delivery_date" date,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lark_order_status_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "lark_order_status" ADD CONSTRAINT "lark_order_status_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
