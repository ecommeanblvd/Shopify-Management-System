CREATE TYPE "public"."mmp_curation_status" AS ENUM('received', 'approved', 'rejected', 'pushed');--> statement-breakpoint
CREATE TYPE "public"."mmp_product_status" AS ENUM('live', 'draft', 'archived');--> statement-breakpoint
CREATE TABLE "mmp_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"note" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mmp_brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mmp_ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload_hash" text NOT NULL,
	"result" text NOT NULL,
	"product_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"errors" jsonb,
	"source_ip" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processing_ms" integer
);
--> statement-breakpoint
CREATE TABLE "mmp_product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"role" text,
	"is_thumbnail" boolean DEFAULT false NOT NULL,
	"alt_text" text
);
--> statement-breakpoint
CREATE TABLE "mmp_product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"color" text,
	"size" text,
	"inventory" integer DEFAULT 0 NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"length_cm" numeric(8, 2),
	"length_cm_max" numeric(8, 2),
	"position" integer DEFAULT 0 NOT NULL,
	"shopify_variant_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mmp_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_product_id" text NOT NULL,
	"brand_slug" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"global_name" text,
	"short_summary" text,
	"description" text,
	"collection" text,
	"product_type" text,
	"status" "mmp_product_status" NOT NULL,
	"base_price" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"price_usd" numeric(10, 2),
	"attributes" jsonb,
	"details" jsonb,
	"curation_status" "mmp_curation_status" DEFAULT 'received' NOT NULL,
	"curation_note" text,
	"shopify_product_id" text,
	"pushed_to_shopify_at" timestamp,
	"last_received_at" timestamp DEFAULT now() NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mmp_products_portal_product_id_unique" UNIQUE("portal_product_id")
);
--> statement-breakpoint
ALTER TABLE "mmp_product_images" ADD CONSTRAINT "mmp_product_images_product_id_mmp_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."mmp_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mmp_product_variants" ADD CONSTRAINT "mmp_product_variants_product_id_mmp_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."mmp_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mmp_products" ADD CONSTRAINT "mmp_products_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mmp_ingestion_runs_received_idx" ON "mmp_ingestion_runs" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "mmp_ingestion_runs_hash_idx" ON "mmp_ingestion_runs" USING btree ("payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mmp_product_images_product_url_idx" ON "mmp_product_images" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "mmp_product_images_product_position_idx" ON "mmp_product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mmp_product_variants_product_sku_idx" ON "mmp_product_variants" USING btree ("product_id","sku");--> statement-breakpoint
CREATE INDEX "mmp_products_brand_idx" ON "mmp_products" USING btree ("brand_slug");--> statement-breakpoint
CREATE INDEX "mmp_products_status_idx" ON "mmp_products" USING btree ("curation_status");--> statement-breakpoint
CREATE INDEX "mmp_products_sku_idx" ON "mmp_products" USING btree ("sku");