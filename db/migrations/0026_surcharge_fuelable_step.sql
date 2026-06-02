ALTER TYPE "public"."carrier_surcharge_kind" ADD VALUE 'per_step_fixed';--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "step_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "fuelable" boolean;