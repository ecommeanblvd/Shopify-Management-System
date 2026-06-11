ALTER TYPE "public"."carrier_surcharge_kind" ADD VALUE 'addon_fixed';--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "apply_mode" text DEFAULT 'always' NOT NULL;