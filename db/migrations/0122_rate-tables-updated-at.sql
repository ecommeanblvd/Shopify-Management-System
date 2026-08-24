-- Thêm dấu thời gian cho 4 bảng cấu hình cước còn thiếu, để snapshot carrier
-- biết dữ liệu có đổi hay không mà không phải đọc lại toàn bộ bảng giá.
--
-- Bối cảnh: mỗi lượt khách bấm thanh toán, callback carrier-service dựng lại
-- snapshot cho 5 carrier account, mỗi lượt ~5.000 dòng bảng giá gần như không
-- đổi. Supabase tính tiền theo egress (D-025). Cách rẻ là đệm phần tĩnh trong
-- bộ nhớ, nhưng đệm chỉ an toàn khi phát hiện được thay đổi — nếu trông vào
-- việc nhớ gọi lệnh xoá đệm ở 16 chỗ sửa dữ liệu rải rác thì sót một chỗ là
-- ops sửa giá xong vẫn thấy giá cũ.
--
-- Trigger đặt ở tầng DB, nên mọi đường ghi đều được đóng dấu: server action,
-- script nhập bảng giá, hay sửa tay bằng SQL.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "carrier_zones" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "carrier_zone_countries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "carrier_zone_postcode_ranges" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "carrier_weight_tiers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

DROP TRIGGER IF EXISTS "carrier_zones_updated_at" ON "carrier_zones";
CREATE TRIGGER "carrier_zones_updated_at" BEFORE UPDATE ON "carrier_zones"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "carrier_zone_countries_updated_at" ON "carrier_zone_countries";
CREATE TRIGGER "carrier_zone_countries_updated_at" BEFORE UPDATE ON "carrier_zone_countries"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "carrier_zone_postcode_ranges_updated_at" ON "carrier_zone_postcode_ranges";
CREATE TRIGGER "carrier_zone_postcode_ranges_updated_at" BEFORE UPDATE ON "carrier_zone_postcode_ranges"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "carrier_weight_tiers_updated_at" ON "carrier_weight_tiers";
CREATE TRIGGER "carrier_weight_tiers_updated_at" BEFORE UPDATE ON "carrier_weight_tiers"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- carrier_rate_cells đã có updated_at nhưng chỉ được app tự set; gắn trigger
-- cho chắc, để nhập bảng giá bằng script cũng đóng dấu.
DROP TRIGGER IF EXISTS "carrier_rate_cells_updated_at" ON "carrier_rate_cells";
CREATE TRIGGER "carrier_rate_cells_updated_at" BEFORE UPDATE ON "carrier_rate_cells"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
