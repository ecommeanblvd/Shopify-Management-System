-- Mỗi CHỖ LỖI một dòng. `goods_receipt_items` chỉ có một ô `qc_fail_photo_key`
-- (0 dòng, chưa ai dùng), mà một chiếc váy bẩn gấu VÀ rách nách VÀ hỏng khoá là
-- ba chỗ lỗi, mỗi chỗ một ảnh. Nhồi vào một ô là mất bằng chứng khi cãi với brand.
CREATE TYPE qc_ly_do_loi AS ENUM (
  'ban','rach','loi_vai','xuoc_vai','hong_khoa','thieu_phu_kien',
  'co_mui','sai_mau','sai_size','loi_duong_may','o_loang_mau','khac');

CREATE TABLE wh_loi_qc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id uuid NOT NULL REFERENCES goods_receipt_items(id) ON DELETE CASCADE,
  ly_do qc_ly_do_loi NOT NULL,
  anh_key text,
  ghi_chu text,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text NOT NULL
);

CREATE INDEX wh_loi_qc_item_idx ON wh_loi_qc (receipt_item_id);

-- Sequence cho mã chiếc hàng. Liên tục, không reset theo tháng, nên mã không
-- bao giờ trùng kể cả khi ai đó sửa giờ hệ thống.
CREATE SEQUENCE IF NOT EXISTS wh_chiec_seq START 1;
