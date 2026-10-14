-- Kích thước (kích thước hộp / pallet) của hàng đóng gói.
--
-- Giữ nguyên dạng tự do `40x30x20`, `28x42`, `37x30x9.5` từ Lark bởi vì hộp
-- có rất nhiều mẫu không theo chuẩn. Task 2 (trong dự án "chọn box khi đóng hàng")
-- mới phân tích cột này thành các số để so sánh với kích thước box tồn kho,
-- nên tới lúc đó mới cần enum hay quy chuẩn — hiện tại để text để không làm mất
-- dữ liệu hay cần backfill lại sau.
--
-- Cột này nằm trên Lark từ tháng 10/2026, khi người kho được yêu cầu ghi kích thước
-- vào kiện trong quá trình đóng gói.
ALTER TABLE lark_wh_inventory
  ADD COLUMN IF NOT EXISTS kich_thuoc text;
