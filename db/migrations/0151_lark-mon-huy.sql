-- Món (line item) của đơn theo bảng Lark "WH ngày MEAN nhận hàng", kèm cờ HUỶ.
-- Kiện đã đóng xong vẫn có thể bị huỷ (khách bỏ món, vendor hết hàng, OC cancel) — màn Đóng
-- hàng phải biết để không cho đi hàng (CEO 22/09/2026). Xét TỪNG MÓN: đơn nhiều món có thể
-- chỉ huỷ một món, phần còn lại vẫn đi.
CREATE TABLE IF NOT EXISTS lark_mon_don (
  dinh_danh text PRIMARY KEY,
  order_number text NOT NULL,
  sku text,
  huy boolean NOT NULL DEFAULT false,
  ly_do text,
  cap_nhat_luc timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lark_mon_don_order_idx ON lark_mon_don (order_number);
