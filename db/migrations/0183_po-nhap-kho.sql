-- Bản sao bảng PO trên Lark để màn Nhận hàng tìm được hàng đặt PO (CEO 29/09/2026).
--
-- Vì sao cần bản sao: ô tìm của màn Nhận hàng chạy theo từng phím gõ. Gọi Lark
-- mỗi lượt vừa chậm vừa đụng trần API, nên soi bản sao như đã làm với bảng kho
-- (`lark_wh_inventory`). Lượt đồng bộ chạy lồng trong `sync-lark` mỗi giờ.
--
-- Đo 29/09: 1.240 dòng, 1.128 dòng đã tick "Báo đơn", 71 đơn PO — trong đó 45
-- đơn đã nhập đủ (phải chặn) và 26 đơn còn thiếu 284 chiếc.
CREATE TABLE IF NOT EXISTS lark_po_dong (
  record_id        text PRIMARY KEY,
  dinh_danh        text,
  order_number     text,
  ngay_dat         date,
  -- Chỉ dòng đã tick mới được nhập (CEO 29/09). Giữ cả dòng chưa tick để biết
  -- Ops bỏ tick lúc nào, và để lượt đồng bộ sau tự sửa lại nếu tick trở lại.
  bao_don          boolean NOT NULL DEFAULT false,
  vendor           text,
  lineitem_name    text,
  sku              text,
  so_luong         integer NOT NULL DEFAULT 1,
  don_gia          numeric(16, 2),
  parent_items     text,
  source_id        text,
  cap_nhat_luc     timestamp NOT NULL DEFAULT now()
);

-- Tra theo đơn + SKU là đường đi chính: đếm đã nhận và chặn PO đã đủ.
CREATE INDEX IF NOT EXISTS lark_po_dong_don_sku_idx ON lark_po_dong (order_number, sku);
-- Ô tìm lọc `bao_don` trước tiên nên lọc sẵn ở chỉ mục.
CREATE INDEX IF NOT EXISTS lark_po_dong_bao_don_idx ON lark_po_dong (bao_don) WHERE bao_don;

-- Cột tìm dựng sẵn KHÔNG DẤU + thường hoá, giống `shopify_variants.tim_kiem`:
-- Postgres không có unaccent mặc định nên bỏ dấu ở tầng ứng dụng lúc đồng bộ.
ALTER TABLE lark_po_dong ADD COLUMN IF NOT EXISTS tim_kiem text;
CREATE INDEX IF NOT EXISTS lark_po_dong_tim_kiem_idx ON lark_po_dong (tim_kiem);

-- Chiếc nhận từ hàng đặt PO không thuộc đơn Shopify nào (`order_id` để NULL).
-- Giữ mã PO + record_id dòng PO để đếm "đã nhận" và truy ngược về dòng Lark.
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS po_order_number text;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS po_record_id text;
CREATE INDEX IF NOT EXISTS goods_receipt_items_po_idx
  ON goods_receipt_items (po_order_number, sku) WHERE po_order_number IS NOT NULL;
