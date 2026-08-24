-- Đối soát tra carrier_bill_lines theo tracking/mã đơn trong vòng lặp; thiếu
-- index → seq scan toàn bảng mỗi lần (10.205 lần, 80 triệu dòng đọc → egress).
CREATE INDEX IF NOT EXISTS "carrier_bill_lines_tracking_idx" ON "carrier_bill_lines" ("tracking_number");
CREATE INDEX IF NOT EXISTS "carrier_bill_lines_order_number_idx" ON "carrier_bill_lines" ("order_number");
CREATE INDEX IF NOT EXISTS "carrier_bill_lines_return_of_idx" ON "carrier_bill_lines" ("return_of_order_id");
