CREATE TABLE "store_function_settings" (
	"store_id" uuid NOT NULL,
	"function_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_function_settings_store_id_function_key_pk" PRIMARY KEY("store_id","function_key")
);
--> statement-breakpoint
CREATE TABLE "wishlist_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"wishlist_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"shopify_product_id" text NOT NULL,
	"shopify_variant_id" text,
	"product_title" text NOT NULL,
	"variant_title" text,
	"product_handle" text NOT NULL,
	"image_url" text,
	"price_amount" numeric(14, 2),
	"price_currency" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_email" text,
	"shopify_customer_id" text,
	"device_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_function_settings" ADD CONSTRAINT "store_function_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_function_settings" ADD CONSTRAINT "store_function_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_events" ADD CONSTRAINT "wishlist_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_events" ADD CONSTRAINT "wishlist_events_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_events_store_created_idx" ON "wishlist_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_dedup_idx" ON "wishlist_items" USING btree ("wishlist_id","shopify_product_id",COALESCE("shopify_variant_id", ''));--> statement-breakpoint
CREATE INDEX "wishlist_items_product_idx" ON "wishlist_items" USING btree ("shopify_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_store_email_idx" ON "wishlists" USING btree ("store_id","customer_email") WHERE "wishlists"."customer_email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_store_device_idx" ON "wishlists" USING btree ("store_id","device_id") WHERE "wishlists"."device_id" IS NOT NULL;