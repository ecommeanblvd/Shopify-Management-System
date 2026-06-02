CREATE TABLE "gift_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"owner_email" text NOT NULL,
	"owner_name" text,
	"event_name" text NOT NULL,
	"event_date" date,
	"message" text,
	"share_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_registry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_id" uuid NOT NULL,
	"shopify_product_id" text NOT NULL,
	"shopify_variant_id" text,
	"product_title" text NOT NULL,
	"variant_title" text,
	"product_handle" text NOT NULL,
	"image_url" text,
	"price_amount" numeric(14, 2),
	"price_currency" text,
	"qty_wanted" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_registry_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reserver_name" text NOT NULL,
	"reserver_email" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"message" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gift_registries" ADD CONSTRAINT "gift_registries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_registry_items" ADD CONSTRAINT "gift_registry_items_registry_id_gift_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."gift_registries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_registry_reservations" ADD CONSTRAINT "gift_registry_reservations_registry_id_gift_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."gift_registries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_registry_reservations" ADD CONSTRAINT "gift_registry_reservations_item_id_gift_registry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."gift_registry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_registries_token_idx" ON "gift_registries" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "gift_registries_owner_idx" ON "gift_registries" USING btree ("store_id","owner_email");--> statement-breakpoint
CREATE INDEX "gift_registry_items_registry_idx" ON "gift_registry_items" USING btree ("registry_id");--> statement-breakpoint
CREATE INDEX "gift_registry_reservations_item_idx" ON "gift_registry_reservations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "gift_registry_reservations_registry_idx" ON "gift_registry_reservations" USING btree ("registry_id");