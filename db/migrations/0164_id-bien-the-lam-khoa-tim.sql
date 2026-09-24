-- ID biến thể Shopify trở thành thứ TÌM ĐƯỢC và GHIM ĐƯỢC, không chỉ SKU.
--
-- CEO 24/09: "SKU của brand thay đổi khá nhiều" nên hệ thống chuyển dần sang
-- dùng ID sản phẩm làm mã vạch để tìm và định danh. Dữ liệu ủng hộ: 120.817
-- biến thể có ĐÚNG 120.817 `shopify_variant_id` khác nhau và KHÔNG dòng nào
-- thiếu — SKU thì vừa trùng vừa đổi theo brand.
--
-- 1) Cột tìm kiếm nạp thêm PHẦN SỐ của variant id và product id. Tem `V:` in ra
--    số trần nên gõ tay hay quét đều rơi vào cùng một chuỗi. Cột sinh không
--    ALTER tại chỗ được → bỏ rồi dựng lại (index rơi theo cột, dựng lại luôn).
ALTER TABLE shopify_variants DROP COLUMN tim_kiem;

ALTER TABLE shopify_variants
  ADD COLUMN tim_kiem text GENERATED ALWAYS AS (
    translate(
      lower(
        coalesce(sku,'') || ' ' ||
        coalesce(product_title,'') || ' ' ||
        coalesce(variant_title,'') || ' ' ||
        coalesce(regexp_replace(shopify_variant_id, '[^0-9]', '', 'g'), '') || ' ' ||
        coalesce(regexp_replace(shopify_product_id, '[^0-9]', '', 'g'), '')
      ),
      'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ',
      'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'
    )
  ) STORED;

CREATE INDEX shopify_variants_tim_kiem_trgm_idx
  ON shopify_variants USING gin (tim_kiem gin_trgm_ops);

-- 2) Dòng đơn KOL ghim thêm ID biến thể. SKU vẫn giữ vì tồn kho khoá theo SKU,
--    nhưng ID mới là thứ không đổi khi brand đánh lại mã. Để NULL được: dòng
--    tạo trước khi có cột này, và SKU không tra ngược ra biến thể nào.
ALTER TABLE kol_dong_don ADD COLUMN shopify_variant_id text;

CREATE INDEX kol_dong_don_variant_idx ON kol_dong_don (shopify_variant_id);
