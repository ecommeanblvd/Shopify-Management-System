-- Dấu THỜI ĐIỂM đã ghi giá ước tính lên Lark cho kiện này (Task 5, tính năng
-- "nhập tracking đẩy giá ước tính lên Lark"). Không đóng dấu này thì cron điền
-- bù (Task 7) không biết kiện nào đã ghi xong, gọi lại Lark MÃI MÃI cho những
-- kiện đã có đủ giá — cột này là lát cắt duy nhất phân biệt "đã xử lý" (có giá
-- hoặc không, miễn đã thử) khỏi "chưa ai đụng tới".
--
-- NULL = chưa ghi lần nào. Ghi bởi `ghiGiaUocTinhLenLark`
-- (features/dong-hang/ghi-gia-uoc-tinh-len-lark.ts) — một đường ghi duy nhất,
-- dùng chung giữa action nhập tracking (Task 5) và cron điền bù (Task 7).
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS gia_uoc_tinh_ghi_luc timestamp;
