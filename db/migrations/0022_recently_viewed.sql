CREATE TABLE "recently_viewed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_email" text,
	"shopify_customer_id" text,
	"device_id" text,
	"shopify_product_id" text NOT NULL,
	"shopify_variant_id" text,
	"product_title" text NOT NULL,
	"product_handle" text NOT NULL,
	"image_url" text,
	"price_amount" numeric(14, 2),
	"price_currency" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recently_viewed_events" ADD CONSTRAINT "recently_viewed_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recently_viewed_device_time_idx" ON "recently_viewed_events" USING btree ("store_id","device_id","viewed_at");--> statement-breakpoint
CREATE INDEX "recently_viewed_email_time_idx" ON "recently_viewed_events" USING btree ("store_id","customer_email","viewed_at");--> statement-breakpoint
CREATE INDEX "recently_viewed_product_idx" ON "recently_viewed_events" USING btree ("store_id","shopify_product_id","viewed_at");