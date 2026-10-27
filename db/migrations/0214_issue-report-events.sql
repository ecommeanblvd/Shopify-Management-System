-- Dòng thời gian xử lý báo lỗi: mỗi lần đổi trạng thái / ghi chú / gắn PR là một dòng, để admin
-- đọc "đã xử lý thế nào tới giờ" thay vì chỉ thấy ghi chú mới nhất (ghi chú cũ bị ghi đè).
--
-- ⚠ TỆP NÀY ÁP TAY (xem db/migrations/README.md). Áp xong phải kiểm `information_schema`
-- TRƯỚC khi deploy mã đọc nó. Thuần cộng thêm, chạy lại được.

CREATE TABLE IF NOT EXISTS issue_report_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      uuid NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
  luc           timestamptz NOT NULL DEFAULT now(),
  -- Ai làm: email admin, 'tác vụ tự động' (phiên xử lý hằng đêm), hoặc email người báo.
  nguoi         text NOT NULL,
  -- 'tao' | 'doi_trang_thai' | 'ghi_chu' | 'pr'
  loai          text NOT NULL,
  tu_trang_thai text,
  den_trang_thai text,
  ghi_chu       text,
  pr_url        text
);

CREATE INDEX IF NOT EXISTS issue_report_events_issue_idx ON issue_report_events (issue_id, luc);

-- Nạp lại lịch sử cho báo lỗi ĐÃ CÓ trước khi bảng này tồn tại (BL-1, BL-2…), để dòng thời gian
-- của chúng không trống. Mỗi báo lỗi: một dòng "tạo", và một dòng xử lý nếu đã có ghi chú.
-- Chạy lại không nhân đôi (mỗi nhóm chỉ chèn khi báo lỗi chưa có dòng loại đó).
INSERT INTO issue_report_events (issue_id, luc, nguoi, loai, den_trang_thai, ghi_chu)
SELECT r.id, r.created_at, COALESCE(r.reporter_email, 'ẩn danh'), 'tao', 'moi', 'Báo lỗi mới'
FROM issue_reports r
WHERE NOT EXISTS (SELECT 1 FROM issue_report_events e WHERE e.issue_id = r.id AND e.loai = 'tao');

INSERT INTO issue_report_events (issue_id, luc, nguoi, loai, den_trang_thai, ghi_chu, pr_url)
SELECT r.id, COALESCE(r.xu_ly_lan_cuoi, r.updated_at), 'tác vụ tự động',
       CASE WHEN r.pr_url IS NOT NULL THEN 'pr' ELSE 'doi_trang_thai' END,
       r.trang_thai, r.ghi_chu_xu_ly, r.pr_url
FROM issue_reports r
WHERE (r.ghi_chu_xu_ly IS NOT NULL OR r.pr_url IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM issue_report_events e
                  WHERE e.issue_id = r.id AND e.loai IN ('doi_trang_thai', 'ghi_chu', 'pr'));
