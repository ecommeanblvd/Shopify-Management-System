-- Phân bổ tiền của MỘT dòng hoá đơn cho NHIỀU đơn hàng.
--
-- Ô "order number" trên hoá đơn hãng là chữ tự do do người nhập. Khảo sát 04/09
-- (8.060 dòng): 39 dòng ghi kiểu so-bằng-tuyệt-đối không khớp nổi — "TA2300 +
-- TA2301" (một kiện gộp hai đơn), "#MBLVD28958 (1)" (một đơn nhiều kiện) —
-- tổng 105,7 triệu, trong đó ~46 triệu không đơn nào nhận.
--
-- Không sửa thẳng cột order_number vì đó là DỮ LIỆU GỐC từ hoá đơn, phải giữ
-- nguyên để đối chiếu; phần suy diễn nằm riêng ở bảng này.
CREATE TABLE IF NOT EXISTS bill_line_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_line_id  uuid NOT NULL REFERENCES carrier_bill_lines(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  amount_vnd    numeric(14,2) NOT NULL,
  -- Cân dùng để chia (kg). NULL = đã phải chia đều vì thiếu cân.
  weight_kg     numeric(10,3),
  -- true = chia đều vì thiếu cân → cần người soát lại.
  split_even    boolean NOT NULL DEFAULT false,
  created_at    timestamp NOT NULL DEFAULT now(),
  UNIQUE (bill_line_id, order_id)
);

COMMENT ON TABLE bill_line_allocations IS
  'Chia tiền 1 dòng bill cho nhiều đơn, theo CÂN từng đơn (CEO chốt 04/09). Tổng các phần = đúng total của dòng bill.';

CREATE INDEX IF NOT EXISTS bill_line_allocations_order_idx ON bill_line_allocations (order_id);
