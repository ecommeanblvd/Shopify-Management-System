-- OUTBOX cho sự kiện CẤP BẢNG KÊ gửi MMP (CEO 01/10/2026).
--
-- VÌ SAO CẦN: `pushStatementEvent` POST thẳng sang MMP và KHÔNG ghi một dòng nào — bảng
-- `ship_ho_order_events` chỉ dùng cho sự kiện cấp ĐƠN. Nên gửi một chứng từ về tiền cho đối
-- tác mà nếu lượt POST hỏng thì không ai còn cách nào biết: `setStatementStatus` coi push là
-- best-effort, bảng kê vẫn thành `issued` dù MMP không nhận, và dấu vết duy nhất là một dòng
-- thông báo trên màn hình rồi mất. Đây là bài học D-177 ("hàng đợi không ai đọc") ở dạng tệ
-- hơn: ở đây KHÔNG CÓ CẢ HÀNG ĐỢI.
--
-- VÌ SAO BẢNG RIÊNG, KHÔNG DÙNG `ship_ho_order_events`: cột `order_id` của bảng đó là NOT NULL
-- và có FK sang `ship_ho_orders`. Sự kiện cấp bảng kê thuộc về một BRAND + một KỲ, không thuộc
-- đơn nào. Nới `order_id` thành nullable là làm yếu một ràng buộc đang đúng cho 338 dòng kia,
-- chỉ để nhét một loại dữ liệu khác họ vào cùng bảng.
--
-- UNIQUE (statement_id, event): MỘT dòng cho mỗi (bảng kê × loại sự kiện). Gửi lại là thêm một
-- LẦN THỬ trên đúng dòng đó, không đẻ dòng thứ hai — để MMP thấy đúng MỘT ảnh chụp của một bảng
-- kê (lý do câu chặn "đã phát hành — không gửi lại" tồn tại), còn SMS giữ đúng một dòng sổ với
-- số lần thử.

CREATE TABLE IF NOT EXISTS "ship_ho_statement_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "statement_id" uuid NOT NULL REFERENCES "ship_ho_statements"("id"),
  "brand_slug" text NOT NULL,
  "event" text NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "delivery_status" "ship_ho_event_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp,
  "last_error" text,
  "last_http_status" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ship_ho_statement_events_ke_event_idx"
  ON "ship_ho_statement_events" ("statement_id", "event");

-- Lượt cron quét theo trạng thái; occurred_at để gửi cái cũ trước.
CREATE INDEX IF NOT EXISTS "ship_ho_statement_events_trangthai_idx"
  ON "ship_ho_statement_events" ("delivery_status", "occurred_at");
