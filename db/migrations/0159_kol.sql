-- Luồng đơn KOL & chụp đồ (spec 2026-09-23). Bảng độc lập, KHÔNG dính shopify_orders.
CREATE TYPE kol_muc_dich AS ENUM ('kol', 'chup_do', 'khac');
CREATE TYPE kol_don_trang_thai AS ENUM ('nhap', 'da_chot', 'da_gui', 'huy');
CREATE TYPE kol_hinh_thuc AS ENUM ('tang', 'muon');

CREATE SEQUENCE IF NOT EXISTS kol_don_seq START 1;

CREATE TABLE IF NOT EXISTS kol_nguoi_nhan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ten text NOT NULL,
  kenh text,
  dien_thoai text,
  email text,
  quoc_gia text NOT NULL DEFAULT 'VN',
  dia_chi text,
  thanh_pho text,
  ghi_chu text,
  ngung_dung boolean NOT NULL DEFAULT false,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text,
  sua_luc timestamp NOT NULL DEFAULT now(),
  sua_boi text
);
CREATE INDEX IF NOT EXISTS kol_nguoi_nhan_ten_idx ON kol_nguoi_nhan (ten);

CREATE TABLE IF NOT EXISTS kol_don (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ma text NOT NULL UNIQUE,
  nguoi_nhan_id uuid NOT NULL REFERENCES kol_nguoi_nhan(id),
  muc_dich kol_muc_dich NOT NULL,
  trang_thai kol_don_trang_thai NOT NULL DEFAULT 'nhap',
  ten_nhan text NOT NULL,
  dien_thoai_nhan text,
  quoc_gia text NOT NULL DEFAULT 'VN',
  thanh_pho text,
  dia_chi text,
  hang_van_chuyen text,
  ma_van_don text,
  gui_luc timestamp,
  da_nhan_luc timestamp,
  ghi_chu text,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text,
  sua_luc timestamp NOT NULL DEFAULT now(),
  sua_boi text
);
CREATE INDEX IF NOT EXISTS kol_don_trang_thai_idx ON kol_don (trang_thai, tao_luc);
CREATE INDEX IF NOT EXISTS kol_don_nguoi_nhan_idx ON kol_don (nguoi_nhan_id);

CREATE TABLE IF NOT EXISTS kol_dong_don (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  don_id uuid NOT NULL REFERENCES kol_don(id) ON DELETE CASCADE,
  sku text NOT NULL,
  ten_hang text,
  kho text NOT NULL,
  so_luong integer NOT NULL CHECK (so_luong > 0),
  hinh_thuc kol_hinh_thuc NOT NULL,
  han_tra date,
  gia_von numeric(14,4),
  gia_von_tien_te text,
  gia_von_nguon text,
  so_luong_da_tra integer NOT NULL DEFAULT 0,
  so_luong_nhap_lai integer NOT NULL DEFAULT 0,
  CONSTRAINT kol_dong_don_tra_khong_vuot CHECK (so_luong_da_tra <= so_luong),
  CONSTRAINT kol_dong_don_nhap_lai_khong_vuot CHECK (so_luong_nhap_lai <= so_luong_da_tra)
);
CREATE INDEX IF NOT EXISTS kol_dong_don_don_idx ON kol_dong_don (don_id);
CREATE INDEX IF NOT EXISTS kol_dong_don_muon_idx ON kol_dong_don (hinh_thuc, han_tra);

CREATE TABLE IF NOT EXISTS kol_tra_ve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dong_don_id uuid NOT NULL REFERENCES kol_dong_don(id) ON DELETE CASCADE,
  so_luong integer NOT NULL CHECK (so_luong > 0),
  nhap_lai_kho boolean NOT NULL,
  ly_do_khong_nhap text,
  tra_luc timestamp NOT NULL DEFAULT now(),
  ghi_chu text,
  tao_boi text NOT NULL
);
CREATE INDEX IF NOT EXISTS kol_tra_ve_dong_idx ON kol_tra_ve (dong_don_id);

-- Lọc movement theo bản ghi tham chiếu: hiện chỉ có index theo warehouse_inventory_id
-- và theo reason, nên báo cáo "hàng đã xuất cho KOL" sẽ quét toàn bảng nếu thiếu cái này.
CREATE INDEX IF NOT EXISTS inventory_movements_ref_idx ON inventory_movements (ref_type, ref_id);
