CREATE TABLE IF NOT EXISTS "mmp_line_received" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_number" text NOT NULL,
  "sku" text NOT NULL,
  "received_at" timestamp NOT NULL,
  "vendor" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mmp_line_received_order_sku_idx" ON "mmp_line_received" ("order_number","sku");
CREATE INDEX IF NOT EXISTS "mmp_line_received_order_idx" ON "mmp_line_received" ("order_number");
