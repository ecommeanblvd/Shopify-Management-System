CREATE TYPE "public"."apply_status" AS ENUM('preview', 'in_progress', 'success', 'partial', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status_enum" AS ENUM('pending', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."setting_domain" AS ENUM('shipping', 'checkout_buyer_experience');--> statement-breakpoint
CREATE TABLE "apply_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"domain" "setting_domain" NOT NULL,
	"target_store_ids" uuid[] NOT NULL,
	"status" "apply_status" DEFAULT 'preview' NOT NULL,
	"started_by" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "reconciliation_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"domain" "setting_domain" NOT NULL,
	"status" "reconciliation_status_enum" DEFAULT 'pending' NOT NULL,
	"reconciled_at" timestamp,
	"reconciled_by" text
);
--> statement-breakpoint
CREATE TABLE "setting_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"domain" "setting_domain" NOT NULL,
	"path" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" "setting_domain" NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings_snapshots" ADD COLUMN "apply_run_id" uuid;--> statement-breakpoint
ALTER TABLE "apply_runs" ADD CONSTRAINT "apply_runs_template_id_setting_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."setting_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_runs" ADD CONSTRAINT "apply_runs_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_status" ADD CONSTRAINT "reconciliation_status_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_status" ADD CONSTRAINT "reconciliation_status_reconciled_by_user_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_overrides" ADD CONSTRAINT "setting_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_overrides" ADD CONSTRAINT "setting_overrides_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_templates" ADD CONSTRAINT "setting_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_status_store_domain_idx" ON "reconciliation_status" USING btree ("store_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_overrides_store_domain_path_idx" ON "setting_overrides" USING btree ("store_id","domain","path");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_templates_domain_version_idx" ON "setting_templates" USING btree ("domain","version");