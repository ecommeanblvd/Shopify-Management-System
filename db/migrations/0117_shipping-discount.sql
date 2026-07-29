-- Số tiền giảm phí ship (promo 50% off shipping) — phục vụ đối soát MMP store riêng.
ALTER TABLE "shopify_orders" ADD COLUMN "shipping_discount" numeric(14,2);
