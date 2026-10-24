CREATE TYPE "public"."customer_return_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "customer_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"shopify_line_id" text NOT NULL,
	"sku" text,
	"product_title" text,
	"variant_title" text,
	"returned_qty" integer NOT NULL,
	"pass_qty" integer DEFAULT 0 NOT NULL,
	"fail_qty" integer DEFAULT 0 NOT NULL,
	"fail_reason" text,
	"restocked_qty" integer DEFAULT 0 NOT NULL,
	"warehouse_inventory_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_return_lines_returned_qty_pos" CHECK ("customer_return_lines"."returned_qty" > 0),
	CONSTRAINT "customer_return_lines_pass_qty_nonneg" CHECK ("customer_return_lines"."pass_qty" >= 0),
	CONSTRAINT "customer_return_lines_fail_qty_nonneg" CHECK ("customer_return_lines"."fail_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_code" text DEFAULT 'HN' NOT NULL,
	"status" "customer_return_status" DEFAULT 'open' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"received_by" text,
	"qc_done_at" timestamp,
	"qc_done_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_returns_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_return_id_customer_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."customer_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_warehouse_inventory_id_warehouse_inventory_id_fk" FOREIGN KEY ("warehouse_inventory_id") REFERENCES "public"."warehouse_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_qc_done_by_user_id_fk" FOREIGN KEY ("qc_done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_return_lines_return_idx" ON "customer_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "customer_returns_order_idx" ON "customer_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "customer_returns_status_idx" ON "customer_returns" USING btree ("status");