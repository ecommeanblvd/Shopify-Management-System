-- Webhook /api/lark/pack và cron sync-lark chạy ở hai tiến trình → chỉ unique index mới chặn tạo đôi kiện theo Log Unique code (kiểm 22/09: 6.031 mã, không trùng).
DROP INDEX IF EXISTS shipments_log_unique_code_idx;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_log_unique_code_idx ON shipments (log_unique_code) WHERE log_unique_code IS NOT NULL;
