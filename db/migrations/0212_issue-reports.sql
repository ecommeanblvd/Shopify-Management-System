-- Báo lỗi (Issue Report) từ từng module: người dùng bấm nút ở header, hệ thống ghi lại
-- module + trang + mô tả; một tác vụ định kỳ đọc, sửa, rồi ghi trạng thái xử lý ngược lại
-- vào chính dòng này để admin đọc ở /admin/issues.
--
-- ⚠ TỆP NÀY ÁP TAY (xem db/migrations/README.md). Áp xong phải kiểm `information_schema`
-- rằng bảng và chỉ mục có thật TRƯỚC khi deploy mã đọc nó.
-- Thuần cộng thêm: không đụng bảng hay dữ liệu đang có.

CREATE TABLE IF NOT EXISTS issue_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Số thứ tự đọc được ("BL-12") để người ta nhắc nhau, thay vì đọc uuid.
  so            serial NOT NULL,
  module        text NOT NULL,
  page_path     text NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL,
  -- 'thap' | 'trung_binh' | 'cao' | 'chan_cong_viec'
  muc_do        text NOT NULL DEFAULT 'trung_binh',
  -- 'moi' | 'dang_xu_ly' | 'cho_duyet' | 'da_xong' | 'can_nguoi' | 'tu_choi'
  trang_thai    text NOT NULL DEFAULT 'moi',
  reporter_id   text REFERENCES "user"(id) ON DELETE SET NULL,
  reporter_email text,
  user_agent    text,
  -- Phần bot ghi ngược: đã làm gì, link PR, lý do cần người.
  ghi_chu_xu_ly text,
  pr_url        text,
  xu_ly_lan_cuoi timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_reports_so_idx ON issue_reports (so);
CREATE INDEX IF NOT EXISTS issue_reports_trang_thai_idx ON issue_reports (trang_thai, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_module_idx ON issue_reports (module, created_at DESC);
