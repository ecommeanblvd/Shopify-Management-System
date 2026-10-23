-- Ảnh đính kèm báo lỗi: tối đa 3 ảnh/báo lỗi, lưu ở kho S3, bảng chỉ giữ danh sách khoá.
-- Dạng phần tử: {"key": "issue-reports/<id>/1.png", "ten": "...", "loai": "image/png", "kichThuoc": 12345}
--
-- ⚠ TỆP NÀY ÁP TAY (xem db/migrations/README.md). Áp xong phải kiểm `information_schema`.
-- Thuần cộng thêm, chạy lại được.

ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS anh jsonb NOT NULL DEFAULT '[]'::jsonb;
