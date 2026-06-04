CREATE TABLE "shopify_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_variant_id" text NOT NULL,
	"shopify_product_id" text NOT NULL,
	"sku" text,
	"variant_title" text,
	"product_title" text NOT NULL,
	"weight_grams" numeric(12, 3),
	"weight_unit" text,
	"taxable" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopify_variants" ADD CONSTRAINT "shopify_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_variants_unique" ON "shopify_variants" USING btree ("store_id","shopify_variant_id");--> statement-breakpoint
CREATE INDEX "shopify_variants_sku_idx" ON "shopify_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "shopify_variants_product_idx" ON "shopify_variants" USING btree ("shopify_product_id");