CREATE TABLE "carrier_rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD CONSTRAINT "carrier_rate_cards_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD CONSTRAINT "carrier_rate_cards_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_rate_cards_account_idx" ON "carrier_rate_cards" USING btree ("carrier_account_id");--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD COLUMN "rate_card_id" uuid;--> statement-breakpoint
INSERT INTO "carrier_rate_cards" ("carrier_account_id", "label", "effective_from", "effective_to")
SELECT DISTINCT z."carrier_account_id", 'Current (migrated)', DATE '2020-01-01', NULL::date
FROM "carrier_zones" z
JOIN "carrier_rate_cells" c ON c."carrier_zone_id" = z."id";--> statement-breakpoint
UPDATE "carrier_rate_cells" c
SET "rate_card_id" = rc."id"
FROM "carrier_zones" z, "carrier_rate_cards" rc
WHERE c."carrier_zone_id" = z."id" AND rc."carrier_account_id" = z."carrier_account_id";--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ALTER COLUMN "rate_card_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD CONSTRAINT "carrier_rate_cells_rate_card_id_carrier_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."carrier_rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "carrier_rate_cells_zone_tier_pkg_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_rate_cells_card_zone_tier_pkg_idx" ON "carrier_rate_cells" USING btree ("rate_card_id","carrier_zone_id","carrier_weight_tier_id","package_type");