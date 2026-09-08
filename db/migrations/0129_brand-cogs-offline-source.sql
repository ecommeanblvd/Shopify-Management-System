-- brand_cogs_offline chưa tách nguồn ghi: xoá theo kỳ (features/cogs/bang-ke-import.ts,
-- apDungBangKeDaDoc) trước đây xoá MỌI nguồn cùng brand+period — webhook MMP (source='mmp')
-- ghi lại một kỳ sẽ xoá luôn dòng nhập tay từ bảng kê xlsx (source='brand_statement') và
-- ngược lại. Thêm cột source để xoá đúng phạm vi, giống order_line_cogs.source.
ALTER TABLE brand_cogs_offline ADD COLUMN source text NOT NULL DEFAULT 'brand_statement';--> statement-breakpoint
CREATE INDEX brand_cogs_offline_source_idx ON brand_cogs_offline (brand_slug, period, source);
