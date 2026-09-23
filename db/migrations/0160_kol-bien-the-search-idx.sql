-- Picker "Mã hàng" khi tạo đơn KOL (modal, spec 2026-09-23 rebuild): tìm theo SKU hoặc
-- tên sản phẩm trên shopify_variants (120.817 dòng, đo 23/09/2026) bằng ILIKE '%...%'.
-- Không tiền tố cố định (khớp giữa chuỗi) nên B-Tree sẵn có (shopify_variants_sku_idx,
-- shopify_variants_product_idx) không dùng được — đo seq scan: 1,6 s/lượt gõ. GIN
-- trigram (cùng kỹ thuật đã dùng cho shopify_orders ở 0130) đưa lượt tra bình thường
-- xuống dưới 5ms; pg_trgm đã bật sẵn từ 0130 nên không cần CREATE EXTENSION lại.
CREATE INDEX IF NOT EXISTS shopify_variants_sku_trgm_idx ON shopify_variants USING gin (sku gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_variants_product_title_trgm_idx ON shopify_variants USING gin (product_title gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_variants_variant_title_trgm_idx ON shopify_variants USING gin (variant_title gin_trgm_ops);
