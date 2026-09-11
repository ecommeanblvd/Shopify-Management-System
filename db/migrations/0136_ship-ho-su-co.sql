-- Sự cố / lỗi phạt của đơn ship hộ (CEO 11/09/2026).
-- Ví dụ thật: giao sai địa chỉ khách → hàng hoàn về → brand phải sản xuất lại để kịp
-- tiến độ → mình mua lại món đó và ship lần hai. Một sự cố kéo theo NHIỀU khoản tiền
-- nên chi phí lưu dạng danh sách khoản (jsonb) kèm tổng đã cộng sẵn để truy vấn nhanh.
CREATE TABLE IF NOT EXISTS ship_ho_su_co (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES ship_ho_orders(id) ON DELETE CASCADE,
  loai text NOT NULL,
  -- Ai chịu trách nhiệm: noi_bo | brand | khach | hang_van_chuyen | khac.
  -- Chỉ 'noi_bo' mới tính là lỗi phạt của vị trí logistics.
  thuoc_ve text NOT NULL,
  ngay date NOT NULL,
  mo_ta text,
  -- [{ "khoan": "Cước hoàn hàng", "tienVnd": 1200000 }, ...]
  chi_phi jsonb NOT NULL DEFAULT '[]'::jsonb,
  tong_chi_phi_vnd numeric(16, 2) NOT NULL DEFAULT 0,
  da_thu_hoi_vnd numeric(16, 2) NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ship_ho_su_co_order_idx ON ship_ho_su_co (order_id);
CREATE INDEX IF NOT EXISTS ship_ho_su_co_ngay_idx ON ship_ho_su_co (ngay);
