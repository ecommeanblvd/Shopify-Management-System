-- Bảng box của HỆ THỐNG (SMS) cho việc chọn box khi đóng hàng — không phải mirror Lark.
--
-- Vì sao cần bảng riêng thay vì đọc thẳng `lark_wh_inventory`: CEO chốt luật
-- "bản-sửa-tay-thắng" — khi người đóng hàng sửa kích thước một box ngay trong SMS (đã đo
-- thùng thật), con số đó THẮNG và KHOÁ (`sua_tay = true`); lần đồng bộ Lark sau không được
-- ghi đè, chỉ được dùng để BÁO lệch cho người xem (tính ở `features/dong-hang/tron-box.ts`,
-- không lưu `lech` ở đây — nó là kết quả so sánh lúc đọc, không phải trạng thái lưu).
--
-- Vì sao khớp theo TÊN (`ten`, unique) mà không theo `lark_wh_inventory.record_id`:
-- `lark_wh_inventory` là bản mirror CÓ XOÁ — mỗi lô nhập hàng là một dòng riêng với
-- record_id riêng, lô cũ bị xoá hẳn khi kho nhập lô mới. Nếu bảng này khoá theo
-- record_id thì bản sửa tay biến mất ngay khi kho đổi lô — đúng cái luật này sinh ra để
-- ngăn. Tên box ổn định qua các lô, record_id thì không.
--
-- `an` = ẩn khỏi màn chọn box (ví dụ box ngừng dùng) — KHÔNG xoá dòng: xoá sẽ mất luôn số
-- đã khoá, và nếu Lark còn lô cũ ghi đúng tên đó thì box "ẩn" sẽ tự mọc lại không kiểm soát.
--
-- `nguoi_sua`/`cap_nhat_luc`: ai và lúc nào bấm sửa tay lần cuối — hiện cùng `lech` để
-- người xem biết sửa gần đây hay đã cũ.
CREATE TABLE IF NOT EXISTS box_dong_goi (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  ten           text NOT NULL UNIQUE,
  ma            text NOT NULL,
  loai          text NOT NULL,
  dai_cm        numeric,
  rong_cm       numeric,
  cao_cm        numeric,
  sua_tay       boolean NOT NULL DEFAULT false,
  an            boolean NOT NULL DEFAULT false,
  cap_nhat_luc  timestamp NOT NULL DEFAULT now(),
  nguoi_sua     text REFERENCES "user"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS box_dong_goi_an_idx ON box_dong_goi (an);
