-- Bước ĐÓNG THÙNG làm ngay trong SMS (CEO 30/09/2026).
--
-- CEO mô tả luồng thật: lúc QC các bạn cân sản phẩm rồi ĐẶT THỬ VÀO HỘP để chọn loại hộp vừa,
-- và điền cân DỰ KIẾN SAU KHI ĐÓNG cho từng món. Tới bước Đóng hàng thì chọn thùng thật, đóng
-- xong cân cả kiện. Bước sau này chưa có chỗ nhập trong hệ thống nào — CEO: "khả năng trên Lark
-- chưa có thì hệ thống sẽ cần có trước, sau anh sẽ bàn với đội Lark để đồng bộ lên sau".
--
-- VÌ SAO CỘT RIÊNG, KHÔNG GHI VÀO `lark_hop` / `actual_weight_kg`: hai cột đó do lượt đồng bộ
-- Lark SỞ HỮU và ghi đè mỗi lượt. SMS ghi vào đó thì lượt đồng bộ kế tiếp xoá mất — im lặng,
-- không ai biết. Đo 30/09: 1.257/1.279 kiện 90 ngày có `actual_weight_kg` từ Lark, nhưng chỉ
-- 3 kiện có `lark_hop`, tức việc chọn thùng gần như không được ghi lại ở đâu cả.
--
-- Đặt tên theo đúng nếp đã có ở `ship_ho_orders` (sms_weight_kg, sms_dim_*, sms_measured_*).

ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_hop" text;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_weight_kg" numeric(10, 3);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_dim_length_cm" numeric(10, 2);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_dim_width_cm" numeric(10, 2);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_dim_height_cm" numeric(10, 2);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_packed_at" timestamp;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sms_packed_by" text;

-- Tìm kiện đã đóng trong SMS mà chưa đẩy sang Lark — dùng khi đội Lark làm xong cột bên đó.
CREATE INDEX IF NOT EXISTS "shipments_sms_packed_idx" ON "shipments" ("sms_packed_at");
