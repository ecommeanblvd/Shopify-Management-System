-- Chiếc hàng nhận cho MỘT DÒNG MÓN trên bảng Lark (CEO 08/10/2026, Bảo báo "không nhập được
-- đơn TQ").
--
-- Đơn Trung Quốc (#MTB MEAN Taobao, #MXHS MEAN Xiao Hong Shu) không nằm trong `shopify_orders`
-- — đo 08/10: 0 đơn. Chúng nằm ở bảng món `lark_mon_don`. Nên ngoài `order_id` (Shopify) và
-- `po_record_id` (hàng đặt PO), chiếc hàng cần cặp thứ ba để biết nó nhận cho món nào.
--
-- `mon_dinh_danh` là KHOÁ CHÍNH của `lark_mon_don` — dùng để đếm "món này đã nhận mấy chiếc".
-- `mon_record_id` là record_id trên Lark — dùng để nối cột liên kết `Import (select order)`.
-- Ghim CẢ HAI lúc nhận thay vì tra lại về sau: bản sao bảng món là ảnh chụp, dòng có thể biến
-- mất khỏi đó (đo được 77 dòng MTB/MXHS đã đánh huỷ) và khi đó chiếc hàng mất dấu nguồn.
--
-- Một dòng món = MỘT CHIẾC (đo 08/10: 211 cặp đơn×SKU trên 211 dòng MTB/MXHS, không cặp nào
-- hơn một dòng; và 36/40 đơn MBLVD mới nhất có số dòng món khớp đúng tổng số lượng).
ALTER TABLE goods_receipt_items
  ADD COLUMN IF NOT EXISTS mon_dinh_danh text,
  ADD COLUMN IF NOT EXISTS mon_record_id text;

CREATE INDEX IF NOT EXISTS goods_receipt_items_mon_idx
  ON goods_receipt_items (mon_dinh_danh);
