-- Ngày hãng THẬT SỰ lấy hàng (mốc quét PU của FedEx).
--
-- `shipped_at` không phải ngày hàng đi: nó là mốc mình tạo nhãn và gửi thông tin sang hãng
-- (sự kiện OC). Đo trên AWB 873918787369: OC 03/07 05:31 · PU 06/07 14:52 · DL 08/07 09:51 —
-- `shipped_at` ghi 03/07, hàng rời kho 06/07, cách nhau 3 ngày.
--
-- Vì sao cần cột riêng: phụ phí xăng dầu tính theo TUẦN CỦA NGÀY ĐI. Tuần 29/06–06/07 là
-- 38,50%, tuần 06/07–13/07 là 38,25%; hãng áp 38,25%. Ai đối chiếu theo `shipped_at` sẽ thấy
-- lệch và báo động nhầm. Đo 118 đơn Kalisa: lấy được PU cho 116, và với CẢ 116 thì %fuel của
-- tuần chứa ngày PU khớp đúng % suy từ hoá đơn — 0 ca lệch. `shipped_at` thì lệch 4 đơn.
--
-- KHÔNG sửa `shipped_at`: nó là mốc nghiệp vụ của mình (lúc bàn giao cho hãng) và nhiều chỗ
-- khác đang dùng. Thêm cột mới, ai cần ngày đi thật thì đọc cột này.
ALTER TABLE ship_ho_orders
  ADD COLUMN IF NOT EXISTS picked_up_at timestamp;

COMMENT ON COLUMN ship_ho_orders.picked_up_at IS
  'Mốc quét PU (Picked up) của hãng — ngày hàng thật sự rời kho. NULL = chưa tra được.';
