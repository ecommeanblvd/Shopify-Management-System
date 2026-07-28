-- Zone theo DẢI BƯU CHÍNH trong 1 nước (FedEx VN chart: China South = Zone K —
-- Phúc Kiến 350000-369999, Quảng Đông 510000-529999; CN còn lại = Zone W).
-- Engine match dải trước, không match → zone quốc gia (carrier_zone_countries).
CREATE TABLE "carrier_zone_postcode_ranges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "carrier_account_id" uuid NOT NULL REFERENCES "carrier_accounts"("id") ON DELETE CASCADE,
  "carrier_zone_id" uuid NOT NULL REFERENCES "carrier_zones"("id") ON DELETE CASCADE,
  "country_code" text NOT NULL,
  "range_start" integer NOT NULL,
  "range_end" integer NOT NULL,
  "note" text
);
CREATE INDEX "carrier_zone_postcode_ranges_account_idx" ON "carrier_zone_postcode_ranges" ("carrier_account_id");

-- Seed Zone K (China South) cho account FedEx theo đúng zone chart INECSO 2026.
INSERT INTO "carrier_zone_postcode_ranges" (carrier_account_id, carrier_zone_id, country_code, range_start, range_end, note)
SELECT z.carrier_account_id, z.id, 'CN', v.s, v.e, v.note
FROM carrier_zones z
JOIN carrier_accounts a ON a.id = z.carrier_account_id
JOIN carriers c ON c.id = a.carrier_id
CROSS JOIN (VALUES
  (350000, 369999, 'Fujian (Phúc Kiến)'),
  (510000, 529999, 'Guangdong (Quảng Đông)')
) AS v(s, e, note)
WHERE c.key = 'fedex' AND z.label = 'Zone K';
