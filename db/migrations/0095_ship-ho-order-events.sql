CREATE TYPE "ship_ho_event_status" AS ENUM('pending', 'delivered', 'failed');

CREATE TABLE "ship_ho_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"mmp_ref" text NOT NULL,
	"code" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"delivery_status" "ship_ho_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "ship_ho_order_events" ADD CONSTRAINT "ship_ho_order_events_order_id_ship_ho_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ship_ho_orders"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "ship_ho_order_events_delivery_idx" ON "ship_ho_order_events" ("delivery_status");
CREATE INDEX "ship_ho_order_events_order_idx" ON "ship_ho_order_events" ("order_id");
