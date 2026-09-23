-- Hai đường vào cron (scripts/cron/sync-lark.ts + app/api/cron/sync-lark/route.ts) chạy độc
-- lập, có thể chồng lên nhau — noiLineIdChoMon đọc snapshot rồi UPDATE rời rạc, không transaction/
-- khoá, nên hai tiến trình có thể gán cùng một shopify_line_id cho hai món khác nhau (review
-- 23/09/2026, Finding 1). Chỉ ràng buộc ở tầng DB mới chặn được — advisory lock (Finding 1b) giảm
-- khả năng xảy ra nhưng không thay được ràng buộc này.
-- Dữ liệu trùng cũ đã được dọn (script tạm, số liệu ghi ở task-3-report.md) trước khi chạy migration này.
CREATE UNIQUE INDEX IF NOT EXISTS lark_mon_don_line_uniq ON lark_mon_don (shopify_line_id) WHERE shopify_line_id IS NOT NULL;
