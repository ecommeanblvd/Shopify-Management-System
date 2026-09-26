-- Mã file đính kèm của bảng Lark WH - Inventory (CEO 26/09).
--
-- Trước chỉ lưu CÓ/KHÔNG (`co_anh_hang_den`, `co_bb_ban_giao`) nên màn Sổ nhập
-- chỉ hiện được dấu ✓. Muốn hiện ảnh nhỏ và mở ảnh to thì phải giữ `file_token`
-- của từng file.
--
-- Lưu jsonb chứ không phải mảng text: mỗi file cần cả token lẫn TÊN để hiện
-- dưới ảnh và để phân biệt PDF với ảnh.
ALTER TABLE lark_wh_inventory
  ADD COLUMN IF NOT EXISTS anh_hang_den jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bb_ban_giao jsonb NOT NULL DEFAULT '[]'::jsonb;
