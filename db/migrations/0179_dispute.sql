-- Module Dispute Management (CEO duyệt 27/09) — xem docs/superpowers/specs/2026-09-27-dispute-design.md
--
-- Hai nửa khác hẳn nhau trong một bảng:
--   nguon='shopify' → sync từ shopifyPaymentsAccount.disputes, Shopify là nguồn đúng
--   nguon='tay'     → CX nhập, vì dispute PayPal/Stripe nằm trong dashboard riêng
--
-- KHÔNG có cột tổng tiền. Bảng Lark cộng USD + EUR + GBP + HKD + CAD + KRW vào
-- một cột `Total Amount Lost` rồi báo 108.565,54 — con số vô nghĩa. Mọi số tiền
-- ở đây luôn đi kèm đơn vị, và việc gom do features/dispute/tong-tien.ts làm.
--
-- Các cột phân loại để TEXT, không enum: Shopify thêm trạng thái/lý do mới không
-- được phép cần migration. Kiểm ở features/dispute/chuan-hoa.ts, có unit test.

CREATE TABLE IF NOT EXISTS dispute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nguon text NOT NULL DEFAULT 'tay',
  -- Cổng thanh toán: ca sync luôn là 'shopify_payments' (shopifyPaymentsAccount
  -- chỉ trả dispute của chính nó); ca nhập tay là 'paypal'/'stripe'. Lark ghi
  -- `Stripes` và `Stripes mới` là cùng một cổng — xem chuan-hoa.ts.
  cong_thanh_toan text NOT NULL,
  -- Khoá upsert của sync. NULL với ca nhập tay, nên UNIQUE (Postgres cho phép
  -- nhiều NULL) vừa chặn trùng bản sync vừa không cản ca nhập tay.
  shopify_dispute_id text UNIQUE,

  -- ── Shopify sở hữu: mỗi lượt sync GHI ĐÈ các cột này.
  loai text NOT NULL DEFAULT 'chargeback',
  trang_thai text NOT NULL,
  ly_do text,
  -- Mã lý do của tổ chức thẻ (F29, 13.1, 4853…) — Lark không có, dùng để tra
  -- đúng điều khoản khi soạn bằng chứng.
  ly_do_mang text,
  so_tien numeric(14,2) NOT NULL,
  tien_te text NOT NULL,
  mo_luc timestamp,
  han_nop timestamp,
  da_nop_luc timestamp,
  chot_luc timestamp,

  -- ── CX sở hữu: sync KHÔNG BAO GIỜ chạm các cột này.
  ma_ho_so text,
  phi_dispute numeric(14,2),
  order_id uuid REFERENCES shopify_orders(id) ON DELETE SET NULL,
  -- Giữ chuỗi mã đơn KỂ CẢ khi không nối được: chỉ 53/189 ca của Lark khớp đơn
  -- trong hệ thống, phần còn lại là đơn 2023 chưa sync mà CX vẫn cần tra.
  ma_don text,
  khach_email text,

  lark_record_id text UNIQUE,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  dong_bo_luc timestamp
);
CREATE INDEX IF NOT EXISTS dispute_trang_thai_idx ON dispute(trang_thai);
CREATE INDEX IF NOT EXISTS dispute_han_nop_idx ON dispute(han_nop);
CREATE INDEX IF NOT EXISTS dispute_store_idx ON dispute(store_id);
CREATE INDEX IF NOT EXISTS dispute_ma_don_idx ON dispute(ma_don);

-- Ghi chú append-only. Lark dồn mọi diễn biến vào một ô `Following up` (80% dòng
-- có nội dung) nên không biết ai ghi lúc nào.
CREATE TABLE IF NOT EXISTS dispute_ghi_chu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES dispute(id) ON DELETE CASCADE,
  noi_dung text NOT NULL,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  -- Nội dung mang từ ô `Following up` của Lark sang, không phải người gõ trong
  -- hệ thống — tách ra để không nhận vơ là việc làm trên hệ thống.
  tu_lark boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispute_ghi_chu_idx ON dispute_ghi_chu(dispute_id, created_at);

-- Bảng đã được tạo trước khi bổ sung cột này; ALTER để áp được cả hai chiều.
ALTER TABLE dispute ADD COLUMN IF NOT EXISTS cong_thanh_toan text;
UPDATE dispute SET cong_thanh_toan = 'shopify_payments'
  WHERE cong_thanh_toan IS NULL AND nguon = 'shopify';
UPDATE dispute SET cong_thanh_toan = 'paypal' WHERE cong_thanh_toan IS NULL;
ALTER TABLE dispute ALTER COLUMN cong_thanh_toan SET NOT NULL;
CREATE INDEX IF NOT EXISTS dispute_cong_idx ON dispute(cong_thanh_toan);
