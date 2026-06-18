CREATE TABLE IF NOT EXISTS "manual_pricing_state" (
	"carrier_account_id" uuid PRIMARY KEY NOT NULL,
	"fuel_band_mid" numeric(6, 2) NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
 ALTER TABLE "manual_pricing_state" ADD CONSTRAINT "manual_pricing_state_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
