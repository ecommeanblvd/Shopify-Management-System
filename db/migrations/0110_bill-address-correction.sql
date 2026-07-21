-- Phí sửa địa chỉ (Address Correction) tách cột riêng — trước gộp vào other nên
-- không hiện tên riêng trên bảng đối soát và không được áp fuel như FedEx tính.
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "address_correction" numeric(14,2);
