ALTER TABLE "shipments" ADD COLUMN "check_packed_by" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "check_packed_at" timestamp;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_check_packed_by_user_id_fk" FOREIGN KEY ("check_packed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "pack_code_seq" START WITH 100000;