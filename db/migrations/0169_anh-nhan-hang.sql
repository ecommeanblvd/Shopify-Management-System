-- Ảnh lúc NHẬN HÀNG (CEO 25/09).
--
-- Kho nhận hàng phải chụp lại: (1) ảnh thực tế hàng đến, thấy đủ số lượng;
-- (2) biên bản bàn giao brand đưa. Trên Lark đây là hai cột đính kèm
-- "Ảnh Thực Tế SP" và "BB Giao Nhận".
--
-- Vì sao BẢNG RIÊNG chứ không thêm cột: một lượt giao cần NHIỀU ảnh (đủ số
-- lượng thì một khung hình không chứa hết), và biên bản có thể nhiều trang.
-- `goods_receipts.handover_doc_key` là ô MỘT file của luồng cũ — giữ nguyên,
-- không đụng vào, vì luồng cũ vẫn còn 833 chiếc dữ liệu thật.
--
-- Gắn vào PHIẾU NHẬN chứ không vào từng chiếc: một tấm ảnh chụp cả lô hàng
-- của một brand trong ngày, gán lặp cho từng chiếc là nhân bản vô nghĩa.

DO $$ BEGIN
  CREATE TYPE wh_loai_anh_nhan AS ENUM ('hang_den', 'bb_ban_giao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS wh_anh_nhan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  loai        wh_loai_anh_nhan NOT NULL,
  s3_key      text NOT NULL,
  ten_file    text,
  nguoi_tai   text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wh_anh_nhan_receipt_idx ON wh_anh_nhan (receipt_id, loai);
