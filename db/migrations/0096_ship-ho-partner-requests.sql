CREATE TYPE "ship_ho_partner_request_status" AS ENUM('pending', 'approved', 'rejected');

CREATE TABLE "ship_ho_partner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_slug" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"status" "ship_ho_partner_request_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"callback_sent_at" timestamp,
	"callback_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "ship_ho_partner_requests_status_idx" ON "ship_ho_partner_requests" ("status");
CREATE INDEX "ship_ho_partner_requests_brand_idx" ON "ship_ho_partner_requests" ("brand_slug");
