ALTER TABLE "ship_ho_partners" ADD COLUMN "self_service_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "ship_ho_orders" ADD COLUMN "source" text NOT NULL DEFAULT 'internal';
ALTER TABLE "ship_ho_orders" ADD COLUMN "mmp_ref" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "service" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "mmp_order_seq" bigint;

CREATE UNIQUE INDEX "ship_ho_orders_mmp_ref_unique" ON "ship_ho_orders" ("mmp_ref") WHERE "mmp_ref" IS NOT NULL;
CREATE SEQUENCE IF NOT EXISTS "ship_ho_mmp_order_seq" START 1000;
