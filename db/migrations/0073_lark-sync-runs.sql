CREATE TABLE IF NOT EXISTS "lark_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ran_at" timestamp DEFAULT now() NOT NULL,
  "created" integer DEFAULT 0 NOT NULL,
  "updated" integer DEFAULT 0 NOT NULL,
  "unmatched_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error" text
);
