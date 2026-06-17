CREATE TABLE IF NOT EXISTS "manual_shipping_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_handle" text NOT NULL,
	"shipping" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manual_shipping_config_market_handle_unique" UNIQUE("market_handle")
);
