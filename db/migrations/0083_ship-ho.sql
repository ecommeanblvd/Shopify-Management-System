CREATE TYPE "ship_ho_billing_cycle" AS ENUM('weekly', 'monthly');
CREATE TYPE "ship_ho_partner_status" AS ENUM('active', 'inactive');
CREATE TYPE "ship_ho_order_status" AS ENUM('draft', 'quoted', 'shipped', 'delivered', 'billed', 'settled');
CREATE TYPE "ship_ho_statement_status" AS ENUM('draft', 'issued', 'paid');

CREATE TABLE "ship_ho_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_slug" text NOT NULL,
	"markup_percent" numeric(8, 4) DEFAULT '0' NOT NULL,
	"billing_cycle" "ship_ho_billing_cycle" DEFAULT 'monthly' NOT NULL,
	"billing_currency" text DEFAULT 'VND' NOT NULL,
	"status" "ship_ho_partner_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ship_ho_partners_brand_slug_unique" UNIQUE("brand_slug")
);

CREATE TABLE "ship_ho_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_brand_slug" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"total_charged_vnd" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" "ship_ho_statement_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"file_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ship_ho_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"partner_brand_slug" text NOT NULL,
	"recipient_name" text,
	"recipient_company" text,
	"recipient_phone" text,
	"country" text NOT NULL,
	"city" text,
	"province" text,
	"postcode" text,
	"address1" text,
	"address2" text,
	"weight_kg" numeric(10, 3) NOT NULL,
	"dim_length_cm" numeric(10, 2),
	"dim_width_cm" numeric(10, 2),
	"dim_height_cm" numeric(10, 2),
	"packaging_type" text,
	"carrier_key" text,
	"carrier_account_id" uuid,
	"carrier_cost_vnd" numeric(16, 2),
	"markup_percent" numeric(8, 4),
	"charged_vnd" numeric(16, 2),
	"quote_breakdown" jsonb,
	"quoted_at" timestamp,
	"tracking_number" text,
	"delivery_status" text,
	"delivered_at" timestamp,
	"last_tracked_at" timestamp,
	"actual_carrier_cost_vnd" numeric(16, 2),
	"reconcile_status" text,
	"delta_vnd" numeric(16, 2),
	"margin_vnd" numeric(16, 2),
	"statement_id" uuid,
	"status" "ship_ho_order_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

ALTER TABLE "ship_ho_partners" ADD CONSTRAINT "ship_ho_partners_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_statements" ADD CONSTRAINT "ship_ho_statements_partner_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("partner_brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_partner_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("partner_brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_statement_id_ship_ho_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."ship_ho_statements"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "ship_ho_orders_partner_idx" ON "ship_ho_orders" ("partner_brand_slug");
CREATE INDEX "ship_ho_orders_status_idx" ON "ship_ho_orders" ("status");
