-- Tách túi "other" của bill line thành 3 khoản minh bạch (chỉ đạo CEO 21/07:
-- không giữ khoản nào mập mờ): phí xử lý hàng NK + thuế/hải quan (duty) + khác thật.
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "import_handling" numeric(14,2);
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "duty" numeric(14,2);
