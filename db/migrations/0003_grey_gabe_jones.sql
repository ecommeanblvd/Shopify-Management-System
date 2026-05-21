CREATE TYPE "public"."market_apply_status" AS ENUM('preview', 'in_progress', 'success', 'partial_error', 'failed');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('regional', 'international');--> statement-breakpoint
CREATE TABLE "market_apply_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_handle" text,
	"user_id" text,
	"action" text NOT NULL,
	"status" "market_apply_status" NOT NULL,
	"diff" jsonb,
	"pre_snapshot" jsonb,
	"post_snapshot" jsonb,
	"error_detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_store_overrides" (
	"store_id" uuid NOT NULL,
	"market_handle" text NOT NULL,
	"price_adjustment" jsonb,
	"shipping" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_templates" (
	"handle" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "market_type" NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_currency" text NOT NULL,
	"alternative_currencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_language" text NOT NULL,
	"alternative_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_apply_history" ADD CONSTRAINT "market_apply_history_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_apply_history" ADD CONSTRAINT "market_apply_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_store_overrides" ADD CONSTRAINT "market_store_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_store_overrides" ADD CONSTRAINT "market_store_overrides_market_handle_market_templates_handle_fk" FOREIGN KEY ("market_handle") REFERENCES "public"."market_templates"("handle") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_store_overrides" ADD CONSTRAINT "market_store_overrides_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_templates" ADD CONSTRAINT "market_templates_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_apply_history_store_created_idx" ON "market_apply_history" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_store_overrides_store_handle_idx" ON "market_store_overrides" USING btree ("store_id","market_handle");