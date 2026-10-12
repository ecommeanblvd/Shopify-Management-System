-- Dấu THỜI ĐIỂM đã ghi giá ước tính lên Lark cho kiện này (Task 5, tính năng
-- "nhập tracking đẩy giá ước tính lên Lark"). Không đóng dấu này thì cron điền
-- bù (Task 7) gọi lại Lark/API báo giá MÃI MÃI cho những kiện vốn đã xử lý xong.
--
-- Đóng dấu khi ghi Lark THÀNH CÔNG, HOẶC khi xác định kiện này sẽ KHÔNG BAO GIỜ
-- ghi được (dòng Lark tương ứng đã bị xoá bên Lark, không tự quay lại) — KHÔNG
-- đóng dấu ở hai nhánh còn-có-thể-thử-lại ("chưa lấy được giá ước tính", "kiện
-- chưa có dòng Lark tương ứng"), vì cron còn phải thử lại đúng những kiện đó khi
-- điều kiện đổi (vd giá tính được sau, hoặc kiện được gắn dòng Lark sau).
--
-- NULL = chưa xử lý lần nào, hoặc đang ở một nhánh còn-có-thể-thử-lại. Ghi bởi
-- `ghiGiaUocTinhLenLark` (features/dong-hang/ghi-gia-uoc-tinh-len-lark.ts) — một
-- đường ghi duy nhất, dùng chung giữa action nhập tracking (Task 5) và cron điền
-- bù (Task 7).
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS gia_uoc_tinh_ghi_luc timestamp;
