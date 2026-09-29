-- CEO 29/09/2026 — ô "số đơn âm cước do lỗi trách nhiệm" phải cho phép ĐỂ TRỐNG.
--
-- Cột đang NOT NULL DEFAULT 0, mà bảng điểm đọc bằng nhap?.soDonAmCuocLoi ?? auto.soDonAmCuocLoiNoiBo.
-- Vì 0 không phải null nên CHỈ CẦN lưu một dòng cho kỳ là 42 đơn lỗi nội bộ hệ thống đo được
-- bị thay bằng 0 — người bị chấm được điểm 1.1 tuyệt đối mà không ai cố ý cho.
--
-- Không thể lưu hai mục 3B mà không đụng tới 1.1: đó là dấu hiệu ô này thiếu một trạng thái.
-- Nay NULL = CHƯA GHI ĐÈ, dùng số hệ thống. Cùng họ với bản vá 3B hôm nay: "chưa chấm" phải
-- khác "chấm là 0".
--
-- Dữ liệu cũ: bảng đang RỖNG (đo 29/09/2026), nên không dòng nào cần chuyển đổi.

ALTER TABLE kpi_logistics_thang
  ALTER COLUMN so_don_am_cuoc_loi DROP NOT NULL,
  ALTER COLUMN so_don_am_cuoc_loi DROP DEFAULT;
