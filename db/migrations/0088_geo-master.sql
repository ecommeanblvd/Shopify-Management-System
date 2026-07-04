CREATE TABLE "geo_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"state_code" text,
	"name" text NOT NULL,
	"name_norm" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_postcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"postcode" text NOT NULL,
	"postcode_norm" text NOT NULL,
	"city" text NOT NULL,
	"state_code" text,
	"lat" numeric(9, 5),
	"lng" numeric(9, 5)
);
--> statement-breakpoint
CREATE TABLE "geo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"source" text DEFAULT 'geonames' NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "geo_imports_country_code_unique" UNIQUE("country_code")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_states_country_code_uq" ON "geo_states" ("country_code","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_cities_uq" ON "geo_cities" ("country_code","state_code","name_norm");
--> statement-breakpoint
CREATE INDEX "geo_cities_country_idx" ON "geo_cities" ("country_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_postcodes_uq" ON "geo_postcodes" ("country_code","postcode_norm","city");
--> statement-breakpoint
CREATE INDEX "geo_postcodes_lookup_idx" ON "geo_postcodes" ("country_code","postcode_norm");
