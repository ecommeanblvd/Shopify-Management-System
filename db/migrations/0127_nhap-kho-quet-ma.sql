-- Nhập kho quét mã (spec docs/superpowers/specs/2026-09-06-nhap-kho-quet-ma-design.md §3.2, §5).
--
-- printed_at   : lúc kho bấm "In N tem" — món tồn tại nhưng CHƯA được coi là đã nhận.
-- confirmed_at : lúc quét xác nhận tem đã dán. Đủ chiếc của dòng → chốt delivered_at.
-- unplanned    : cờ vàng "Nhận ngoài kế hoạch" (brand gửi thừa / hàng không có trong
--                danh sách chờ) — không nối dòng đơn, không tự nâng số lượng đơn.
ALTER TABLE goods_receipt_items ADD COLUMN printed_at timestamp;--> statement-breakpoint
ALTER TABLE goods_receipt_items ADD COLUMN confirmed_at timestamp;--> statement-breakpoint
ALTER TABLE goods_receipt_items ADD COLUMN unplanned boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_receipt_items_line_idx ON goods_receipt_items (fulfillment_line_id);--> statement-breakpoint
-- Dòng nhận hàng do SMS ghi (source='sms') cần đẩy sang bảng Lark "WH ngày MEAN
-- nhận hàng"; NULL = chưa đẩy, cron sync-lark điền bù (cùng cách cột Couriers, D-045).
ALTER TABLE mmp_line_received ADD COLUMN lark_pushed_at timestamp;
