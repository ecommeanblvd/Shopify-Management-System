-- Chặn tải trùng: nhận diện hoá đơn theo NỘI DUNG (ký hiệu + số + ngày + tiền + mô tả), không theo tên tệp — cùng một
-- hoá đơn đổi tên tệp vẫn phải bị chặn. CEO 10/09/2026.
ALTER TABLE credit_notes ADD COLUMN noi_dung_hash text;--> statement-breakpoint
CREATE INDEX credit_notes_hash_idx ON credit_notes (noi_dung_hash);
