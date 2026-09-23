-- Mã vạch theo ID Shopify (spec 23/09/2026). Dòng đơn CHƯA lưu mã biến thể nên đang phải suy
-- từ mã hàng: nối món Lark sang dòng đơn chỉ được 6.253/7.713 = 81%.
ALTER TABLE shopify_order_lines ADD COLUMN IF NOT EXISTS shopify_variant_id text;
ALTER TABLE shopify_order_lines ADD COLUMN IF NOT EXISTS shopify_product_id text;
CREATE INDEX IF NOT EXISTS shopify_order_lines_variant_idx ON shopify_order_lines (shopify_variant_id);

-- Món Lark nối sang dòng đơn Shopify — tem mang mã dòng đơn nên phải biết dòng nào.
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS shopify_line_id text;
CREATE INDEX IF NOT EXISTS lark_mon_don_line_idx ON lark_mon_don (shopify_line_id);

-- Biết món nào đã dán tem.
ALTER TABLE wh_nhan_kcs ADD COLUMN IF NOT EXISTS tem_in_luc timestamp;
