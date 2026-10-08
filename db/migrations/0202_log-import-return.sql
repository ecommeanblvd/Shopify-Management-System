-- Bản sao bảng Lark `LOG - Import` (đồ khách trả về) + chỗ ghim chiếc hàng nhận cho dòng nào.
-- CEO 08/10/2026: "2 chỗ sẽ cần em cho phép nhập hàng trong danh sách đó lại … Danh sách đồ
-- return về".
--
-- CHỈ ĐỌC từ Lark, như `lark_po_dong`. Ô tìm của màn Nhận hàng chạy theo từng phím gõ nên phải
-- soi bản sao, không gọi Lark từng lượt.
--
-- Vì sao không mirror cột tên sản phẩm: bảng Lark KHÔNG CÓ cột nào mang tên hàng (đã dò đủ 48
-- cột). Tên tra từ `shopify_order_lines` theo đơn + SKU lúc hiện ra — được 413/637 dòng; số còn
-- lại hiện SKU.
CREATE TABLE IF NOT EXISTS lark_log_import (
  record_id          text PRIMARY KEY,
  -- `Order number` và `SKU` trên Lark là cột LOOKUP, tự suy từ liên kết `Select order number`.
  -- Giữ nguyên dấu `#` như Lark trả về: bốn cột lookup `WH -` khớp theo đúng chuỗi này.
  order_number       text,
  sku                text,
  request_id         text,
  -- Trạng thái DUYỆT HOÀN TIỀN của CX. KHÔNG phải cửa kho: trong 244 dòng kho đã nhận có 135
  -- `Refunded` và cả 1 `Rejected` — hàng bị từ chối hoàn tiền vẫn về kho thật (đo 08/10).
  return_status      text,
  -- Trạng thái ĐƯỜNG VỀ của LOG. Đây là cửa kho (CEO chốt 08/10/2026).
  log_status         text,
  return_category    text,
  so_luong           integer NOT NULL DEFAULT 1,
  -- Cột lookup `WH - Tiếp nhận & QC` trên Lark: có giá trị = đã có dòng WH - Inventory khớp.
  -- Dấu "đã nhận" của ĐỘI KHO nhập tay; cộng với số chiếc SMS đã nhận mới ra tổng đã nhận.
  wh_tiep_nhan_qc    text,
  -- Tên không dấu + thường hoá, dựng lúc đồng bộ để ô tìm khớp không dấu.
  tim_kiem           text,
  cap_nhat_luc       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lark_log_import_don_sku_idx ON lark_log_import (order_number, sku);
CREATE INDEX IF NOT EXISTS lark_log_import_log_status_idx ON lark_log_import (log_status);

-- Chiếc hàng nhận cho MỘT dòng đồ return. KHÔNG dùng `order_id`: đơn gốc đã giao xong rồi, gắn
-- vào đó là chiếc return bị tính vào "đã nhận" của đơn và món biến mất khỏi ô tìm hàng đi đơn.
ALTER TABLE goods_receipt_items
  ADD COLUMN IF NOT EXISTS return_record_id text;

CREATE INDEX IF NOT EXISTS goods_receipt_items_return_idx
  ON goods_receipt_items (return_record_id);
