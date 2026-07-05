-- Chống race: mỗi đơn tối đa 1 request MỞ (double-click/retry không tạo bản ghi đôi).
CREATE UNIQUE INDEX IF NOT EXISTS customer_order_requests_one_open_idx
  ON customer_order_requests(order_id)
  WHERE status IN ('submitted','under_review','approved','return_in_transit','received','refund_pending');
