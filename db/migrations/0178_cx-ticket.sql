-- Module CX - To Do (CEO duyệt 27/09) — xem docs/superpowers/specs/2026-09-27-cx-ticket-design.md
--
-- Đo 675 ticket thật trên bảng Lark `CX - To Do`: 257/675 đi qua NHIỀU bộ phận,
-- và 62 ticket gắn 2–7 dòng đơn. Nên phần việc theo bộ phận là BẢNG RIÊNG, không
-- phải 10 cột cố định như Lark — kiểu cột cố định chính là thứ đã sinh ra
-- `Text 13`, `Text 14`, `Parent items 1..4` bỏ hoang trên bảng của họ.
--
-- Các cột phân loại/trạng thái để TEXT, không enum Postgres: thêm một loại vấn
-- đề mới không được phép cần migration. Giá trị kiểm ở features/cx-ticket/*.ts.

CREATE TABLE IF NOT EXISTS cx_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_ticket text NOT NULL UNIQUE,
  tieu_de text NOT NULL,
  nhom text NOT NULL,
  loai text NOT NULL,
  bo_phan_neu text NOT NULL,
  -- NOT NULL có mặc định: trên Lark 259/675 dòng (38%) để trống `Status TODO`,
  -- tức không ai biết ticket đó còn sống hay đã xong.
  trang_thai text NOT NULL DEFAULT 'moi',
  han_xu_ly date,
  -- Số ticket Intercom (`Ticket No. (for CS)` của Lark) — để nối ngược sang chat
  -- với khách mà không phải dựng tích hợp Intercom vòng này.
  ma_ticket_cs text,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  khach_email text,
  -- 'lark' = hồ sơ lịch sử nhập vào, CHỈ ĐỌC trên UI. Tách khỏi ticket đang chạy
  -- để CX không sửa vào dữ liệu cũ rồi lệch với bảng Lark gốc.
  nguon text NOT NULL DEFAULT 'he_thong',
  -- UNIQUE để script nhập chạy lại nhiều lần không sinh bản trùng.
  lark_record_id text UNIQUE,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  dong_luc timestamp
);
CREATE INDEX IF NOT EXISTS cx_ticket_trang_thai_idx ON cx_ticket(trang_thai);
CREATE INDEX IF NOT EXISTS cx_ticket_nhom_idx ON cx_ticket(nhom);
CREATE INDEX IF NOT EXISTS cx_ticket_tao_luc_idx ON cx_ticket(created_at DESC);

-- Nhiều-nhiều sang dòng đơn: đo Lark 0 dòng 321 · 1 dòng 292 · 2 dòng 40 ·
-- 3 dòng 13 · 4 dòng 7 · 7 dòng 2. Một cột order_line_id là sai với 62 ticket.
CREATE TABLE IF NOT EXISTS cx_ticket_dong (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cx_ticket(id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL REFERENCES shopify_order_lines(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cx_ticket_dong_uniq ON cx_ticket_dong(ticket_id, order_line_id);
CREATE INDEX IF NOT EXISTS cx_ticket_dong_line_idx ON cx_ticket_dong(order_line_id);

-- Một dòng cho MỖI bộ phận được gán vào ticket. Đây là chỗ trả lời được câu
-- "bộ phận nào đang tắc" — thứ Lark không trả lời được vì trạng thái nằm rải ở
-- 5 cột khác nhau và ghi mới đè ghi cũ.
CREATE TABLE IF NOT EXISTS cx_ticket_phan_viec (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cx_ticket(id) ON DELETE CASCADE,
  bo_phan text NOT NULL,
  trang_thai text NOT NULL DEFAULT 'dang_xu_ly',
  nguoi_phu_trach text REFERENCES "user"(id) ON DELETE SET NULL,
  xong_luc timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cx_ticket_phan_viec_uniq ON cx_ticket_phan_viec(ticket_id, bo_phan);

-- Ghi chú APPEND-ONLY. Lark dồn mọi diễn biến vào một ô text mà CX tự gõ thêm
-- ngày vào đầu dòng ("26/7: update shopify…"), nên không biết ai ghi lúc nào.
CREATE TABLE IF NOT EXISTS cx_ticket_ghi_chu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cx_ticket(id) ON DELETE CASCADE,
  bo_phan text NOT NULL,
  noi_dung text NOT NULL,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  -- CX gõ hộ bộ phận chưa có tài khoản. Đo được tỉ lệ này là biết bộ phận nào
  -- cần mở tài khoản trước.
  ghi_ho boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_ticket_ghi_chu_ticket_idx ON cx_ticket_ghi_chu(ticket_id, created_at);

-- Vai trò thuộc bộ phận nào. Nullable: các vai trò cũ (admin, viewer…) không
-- thuộc bộ phận nào và không nên bị gán bừa.
ALTER TABLE app_roles ADD COLUMN IF NOT EXISTS bo_phan text;
