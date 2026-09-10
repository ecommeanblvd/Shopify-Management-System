-- Credit note carrier: trước đây chỉ lưu SỐ hoá đơn trên shipment_reconcile_status, KHÔNG có ngày, nên "tiền thu hồi
-- trong tháng" của KPI Pillar 3 phải cộng theo ngày ops bấm ghi nhận — sai với thực tế kế toán.
-- CEO 10/09/2026 chốt: một hoá đơn VAT là MỘT credit note, tiền thu hồi cộng theo NGÀY HOÁ ĐƠN.
CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_hoa_don text NOT NULL,
  ky_hieu text NOT NULL,
  ngay date NOT NULL,
  carrier_key text,
  truoc_thue numeric(16, 2) NOT NULL DEFAULT 0,
  tien_thue numeric(16, 2) NOT NULL DEFAULT 0,
  tong_cong numeric(16, 2) NOT NULL,
  ma_tham_chieu jsonb NOT NULL DEFAULT '[]'::jsonb,
  noi_dung text,
  ten_file text,
  imported_by text REFERENCES "user"(id) ON DELETE SET NULL,
  imported_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_so_ky_unique UNIQUE (ky_hieu, so_hoa_don)
);--> statement-breakpoint
CREATE INDEX credit_notes_ngay_idx ON credit_notes (ngay);--> statement-breakpoint
-- Chi tiết từng kiện trong ĐỢT điều chỉnh (đọc từ CSV DHL). Dùng để truy đơn nào được hoàn, KHÔNG dùng để cộng tiền
-- (tiền lấy từ tổng trên hoá đơn VAT) vì một đợt điều chỉnh có thể trải trên nhiều hoá đơn VAT.
CREATE TABLE credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  tracking_number text,
  order_number text,
  shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
  original_invoice text,
  invoice_number text,
  ship_date date,
  weight_kg numeric(10, 3),
  total_incl_vat numeric(16, 2) NOT NULL DEFAULT 0
);--> statement-breakpoint
CREATE INDEX credit_note_lines_note_idx ON credit_note_lines (credit_note_id);--> statement-breakpoint
CREATE INDEX credit_note_lines_shipment_idx ON credit_note_lines (shipment_id);
