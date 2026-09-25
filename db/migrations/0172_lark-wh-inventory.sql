-- Bản sao bảng Lark "WH - Inventory (Nhập, QC, Pack)" (CEO 25/09).
--
-- Trang Sổ nhập trước đây đọc `goods_receipt_items` — tức CHỈ những chiếc do hệ
-- thống này ghi nhận. Bên mình có 836 dòng (833 của luồng cũ, dồn hết vào ngày
-- import 11/06, cộng 3 dòng mới), trong khi Lark có 9.122 dòng trải 437 ngày
-- ngược về 2021: phần lớn do đội kho nhập thẳng trên Lark. Nên trang hiện ra
-- "thiếu ngày" là đúng dữ liệu bên mình, nhưng sai kỳ vọng — nó mang tên đối
-- chiếu thì phải thấy được cả hai bên.
--
-- Cùng cách đã làm với `lark_mon_don`: kéo về một bản sao, trang đọc bản sao
-- cho nhanh, còn nút Đối chiếu vẫn gọi thẳng API để bắt cả trường hợp chính
-- bản sao bị cũ.
CREATE TABLE IF NOT EXISTS lark_wh_inventory (
  record_id       text PRIMARY KEY,
  ngay_import     date,
  dinh_danh       text,
  warehouse       text,
  inventory_type  text,
  order_number    text,
  sku             text,
  lineitem_name   text,
  store_final     text,
  vendor_final    text,
  qc_check        text,
  wh_action       text,
  unique_code     text,
  so_luong        integer,
  co_anh_hang_den boolean NOT NULL DEFAULT false,
  co_bb_ban_giao  boolean NOT NULL DEFAULT false,
  cap_nhat_luc    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lark_wh_inventory_ngay_idx ON lark_wh_inventory (ngay_import DESC);
CREATE INDEX IF NOT EXISTS lark_wh_inventory_kho_idx ON lark_wh_inventory (warehouse, ngay_import DESC);
