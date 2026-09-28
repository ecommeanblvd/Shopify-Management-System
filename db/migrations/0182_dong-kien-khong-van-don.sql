-- Lối ĐÓNG KIỆN khi không bao giờ có vận đơn (CEO 28/09/2026).
--
-- Vì sao: màn Đóng hàng chỉ có MỘT lối ra là "có mã vận đơn". Nhưng đo thật
-- 28/09/2026 trên 14 kiện tồn quá 7 ngày: 11 kiện là đơn Invalid (sai địa chỉ,
-- khách không hợp tác) nên KHÔNG BAO GIỜ đi; 1 kiện giao tận tay tại văn phòng
-- Giang Văn Minh (đơn MKT mượn quay video); 1 kiện là dòng trùng (hàng đã đi
-- bằng kiện anh em). Chúng nằm lại vĩnh viễn, và cách duy nhất Ops dọn được là
-- XOÁ dòng Lark (đã xoá 2.003 dòng) — tức xoá luôn hồ sơ thay vì đóng có lý do.

-- Ghi chú đơn bên Lark (cột "LOG-Order Remark (Full)"). Kiện của đơn Invalid tự
-- rời hàng chờ và TỰ QUAY LẠI khi CX sửa được địa chỉ và Lark bỏ cờ — nên cột
-- này do đồng bộ ghi đè vô điều kiện, không phải người nhập.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lark_ghi_chu_don text;

-- Đóng tay: lý do + dấu vết ai/lúc nào, theo đúng mẫu lyDoCham đã có.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dong_kien_luc timestamp;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dong_kien_ly_do text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dong_kien_ghi_chu text;
-- Lý do "dòng trùng" phải chỉ được kiện nào ĐÃ đi, để còn truy ngược.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dong_kien_kien_thay_the text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dong_kien_by text REFERENCES "user"(id) ON DELETE SET NULL;

-- Hàng chờ lọc theo cột này nên cần chỉ mục một phần; kiện đã đóng là thiểu số.
CREATE INDEX IF NOT EXISTS shipments_dong_kien_idx ON shipments (dong_kien_luc)
  WHERE dong_kien_luc IS NOT NULL;
