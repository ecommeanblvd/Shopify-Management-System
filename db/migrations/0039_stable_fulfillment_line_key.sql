-- Drop the FK constraint referencing shopify_order_lines.id
ALTER TABLE "order_fulfillment_lines" DROP CONSTRAINT IF EXISTS "order_fulfillment_lines_order_line_id_shopify_order_lines_id_fk";--> statement-breakpoint
-- Drop the unique constraint on order_line_id
ALTER TABLE "order_fulfillment_lines" DROP CONSTRAINT IF EXISTS "order_fulfillment_lines_order_line_id_unique";--> statement-breakpoint
-- Drop the old volatile column
ALTER TABLE "order_fulfillment_lines" DROP COLUMN IF EXISTS "order_line_id";--> statement-breakpoint
-- Add the stable shopify_line_id column
ALTER TABLE "order_fulfillment_lines" ADD COLUMN "shopify_line_id" text NOT NULL DEFAULT '';--> statement-breakpoint
-- Remove the temporary default now that the column exists (table is empty)
ALTER TABLE "order_fulfillment_lines" ALTER COLUMN "shopify_line_id" DROP DEFAULT;--> statement-breakpoint
-- Add unique index on (fulfillment_id, shopify_line_id) for upsert targeting
CREATE UNIQUE INDEX "order_fulfillment_lines_ful_line_idx" ON "order_fulfillment_lines" USING btree ("fulfillment_id","shopify_line_id");
