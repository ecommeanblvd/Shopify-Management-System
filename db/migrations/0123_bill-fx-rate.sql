-- Tỉ giá quy đổi của TỪNG hoá đơn carrier.
--
-- Vì sao không dùng tỉ giá của tài khoản: bảng giá Aramex tính bằng USD nhưng
-- Hợp Nhất xuất hoá đơn bằng VNĐ, và bảng kê ghi rõ tỉ giá hãng dùng cho CHÍNH
-- kỳ đó (kỳ 25/07–22/08/2026 là 26.310). Tỉ giá tài khoản là con số hiện tại
-- (26.465) và thay đổi theo thời gian — lấy nó để đối soát hoá đơn cũ sẽ tạo ra
-- chênh lệch giả ở mọi đơn, càng lâu càng lệch.
--
-- NULL = hoá đơn không ghi tỉ giá (DHL/FedEx xuất thẳng VNĐ) → đối soát dùng
-- tỉ giá tài khoản như trước.
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(14, 4);

COMMENT ON COLUMN "carrier_bills"."fx_rate" IS
  'Tỉ giá hãng dùng cho chính hoá đơn này (1 đơn vị tiền chi phí = ? VNĐ). Đối soát các đơn thuộc hoá đơn phải quy đổi theo số này, không theo tỉ giá tài khoản.';
