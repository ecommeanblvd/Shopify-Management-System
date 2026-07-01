-- Sub-project C: phát hiện đơn Shopify bị chỉnh sửa (địa chỉ / line items).
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "updated_at_shopify" timestamp;
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "content_fingerprint" text;
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "edited_at" timestamp;
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "edited_after_fulfilled_at" timestamp;
