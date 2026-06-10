CREATE TABLE "reconcile_issue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_key" text NOT NULL,
	"carrier_key" text,
	"description" text NOT NULL,
	"order_count" integer NOT NULL,
	"sum_delta_vnd" numeric(16, 2),
	"sample_orders" jsonb,
	"resolution_note" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconcile_issue_reports" ADD CONSTRAINT "reconcile_issue_reports_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconcile_issue_reports_key_idx" ON "reconcile_issue_reports" USING btree ("issue_key");