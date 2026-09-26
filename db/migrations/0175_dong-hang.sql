-- Bước đóng hàng (CEO 26/09) — xem docs/superpowers/specs/2026-09-26-dong-hang-design.md
--
-- `shipments` đã có cân nặng, kích thước, kho xuất. Thiếu ba thứ:
--  * hộp đã dùng — trên Lark là LIÊN KẾT tới một dòng tồn vật tư đóng gói
--    (`Select VTĐG1` trỏ về chính bảng WH-Inventory), nên lưu record_id chứ
--    không lưu chuỗi tên: tên hiển thị của Lark đổi là mình lệch ngay;
--  * dòng `LOG - Export` do hệ thống tạo, để còn gỡ và đối chiếu;
--  * ảnh kiện đã đóng.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS hop_lark_record_id text,
  ADD COLUMN IF NOT EXISTS lark_record_id text;

CREATE TABLE IF NOT EXISTS wh_anh_kien (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  s3_key          text NOT NULL,
  ten_file        text,
  nguoi_tai       text REFERENCES "user"(id) ON DELETE SET NULL,
  lark_file_token text,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wh_anh_kien_shipment_idx ON wh_anh_kien (shipment_id);
