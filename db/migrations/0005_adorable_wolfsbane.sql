CREATE TYPE "public"."carrier_quote_context" AS ENUM('calculator', 'push_recalc');--> statement-breakpoint
CREATE TYPE "public"."carrier_surcharge_kind" AS ENUM('fuel_percent', 'peak_fixed', 'remote_fixed', 'residential_fixed', 'markup_percent');--> statement-breakpoint
CREATE TYPE "public"."carrier_weight_unit" AS ENUM('kg', 'lb');--> statement-breakpoint
CREATE TABLE "carrier_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weight_unit" "carrier_weight_unit" DEFAULT 'kg' NOT NULL,
	"cost_currency" text NOT NULL,
	"display_currency" text NOT NULL,
	"fx_cost_per_display" numeric(14, 4) NOT NULL,
	"fx_updated_at" timestamp DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_quote_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"destination_country" text NOT NULL,
	"destination_postcode" text,
	"weight_kg" numeric(8, 3) NOT NULL,
	"breakdown" jsonb NOT NULL,
	"context" "carrier_quote_context" NOT NULL,
	"computed_by" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_rate_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_zone_id" uuid NOT NULL,
	"carrier_weight_tier_id" uuid NOT NULL,
	"cost_amount" numeric(14, 2) NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_remote_postcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"postcode_pattern" text NOT NULL,
	"source" text,
	"uploaded_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_surcharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"kind" "carrier_surcharge_kind" NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"note" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_weight_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"upper_kg" numeric(8, 3) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_zone_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"carrier_zone_id" uuid NOT NULL,
	"country_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "market_carrier_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_handle" text NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"service_label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "carrier_accounts_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "carrier_accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_quote_logs" ADD CONSTRAINT "carrier_quote_logs_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_quote_logs" ADD CONSTRAINT "carrier_quote_logs_computed_by_user_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD CONSTRAINT "carrier_rate_cells_carrier_zone_id_carrier_zones_id_fk" FOREIGN KEY ("carrier_zone_id") REFERENCES "public"."carrier_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD CONSTRAINT "carrier_rate_cells_carrier_weight_tier_id_carrier_weight_tiers_id_fk" FOREIGN KEY ("carrier_weight_tier_id") REFERENCES "public"."carrier_weight_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD CONSTRAINT "carrier_rate_cells_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_remote_postcodes" ADD CONSTRAINT "carrier_remote_postcodes_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_remote_postcodes" ADD CONSTRAINT "carrier_remote_postcodes_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD CONSTRAINT "carrier_surcharges_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD CONSTRAINT "carrier_surcharges_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_weight_tiers" ADD CONSTRAINT "carrier_weight_tiers_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_zone_countries" ADD CONSTRAINT "carrier_zone_countries_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_zone_countries" ADD CONSTRAINT "carrier_zone_countries_carrier_zone_id_carrier_zones_id_fk" FOREIGN KEY ("carrier_zone_id") REFERENCES "public"."carrier_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_zones" ADD CONSTRAINT "carrier_zones_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_carrier_links" ADD CONSTRAINT "market_carrier_links_market_handle_market_templates_handle_fk" FOREIGN KEY ("market_handle") REFERENCES "public"."market_templates"("handle") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_carrier_links" ADD CONSTRAINT "market_carrier_links_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_carrier_links" ADD CONSTRAINT "market_carrier_links_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_quote_logs_account_computed_idx" ON "carrier_quote_logs" USING btree ("carrier_account_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_rate_cells_zone_tier_idx" ON "carrier_rate_cells" USING btree ("carrier_zone_id","carrier_weight_tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_remote_postcodes_account_country_pattern_idx" ON "carrier_remote_postcodes" USING btree ("carrier_account_id","country_code","postcode_pattern");--> statement-breakpoint
CREATE INDEX "carrier_remote_postcodes_lookup_idx" ON "carrier_remote_postcodes" USING btree ("carrier_account_id","country_code");--> statement-breakpoint
CREATE INDEX "carrier_surcharges_account_kind_idx" ON "carrier_surcharges" USING btree ("carrier_account_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_weight_tiers_account_upper_idx" ON "carrier_weight_tiers" USING btree ("carrier_account_id","upper_kg");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_zone_countries_account_country_idx" ON "carrier_zone_countries" USING btree ("carrier_account_id","country_code");--> statement-breakpoint
CREATE INDEX "carrier_zone_countries_zone_idx" ON "carrier_zone_countries" USING btree ("carrier_zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_zones_account_label_idx" ON "carrier_zones" USING btree ("carrier_account_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "market_carrier_links_market_account_idx" ON "market_carrier_links" USING btree ("market_handle","carrier_account_id");

-- Seed carrier brands (idempotent) --
INSERT INTO "carriers" ("key", "name") VALUES ('dhl', 'DHL Express') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "carriers" ("key", "name") VALUES ('fedex', 'FedEx') ON CONFLICT ("key") DO NOTHING;
