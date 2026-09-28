-- Module Incident Management (CEO duyệt 28/09) — xem docs/superpowers/specs/2026-09-28-su-co-design.md
--
-- Bảng Lark gốc dùng 8 CỘT TIỀN cố định + một cột multi-select khai loại, tức hai
-- chỗ ghi một sự thật. Đo 156 bản ghi thì cả hai chiều đều lệch: ~30 lời khai
-- không có số tiền, và 10 ca có số tiền mà không khai loại. Cộng tiền theo bộ phận
-- còn ra 46.791 trong khi tổng thật 42.601, vì ca hai bộ phận bị tính cho cả hai.
--
-- Nên tiền sống ở BẢNG CON `su_co_chi_phi`: mỗi dòng = một loại + một số tiền +
-- một đơn vị tiền + một bộ phận. Ba lỗi trên thành KHÔNG THỂ xảy ra.

CREATE TABLE IF NOT EXISTS su_co (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_su_co text NOT NULL UNIQUE,
  ngay_bao date NOT NULL,
  nguyen_nhan text NOT NULL,
  giai_doan text,
  -- NOT NULL có mặc định: Lark để trống `Status` ở 58/156 dòng (37%), không ai
  -- biết hồ sơ nào còn sống. Trống được map về 'mo' chứ không phải 'xong' — coi
  -- trống là xong là âm thầm đóng 37% hồ sơ chưa ai xử lý.
  trang_thai text NOT NULL DEFAULT 'mo',
  mo_ta text,
  -- Bộ phận chịu CHÍNH. Dòng chi phí không tự khai bộ phận thì thừa hưởng cột này.
  bo_phan_chinh text,
  -- Mã giảm giá đã cấp cho khách. KHÔNG phải một loại chi phí: 87 ca Lark khai
  -- "Discount Code" nhưng đó là một MÃ, không phải số tiền.
  ma_giam_gia text,
  ma_ticket_cs text,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  order_id uuid REFERENCES shopify_orders(id) ON DELETE SET NULL,
  -- Giữ chuỗi mã đơn kể cả khi chưa nối được.
  ma_don text,
  -- Ảnh bằng chứng trên S3, cùng cách customer_order_requests.photo_keys.
  anh_keys text[] NOT NULL DEFAULT '{}',
  -- Ca nhập từ Lark mà dữ liệu gốc không đủ để suy (18 ca vừa nhiều bộ phận vừa
  -- nhiều loại chi phí) — đánh dấu để CX rà lại, thay vì bịa một cách quy trách nhiệm.
  can_xem_lai boolean NOT NULL DEFAULT false,
  lark_record_id text UNIQUE,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  dong_luc timestamp
);
CREATE INDEX IF NOT EXISTS su_co_trang_thai_idx ON su_co(trang_thai);
CREATE INDEX IF NOT EXISTS su_co_nguyen_nhan_idx ON su_co(nguyen_nhan);
CREATE INDEX IF NOT EXISTS su_co_bo_phan_idx ON su_co(bo_phan_chinh);
CREATE INDEX IF NOT EXISTS su_co_ngay_idx ON su_co(ngay_bao DESC);

-- Chỗ TIỀN sống. `so_tien` và `tien_te` đều NOT NULL: số tiền không có đơn vị sẽ
-- bị loại khỏi mọi bảng tổng (xem features/dispute/tong-tien.ts) nên thà chặn ngay.
CREATE TABLE IF NOT EXISTS su_co_chi_phi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  su_co_id uuid NOT NULL REFERENCES su_co(id) ON DELETE CASCADE,
  loai text NOT NULL,
  so_tien numeric(14,2) NOT NULL,
  tien_te text NOT NULL,
  -- Trống = thừa hưởng bo_phan_chinh của sự cố. Cho phép ghi đúng ca "hoàn $500
  -- do Procurement, phí gửi lại $50 do Warehouse" mà tổng vẫn không trùng.
  bo_phan text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS su_co_chi_phi_su_co_idx ON su_co_chi_phi(su_co_id);
CREATE INDEX IF NOT EXISTS su_co_chi_phi_loai_idx ON su_co_chi_phi(loai);

CREATE TABLE IF NOT EXISTS su_co_ghi_chu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  su_co_id uuid NOT NULL REFERENCES su_co(id) ON DELETE CASCADE,
  noi_dung text NOT NULL,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  tu_lark boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS su_co_ghi_chu_idx ON su_co_ghi_chu(su_co_id, created_at);
