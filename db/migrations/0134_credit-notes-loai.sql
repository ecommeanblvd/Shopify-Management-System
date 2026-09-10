-- Carrier gửi cả hoá đơn điều chỉnh GIẢM (credit note — trả lại tiền) lẫn điều chỉnh TĂNG / thu thêm (billing note).
-- CEO 10/09/2026: cho nhân sự logistics tải hết vào một chỗ, hệ thống tự phân loại. Chỉ credit note mới là "tiền thu
-- hồi" của KPI Pillar 3; billing note theo dõi riêng vì đó là tiền phải trả thêm.
ALTER TABLE credit_notes ADD COLUMN loai text NOT NULL DEFAULT 'credit';--> statement-breakpoint
UPDATE credit_notes SET loai = CASE WHEN tong_cong::numeric < 0 THEN 'credit' ELSE 'debit' END;--> statement-breakpoint
CREATE INDEX credit_notes_loai_ngay_idx ON credit_notes (loai, ngay);
