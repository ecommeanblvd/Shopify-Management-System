-- ID biến thể Shopify của ĐÚNG chiếc hàng này, ghim lúc nhận.
--
-- CEO 24/09: cần thấy "ID của đúng variant sản phẩm này trong order này", và
-- hệ thống đang chuyển sang định danh bằng ID thay SKU (D-106).
--
-- Vì sao ghim chứ không tra mỗi lần hiển thị: SKU của brand đổi liên tục, còn
-- `shopify_variants` chỉ chứa MỘT store nên tra theo SKU trượt hẳn hàng của
-- store khác (đo 24/09: chiếc Mirer không tra ra, tỉ lệ chung 977/1082 = 90%).
ALTER TABLE goods_receipt_items ADD COLUMN shopify_variant_id text;

CREATE INDEX goods_receipt_items_variant_idx ON goods_receipt_items (shopify_variant_id);
