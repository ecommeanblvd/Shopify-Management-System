ALTER TABLE "carrier_remote_postcodes" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "carrier_surcharges" ADD COLUMN "tier" text;

-- Backfill tier from existing FedEx ODA source labels --
UPDATE "carrier_remote_postcodes" SET tier = substring(source from 'Tier [A-Z]') WHERE source LIKE '%Tier %';
