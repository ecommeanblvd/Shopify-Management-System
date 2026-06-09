CREATE TABLE "app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_key_idx" ON "role_permissions" USING btree ("role_id","permission_key");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE no action ON UPDATE no action;