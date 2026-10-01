-- DÒNG ĐIỀU CHỈNH cho bảng kê ship hộ (CEO 01/10/2026; MMP đã đồng ý nhận hai trường).
--
-- VẤN ĐỀ: giá một đơn có thể đổi SAU khi kỳ đã phát hành (hoá đơn hãng về muộn, duty về muộn,
-- operator chốt lại). Hôm nay `goBangKeNhap` lọc `statement_id IS NULL` nên đơn đã kê thì không
-- bao giờ được nhìn lại: SMS giữ giá mới trong `actual_charged_vnd` còn brand đã bị thu giá cũ,
-- và KHÔNG CÓ ĐƯỜNG NÀO để chênh lệch đó đi ra. Hợp đồng Fulfillment Điều 3.2 đã quy định biên
-- bản + hoá đơn điều chỉnh, nên đường ra phải là một bảng kê loại `adjustment` ở kỳ sau.
--
-- `lines_json` — ẢNH CHỤP TỪNG DÒNG lúc phát hành, BẤT BIẾN sau đó.
--   Vì sao bắt buộc: điều chỉnh là HIỆU giữa số ĐÃ GỬI và số hiện tại. `total_charged_vnd` chỉ
--   là tổng, không nói đơn nào bao nhiêu. Payload trong `ship_ho_statement_events` có số từng
--   dòng nhưng bị GHI ĐÈ mỗi lượt gửi lại (upsert theo statement_id+event) — một sổ giao vận
--   không phải sổ kế toán. Không có ảnh chụp thì sau này không ai tính được điều chỉnh, và tệ
--   hơn: không ai CHỨNG MINH được đã gửi brand số bao nhiêu.
--
-- `adjusts_statement_id` — bảng kê `adjustment` này sửa bảng kê nào. MMP dùng đúng trường này
--   để biết dòng thuộc kỳ nào, thay vì coi nó là khoản phát sinh mới của kỳ đang mở.
--
-- Loại `adjustment` KHÔNG mang freight/duty: `adjusts_statement_id` đã nói nó sửa bản nào, mà
-- bản đó có loại rồi. Nhân đôi thông tin đó là mở đường cho hai chỗ nói khác nhau.

ALTER TYPE "ship_ho_statement_type" ADD VALUE IF NOT EXISTS 'adjustment';

ALTER TABLE "ship_ho_statements" ADD COLUMN IF NOT EXISTS "lines_json" jsonb;
ALTER TABLE "ship_ho_statements" ADD COLUMN IF NOT EXISTS "adjusts_statement_id" uuid
  REFERENCES "ship_ho_statements"("id");

-- Tìm bảng kê điều chỉnh của một kỳ đã phát hành.
CREATE INDEX IF NOT EXISTS "ship_ho_statements_adjusts_idx"
  ON "ship_ho_statements" ("adjusts_statement_id");
