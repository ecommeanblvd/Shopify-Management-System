-- Module đổi trả (CEO 27/09) — xem docs/superpowers/specs/2026-09-27-doi-tra-design.md
--
-- Module `customer_order_requests` đã có sẵn nhưng là mức ĐƠN, trong khi CX
-- theo dõi TỪNG MÓN: đo 1.414 dòng Lark trên 1.096 đơn, 224 đơn có nhiều dòng.
-- Thêm trường món vào chính bảng — một dòng = một món trả, đúng hình CX đang
-- sống; bảng con chỉ thêm một tầng cho quan hệ thực tế luôn là 1-1.
ALTER TABLE customer_order_requests
  ADD COLUMN IF NOT EXISTS rma_code text,
  ADD COLUMN IF NOT EXISTS order_line_id uuid REFERENCES shopify_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS item_value numeric(14,2),
  -- 93% yêu cầu hoàn về store credit — thiếu trường này là mất thông tin quan
  -- trọng nhất của khâu hoàn tiền.
  ADD COLUMN IF NOT EXISTS refund_to text,
  -- Đổi hàng chỉ 22/1.414 (2%): GHI NHẬN để không mất dữ liệu, chưa dựng luồng.
  ADD COLUMN IF NOT EXISTS return_category text NOT NULL DEFAULT 'refund',
  -- Lý do hai tầng, thay bộ cũ thiên về hàng lỗi (xem features/doi-tra/ly-do.ts).
  ADD COLUMN IF NOT EXISTS ly_do_chinh text,
  ADD COLUMN IF NOT EXISTS ly_do_phu text,
  -- Kho nhận hàng trả: kết quả QC và lý do không đạt.
  ADD COLUMN IF NOT EXISTS qc_ket_qua text,
  ADD COLUMN IF NOT EXISTS qc_ly_do text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp,
  -- CX nhập hộ khách (CEO 27/09) — ghi lại ai nhập để còn truy.
  ADD COLUMN IF NOT EXISTS tao_boi text;

CREATE UNIQUE INDEX IF NOT EXISTS customer_order_requests_rma_idx
  ON customer_order_requests (rma_code) WHERE rma_code IS NOT NULL;
