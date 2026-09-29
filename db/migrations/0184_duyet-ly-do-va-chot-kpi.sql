-- CEO 29/09/2026 — hai việc để chốt được KPI tháng:
--
-- 1) DUYỆT TAY LÝ DO CHẬM ở đúng chỗ máy mù. Hệ thống chỉ đọc được FedEx và UPS; kiện Aramex
--    luôn ra "khong_kiem_duoc" nên lý do thật cũng không bao giờ có hiệu lực (đo T8: 4 kiện).
--    Duyệt chỉ hợp lệ khi máy KHÔNG KIỂM ĐƯỢC — luật nằm ở duyetTayDuoc() trong ly-do-cham.ts.
--    KHÔNG đụng vào ly_do_doi_chieu: phải giữ nguyên máy đã nói gì thì mới đối chất được về sau.
--
-- 2) CHỐT KỲ. KPI trước nay tính lại từ dữ liệu sống mỗi lần mở trang, nên con số một tháng
--    vẫn trôi sau khi đã trả lương. Chốt = chụp lại toàn bộ số liệu tại thời điểm chốt.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS ly_do_duyet text,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_ghi_chu text,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_at timestamp;

ALTER TABLE ship_ho_orders
  ADD COLUMN IF NOT EXISTS ly_do_duyet text,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_ghi_chu text,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ly_do_duyet_at timestamp;

CREATE TABLE IF NOT EXISTS kpi_logistics_chot (
  ky            text PRIMARY KEY,
  -- Ảnh chụp: toàn bộ SoLieuTuDong + bảng điểm + số nhập tay tại thời điểm chốt.
  so_lieu       jsonb NOT NULL,
  ghi_chu       text,
  chot_boi      text REFERENCES "user"(id) ON DELETE SET NULL,
  chot_at       timestamp NOT NULL DEFAULT now()
);
