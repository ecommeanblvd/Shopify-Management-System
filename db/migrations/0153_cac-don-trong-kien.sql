-- Đổi nghĩa cột: lưu TẤT CẢ mã đơn Lark ghi trên kiện, không phải "các đơn khác". Kiện gộp
-- có thể được gắn vào đơn thứ hai (khớp theo mã vận đơn từ trước), khi đó "slice(1)" lại
-- chính là đơn đang gắn — UI tự lọc đơn chính ra thì mới đúng (CEO 22/09/2026).
ALTER TABLE shipments RENAME COLUMN don_di_chung TO cac_don_trong_kien;
