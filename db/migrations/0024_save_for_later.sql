CREATE TABLE "save_for_later_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_email" text,
	"shopify_customer_id" text,
	"device_id" text NOT NULL,
	"shopify_product_id" text NOT NULL,
	"shopify_variant_id" text,
	"product_title" text NOT NULL,
	"variant_title" text,
	"product_handle" text NOT NULL,
	"image_url" text,
	"price_amount" numeric(14, 2),
	"price_currency" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "save_for_later_items" ADD CONSTRAINT "save_for_later_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "save_for_later_device_idx" ON "save_for_later_items" USING btree ("store_id","device_id","saved_at");--> statement-breakpoint
CREATE INDEX "save_for_later_email_idx" ON "save_for_later_items" USING btree ("store_id","customer_email","saved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "save_for_later_dedup_idx" ON "save_for_later_items" USING btree ("store_id","device_id","shopify_product_id",COALESCE("shopify_variant_id", ''));