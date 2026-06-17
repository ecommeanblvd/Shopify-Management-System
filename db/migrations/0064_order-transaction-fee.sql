ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee" numeric(14, 2);
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee_native" numeric(14, 2);
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee_native_currency" text;
