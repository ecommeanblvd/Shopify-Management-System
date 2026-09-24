-- Loại người nhận (KOL / Production House) thay hẳn "mục đích" ở cấp đơn.
--
-- CEO 24/09/2026 theo bản thiết kế `design_handoff_kol_order_modal`: loại là
-- thuộc tính của NGƯỜI NHẬN, không phải lựa chọn lúc lên đơn — người dùng không
-- chọn tay, hệ thống tự biết. Mã đơn lấy tiền tố theo loại (KOL-… / PH-…).
--
-- Bỏ `muc_dich` được vì bảng đang có ĐÚNG 0 đơn và 0 người nhận: tính năng dựng
-- xong nhưng chưa ai dùng. Không có gì để di dời, không có mã đơn nào đã phát ra.
CREATE TYPE kol_loai_nguoi_nhan AS ENUM ('kol', 'ph');

ALTER TABLE kol_nguoi_nhan
  ADD COLUMN loai kol_loai_nguoi_nhan NOT NULL DEFAULT 'kol';

-- Ảnh chụp lúc tạo đơn, cùng lý do với `ten_nhan`: sửa sổ người nhận về sau
-- KHÔNG được làm đổi loại của đơn cũ (mã đơn đã phát ra theo loại đó).
ALTER TABLE kol_don
  ADD COLUMN loai_nhan kol_loai_nguoi_nhan NOT NULL DEFAULT 'kol';

ALTER TABLE kol_don DROP COLUMN muc_dich;
DROP TYPE kol_muc_dich;

CREATE INDEX kol_nguoi_nhan_loai_idx ON kol_nguoi_nhan (loai, ten);
