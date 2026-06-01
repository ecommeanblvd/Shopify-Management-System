CREATE TYPE "public"."carrier_package_type" AS ENUM('pak', 'package');--> statement-breakpoint
DROP INDEX "carrier_rate_cells_zone_tier_idx";--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD COLUMN "package_type" "carrier_package_type" DEFAULT 'package' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_rate_cells_zone_tier_pkg_idx" ON "carrier_rate_cells" USING btree ("carrier_zone_id","carrier_weight_tier_id","package_type");