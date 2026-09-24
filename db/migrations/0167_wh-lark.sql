-- Nối luồng Nhận & Kiểm hàng với bảng Lark "WH - Inventory (Nhập, QC, Pack)".
--
-- CEO 24/09: kho gom danh sách trên UI rồi bấm MỘT nút "Gửi"; sau khi gửi vẫn
-- có thể gỡ, và bảng Lark phải khớp UI y hệt.
ALTER TABLE goods_receipt_items ADD COLUMN lark_record_id text;
CREATE INDEX goods_receipt_items_lark_idx ON goods_receipt_items (lark_record_id);

-- Nhật ký MỌI lượt đụng vào bảng Lark. Hàng rào thứ tư CEO chốt cho việc xoá:
-- "ghi nhật ký mọi lượt xoá — ai, lúc nào, record nào, chiếc nào".
--
-- Giữ cả lượt THẤT BẠI: một lượt xoá hỏng mà không ai biết là một record rác
-- nằm lại trên bảng vận hành.
CREATE TABLE wh_lark_nhat_ky (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hanh_dong text NOT NULL,                 -- 'tao' | 'xoa' | 'sua'
  lark_record_id text,
  receipt_item_id uuid REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
  thanh_cong boolean NOT NULL,
  chi_tiet text,
  actor text NOT NULL,
  luc timestamp NOT NULL DEFAULT now()
);

CREATE INDEX wh_lark_nhat_ky_luc_idx ON wh_lark_nhat_ky (luc DESC);
CREATE INDEX wh_lark_nhat_ky_item_idx ON wh_lark_nhat_ky (receipt_item_id);
