-- Màn "Đóng hàng" (spec 22/09/2026): kiện đóng xong về SMS tức thì từ Lark.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sku_text text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pieces integer;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lark_hop text;
-- Dòng Lark đã đóng xong nhưng SMS chưa khớp được đơn — hiện đỏ trên màn Đóng hàng, xoá khi khớp.
CREATE TABLE IF NOT EXISTS lark_pack_cho_khop (
  record_id text PRIMARY KEY,
  log_unique_code text,
  order_number text,
  weight_kg numeric(10,3),
  dims text,
  hop text,
  sku_text text,
  pieces integer,
  ly_do text NOT NULL,
  nhan_luc timestamp NOT NULL DEFAULT now()
);
