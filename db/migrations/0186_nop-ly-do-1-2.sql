-- CEO 30/09/2026 — luồng NỘP / KHOÁ / DUYỆT cho tiêu chí 1.2.
--
-- Trước nay người làm chọn lý do xong là số vào thẳng KPI, không ai xác nhận và không có mốc nào
-- nói "đã xong". Nay gửi theo KỲ, khoá toàn bộ ô chọn của kỳ, quản lý duyệt cả kỳ hoặc TRẢ LẠI
-- riêng từng dòng kèm ghi chú; chỉ dòng bị trả mới mở khoá để sửa.
--
-- Duyệt ở đây CHỈ chốt "lý do đã đúng chưa". Việc lý do đó có rút kiện khỏi KPI hay không vẫn do
-- bằng chứng quét của hãng quyết (ly_do_doi_chieu) — hai tầng tách bạch, xem nop-1-2.ts.

CREATE TABLE IF NOT EXISTS kpi_12_nop (
  ky           text PRIMARY KEY,
  trang_thai   text NOT NULL DEFAULT 'dang_lam',
  nop_boi      text REFERENCES "user"(id) ON DELETE SET NULL,
  nop_at       timestamp,
  duyet_boi    text REFERENCES "user"(id) ON DELETE SET NULL,
  duyet_at     timestamp,
  ghi_chu      text,
  updated_at   timestamp NOT NULL DEFAULT now()
);

-- Dòng bị quản lý trả lại để sửa. NULL = không bị trả.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS ly_do_tra_lai text,
  ADD COLUMN IF NOT EXISTS ly_do_tra_lai_at timestamp;

ALTER TABLE ship_ho_orders
  ADD COLUMN IF NOT EXISTS ly_do_tra_lai text,
  ADD COLUMN IF NOT EXISTS ly_do_tra_lai_at timestamp;
