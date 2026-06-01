ALTER TYPE "public"."carrier_surcharge_kind" ADD VALUE 'demand_per_kg';--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "country_codes" jsonb;