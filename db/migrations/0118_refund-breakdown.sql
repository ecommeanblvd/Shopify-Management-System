-- Breakdown khoản hoàn: hoàn ship riêng + hoàn đồ theo SKU (đối soát MMP).
ALTER TABLE "shopify_order_refunds" ADD COLUMN "shipping_amount" numeric(14,2);
ALTER TABLE "shopify_order_refunds" ADD COLUMN "lines" jsonb;
