-- `ship_ho_orders.track_detail` — lời của HÃNG ở lượt tra gần nhất (CEO 02/10/2026).
--
-- VÌ SAO CẦN: từ 02/10 luật track là "hãng thắng nhưng KHÔNG kéo trạng thái lùi"
-- (lib/fedex/track.ts). Khi hãng nói lùi thì SMS GIỮ trạng thái đang có — nhưng bảng
-- `ship_ho_orders` không có chỗ nào lưu lời của hãng, nên người đối soát chỉ thấy trạng thái cũ
-- mà không biết hãng đang nói gì. Giữ trạng thái là một quyết định; giấu thông tin là một lỗi.
--
-- Ca thật đang có: 5 kiện UPS mang `out_for_delivery` (đội vận hành gõ qua Lark) trong khi UPS
-- nói `in_transit`, một kiện trong đó UPS còn nói "We Have Your Package" — tức mới nhận hàng,
-- cho một kiện tạo từ tháng 8. Không có cột này thì chênh lệch đó không ai thấy.
--
-- Bảng `shipments` đã có cột cùng tên và cùng nghĩa (hiện trên PackPanel + màn lifecycle); đây
-- là làm cho hai bảng nói cùng một thứ, không phải thêm một khái niệm mới.

ALTER TABLE "ship_ho_orders" ADD COLUMN IF NOT EXISTS "track_detail" text;
