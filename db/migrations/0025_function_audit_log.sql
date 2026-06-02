CREATE TABLE "function_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"function_key" text NOT NULL,
	"store_id" uuid,
	"action" text NOT NULL,
	"actor_user_id" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "function_audit_log" ADD CONSTRAINT "function_audit_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_audit_log" ADD CONSTRAINT "function_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "function_audit_function_idx" ON "function_audit_log" USING btree ("function_key","created_at");--> statement-breakpoint
CREATE INDEX "function_audit_store_idx" ON "function_audit_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "function_audit_actor_idx" ON "function_audit_log" USING btree ("actor_user_id","created_at");