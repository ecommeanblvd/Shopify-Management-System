-- Ngày đi hàng của đơn ship hộ (Logistic staff nhập/sửa; mặc định = ngày nhập
-- tracking). Dùng làm ngày hiệu lực fuel khi bill chưa về/thiếu ship_date.
ALTER TABLE "ship_ho_orders" ADD COLUMN "shipped_at" date;
