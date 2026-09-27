-- Ba trường CX dùng hằng ngày mà hệ thống chưa có (CEO 27/09, sau khi đối
-- chiếu file CX — xem docs/phan-tich/2026-09-27-doi-chieu-file-cx.md).
--
-- 1. Email + tên khách: đồng bộ đơn trước nay CHỈ lấy `customer { id }`. CX
--    dùng `Customer Email` 100% số dòng.
-- 2. Ghi chú khách trên đơn (Shopify `note`).
-- 3. Số đo may đo: nằm ở thuộc tính của DÒNG đơn, CX dùng 83%.
-- 4. EDD tách hai đầu: trước lưu một chuỗi gộp "6 October - 20 October".
ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS order_note text;

ALTER TABLE shopify_order_lines
  ADD COLUMN IF NOT EXISTS edd_min text,
  ADD COLUMN IF NOT EXISTS edd_max text,
  -- [{nhan, giaTri}] — số đo cơ thể khách nhập lúc đặt, giữ ĐÚNG thứ tự
  -- khách thấy trên web (khoá Shopify mang tiền tố "1--2.").
  ADD COLUMN IF NOT EXISTS so_do jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS shopify_orders_customer_email_idx
  ON shopify_orders (customer_email) WHERE customer_email IS NOT NULL;
