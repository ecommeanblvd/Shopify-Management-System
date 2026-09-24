-- Cột tìm kiếm CHUẨN HOÁ cho biến thể: gộp sku + tên sản phẩm + tên biến thể,
-- hạ chữ thường và BỎ DẤU tiếng Việt (đ→d), lưu sẵn + index trigram.
--
-- Vì sao phải lưu sẵn chứ không bỏ dấu lúc chạy: bảng có 120.528 biến thể. Đo
-- thật 24/09 — `translate()` ngay trong WHERE buộc quét toàn bảng, mất 4.322ms
-- một lượt gõ. Ô tìm sản phẩm trong modal tạo đơn KOL gọi theo từng phím nên
-- con số đó là không dùng được. Cột sinh sẵn + GIN trigram đưa việc đó về index.
--
-- Biểu thức phải IMMUTABLE mới sinh cột được: lower/translate/coalesce/|| đều đạt.
ALTER TABLE shopify_variants
  ADD COLUMN tim_kiem text GENERATED ALWAYS AS (
    translate(
      lower(coalesce(sku,'') || ' ' || coalesce(product_title,'') || ' ' || coalesce(variant_title,'')),
      'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ',
      'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'
    )
  ) STORED;

CREATE INDEX shopify_variants_tim_kiem_trgm_idx
  ON shopify_variants USING gin (tim_kiem gin_trgm_ops);
