ALTER TABLE "ship_ho_partners" ADD COLUMN "strategic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ship_ho_partners" ADD COLUMN "tier_code" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "ship_ho_partners" ADD COLUMN "tier_override_code" text;--> statement-breakpoint
ALTER TABLE "ship_ho_partners" ADD COLUMN "tier_updated_at" timestamp;
