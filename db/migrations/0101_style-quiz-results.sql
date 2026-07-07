CREATE TABLE IF NOT EXISTS "style_quiz_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"customer_id" text,
	"session_key" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profile" jsonb,
	"level_reached" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "style_quiz_results" ADD CONSTRAINT "style_quiz_results_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "style_quiz_results_store_customer_idx" ON "style_quiz_results" ("store_id","customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "style_quiz_results_session_idx" ON "style_quiz_results" ("session_key");
