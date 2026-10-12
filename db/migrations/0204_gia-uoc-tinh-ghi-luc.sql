-- Dấu THỜI ĐIỂM đã ghi giá ước tính lên Lark cho kiện này (Task 5, tính năng
-- "nhập tracking đẩy giá ước tính lên Lark"). Không đóng dấu này thì cron điền
-- bù (Task 7) gọi lại Lark/API báo giá MÃI MÃI cho những kiện vốn đã xử lý xong.
--
-- Cột này làm CẢ HAI việc: giành việc và đánh dấu đã xong. Đóng dấu NGAY TỪ ĐẦU
-- mỗi lượt (`UPDATE … WHERE gia_uoc_tinh_ghi_luc IS NULL RETURNING`) để action
-- nhập tracking và cron không cùng ghi lên một dòng Lark; XOÁ LẠI ở các nhánh
-- còn-có-thể-thử-lại ("chưa lấy được giá ước tính", "kiện chưa có dòng Lark",
-- Lark/mạng hỏng) vì cron còn phải thử lại đúng những kiện đó khi điều kiện đổi.
-- GIỮ dấu khi đã ghi xong, khi không còn ô trống nào để điền, và khi biết chắc sẽ
-- không bao giờ ghi được (dòng Lark đã bị xoá bên Lark, không tự quay lại).
--
-- NULL = chưa lượt nào giành, hoặc lượt trước đã nhả. Ghi bởi
-- `ghiGiaUocTinhLenLark` (features/dong-hang/ghi-gia-uoc-tinh-len-lark.ts) — một
-- đường ghi duy nhất, dùng chung giữa action nhập tracking (Task 5) và cron điền
-- bù (Task 7).
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS gia_uoc_tinh_ghi_luc timestamp;
