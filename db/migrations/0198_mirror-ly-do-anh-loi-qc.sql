-- Kéo LÝ DO và ẢNH lỗi QC từ Lark về bản sao (CEO 03/10/2026).
--
-- Bản sao `lark_wh_inventory` đã kéo 463 dòng QC Failed về, nhưng chưa bao giờ mang theo hai
-- cột quan trọng nhất của một dòng lỗi: lý do và ảnh. Nên 456 lý do + 429 tấm ảnh của gần ba
-- năm vận hành (09/11/2023 → 02/10/2026) nằm CHỈ trên Lark; hệ thống biết đúng 6 chiếc.
--
-- 450/463 dòng không nối được về chiếc nào bên mình (kho nhập thẳng trên Lark), nên đây là
-- đường DUY NHẤT để dữ liệu lỗi QC vào được hệ thống.
--
-- CHỈ ĐỌC từ Lark. Lý do giữ nguyên chữ người gõ, KHÔNG quy về enum: "xước chỉ, bẩn" /
-- "loang màu, bẩn" / " sai màu" là chữ tự do, quy về enum là đoán nghĩa.
--
-- KHÔNG thêm cờ `co_anh_loi_qc`: độ dài `anh_loi_qc` đã trả lời đúng câu đó. Cờ
-- `co_anh_hang_den` tồn tại vì có đường bật tay riêng khi đội kho tải ảnh qua SMS; ảnh lỗi
-- không có đường đó, nên thêm cờ chỉ là hai bản của một sự thật.
ALTER TABLE lark_wh_inventory
  ADD COLUMN IF NOT EXISTS ly_do_fail text,
  ADD COLUMN IF NOT EXISTS anh_loi_qc jsonb NOT NULL DEFAULT '[]'::jsonb;
