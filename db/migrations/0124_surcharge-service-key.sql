-- Đánh dấu dòng phụ phí nào là DỊCH VỤ ta tự chọn theo lô, để engine bật/tắt
-- riêng nó mà không đụng các phụ phí khác.
--
-- Vì sao cần: phí ký nhận (Direct Signature) là always với hàng ta tự vận hành
-- (MEAN BLVD / Mirer / Tinh) nhưng ship hộ thì tuỳ brand chọn. Trước đây chỉ có
-- một cờ `signatureOptIn` dùng chung, mà cờ đó mở TOÀN BỘ phụ phí when_billed
-- (phí sai địa chỉ UPS 1.973.060đ, cụm pallet Aramex $766) nên không dùng để
-- tắt riêng ký nhận được.
ALTER TABLE carrier_surcharges ADD COLUMN IF NOT EXISTS service_key text;

COMMENT ON COLUMN carrier_surcharges.service_key IS
  'Khoá dịch vụ tuỳ chọn theo lô (vd direct_signature). NULL = phụ phí thường, luôn theo apply_mode.';

-- Backfill: mọi dòng ký nhận của FedEx và DHL (gồm cả dòng lịch sử) — nhận
-- diện theo note, đây là các dòng addon_fixed duy nhất mang tên Direct Signature.
UPDATE carrier_surcharges s
SET service_key = 'direct_signature'
FROM carrier_accounts a
WHERE a.id = s.carrier_account_id
  AND s.kind = 'addon_fixed'
  AND s.note ILIKE '%direct signature%'
  AND (a.name ILIKE '%FedEx%' OR a.name ILIKE '%DHL%');

CREATE INDEX IF NOT EXISTS carrier_surcharges_service_key_idx
  ON carrier_surcharges (service_key) WHERE service_key IS NOT NULL;
