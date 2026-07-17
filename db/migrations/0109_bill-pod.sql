-- POD (bằng chứng giao hàng) từ bill FedEx FBO: ngày giờ giao + người ký.
-- Nguồn delivered_at chính thức, không phụ thuộc API tracking/quota.
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "pod_at" timestamp;
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "pod_name" text;
