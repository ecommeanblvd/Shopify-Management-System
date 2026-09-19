-- Mã HTTP MMP trả về ở lần gửi gần nhất của từng sự kiện outbox (NULL = chưa gửi / lỗi mạng không có phản hồi).
-- MMP đối chiếu 19/09/2026: cần biết từng lần gửi nhận 200 hay 401 (stale / bad signature).
ALTER TABLE ship_ho_order_events ADD COLUMN IF NOT EXISTS last_http_status integer;
