-- Màn "Nhận hàng & KCS" (spec 22/09/2026): SMS tạo dòng trên bảng kho Lark, cần record id của
-- MÓN để nối link "Import (select order)", và tên/store/vendor để điền dòng mới.
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS record_id text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS lineitem_name text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS store text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS vendor text;
CREATE INDEX IF NOT EXISTS lark_mon_don_record_idx ON lark_mon_don (record_id);

-- Việc kho nhận + kiểm hàng, ghi ở SMS TRƯỚC rồi mới đẩy Lark (Lark hỏng không làm mất việc).
CREATE TABLE IF NOT EXISTS wh_nhan_kcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mon_dinh_danh text NOT NULL,
  mon_record_id text,
  order_number text NOT NULL,
  sku text,
  so_luong integer NOT NULL,
  can_kg numeric(10,3),
  qc_check text NOT NULL,
  wh_action text NOT NULL,
  ly_do_fail text,
  anh_key text,
  warehouse text NOT NULL,
  nguoi_lam text,
  luc timestamp NOT NULL DEFAULT now(),
  lark_record_id text,
  trang_thai_day text NOT NULL DEFAULT 'cho',
  loi text,
  lan_day_cuoi timestamp
);
CREATE INDEX IF NOT EXISTS wh_nhan_kcs_don_idx ON wh_nhan_kcs (order_number);
CREATE INDEX IF NOT EXISTS wh_nhan_kcs_trang_thai_idx ON wh_nhan_kcs (trang_thai_day);
