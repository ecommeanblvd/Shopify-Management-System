ALTER TABLE "carrier_accounts" ADD COLUMN "suspended_at" timestamp;
--> statement-breakpoint
ALTER TABLE "carrier_accounts" ADD COLUMN "suspend_reason" text;
