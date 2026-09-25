-- Thời gian xử lý + dự kiến giao theo TỪNG DÒNG ĐƠN (CEO 25/09).
--
-- Email xác nhận đơn đang hiện "Processing time: 8 - 14 business days" và
-- "Estimated Delivery: 7 October - 22 October" dưới mỗi sản phẩm. Kho cần con
-- số đó để điền sang Lark.
--
-- HAI NGUỒN KHÁC NHAU:
--  * `processing_min_days` / `processing_max_days` lấy từ metafield SẢN PHẨM
--    `theme.estimateStartDate` / `theme.estimateEndDate` — giá trị HIỆN TẠI,
--    brand sửa là đổi theo, nên với đơn cũ không chắc là con số khách đã thấy;
--  * `estimated_delivery` lấy từ thuộc tính của chính DÒNG ĐƠN, ĐÓNG BĂNG lúc
--    đặt hàng — đây mới đúng là thứ đã hứa với khách.
ALTER TABLE shopify_order_lines
  ADD COLUMN IF NOT EXISTS processing_min_days integer,
  ADD COLUMN IF NOT EXISTS processing_max_days integer,
  ADD COLUMN IF NOT EXISTS estimated_delivery text;
