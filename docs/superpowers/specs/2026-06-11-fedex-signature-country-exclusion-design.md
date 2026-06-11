# Spec: FedEx Direct Signature — nước miễn + mốc giá đúng (mở rộng addon_fixed)

**Ngày:** 2026-06-11
**Module:** Carrier rates engine + Đối soát phí ship
**Spec nền:** [addon_fixed Direct Signature](./2026-06-11-addon-services-direct-signature-design.md) — đã ship (`3236390..359d58f`)

## 0. Rule từ operator (2026-06-11)

FedEx Direct Signature:
1. **KHÔNG áp dụng** cho 13 nước: Saudi Arabia, Qatar, Israel, Iraq, Oman,
   Kazakhstan, Jordan, Monaco, Luxembourg, Cyprus, Czech Republic, Peru, Angola
   → ISO-2: `SA, QA, IL, IQ, OM, KZ, JO, MC, LU, CY, CZ, PE, AO`.
2. **88.000đ**: 01/06/2025 → 31/12/2025.
3. **92.700đ**: trước 01/06/2025 VÀ từ 01/01/2026.

Bằng chứng dữ liệu (production, 11/06/2026):
- 756 bill FedEx tới 13 nước miễn, trong đó đúng **2 bill bị thu sai**
  (1 SA @92.700, 1 CZ @88.000) — phải nổi thành mismatch để khiếu nại.
- Không có bill nào trước 01/06/2025 (sớm nhất 01/12/2025); không có bill
  trong 01–04/01/2026 → đổi mốc 05/01 → 01/01/2026 không đổi kết quả cũ.
- DHL KHÔNG đổi (rule chỉ FedEx).

## 1. Schema (`db/schema.ts` + migration 0057)

`carrier_surcharges` thêm cột `excluded_country_codes jsonb` (NULL = không
miễn nước nào). Semantics: dòng surcharge KHÔNG áp dụng khi nước đích nằm
trong danh sách — generic cho mọi kind (đối ngẫu với `country_codes` là danh
sách BAO GỒM hiện có; một dòng có thể có cả hai, exclusion thắng).

## 2. Engine (`features/carrier-rates/engine/quote.ts`, `load.ts`)

- `SurchargeSnap` thêm `excludedCountryCodes?: string[] | null` (loader
  upper-case như `countryCodes`).
- Helper `isCountryExcluded(s, country)` = `!!s.excludedCountryCodes?.includes(country)`.
  Áp vào: tính `addons`, `addonReference`, `rowContribution` (mọi kind —
  demand/country_fixed cũng hưởng nếu sau này cần; hiện chỉ addon dùng).
- Breakdown thêm `addonExcludedForCountry: boolean` — true khi tồn tại dòng
  `addon_fixed` applicable theo NGÀY (cả always lẫn when_billed) nhưng bị
  loại bởi nước đích. Mặc định false.

## 3. Đối soát (`reconcile.ts`, `reconcile-diagnose.ts`)

- Engine row truyền thêm `addonExcludedForCountry`.
- Nhánh signature, khi `sigBilled > 0 && sigEngine === 0`:
  1. `addonExcludedForCountry === true` → cause **KHONG_KHOP** (không bao giờ
     PHI_TUY_CHON), verdict dominant-signature mới:
     `"FedEx thu Direct Signature ở nước được miễn (<ISO-2>) — khiếu nại với carrier"`,
     severity `config`. Cần nước đích trong diagnose input (đã có `shipCountry`
     trên row — truyền vào nếu chưa).
  2. Ngược lại giữ logic hiện tại (đúng bảng giá → PHI_TUY_CHON; sai giá →
     sai bảng giá; ref=0 → legacy pass-through).
- Kỳ vọng trên fleet: +2 mismatch mới (SA, CZ); các tổng tiền không đổi.

## 4. Data (script `scripts/migrate-fedex-signature-rules.ts`, dry-run/--apply)

FedEx Direct Signature từ 2 dòng hiện tại thành **3 dòng** when_billed,
fuelable=true, active=true, đều mang `excluded_country_codes` = 13 nước:

| value | starts_at | ends_at | ghi chú |
|---|---|---|---|
| 92.700 | NULL | 2025-06-01 | trước 01/06/2025 |
| 88.000 | 2025-06-01 | 2026-01-01 | 01/06→31/12/2025 |
| 92.700 | 2026-01-01 | NULL | từ 01/01/2026 |

Idempotent: UPDATE 2 dòng hiện có (88k: starts 2025-06-01/ends 2026-01-01;
92.7k: starts 2026-01-01) + INSERT dòng pre-June nếu chưa có; tất cả set
excluded list. DHL không đụng.

## 5. UI

- Trang surcharges: dòng addon có exclusions hiện text nhỏ
  `Miễn: SA, QA, …` (đếm gọn nếu dài: `Miễn 13 nước` + title đầy đủ).
- `SurchargeEditDialog`: với `addon_fixed` thêm input text "Nước miễn
  (ISO-2, phẩy)" — parse/validate ISO-2 2 ký tự, lưu mảng upper-case,
  rỗng → NULL. Persist qua create/update actions như `applyMode`.

## 6. Kiểm thử

- Engine: (a) when_billed bị miễn theo nước → `addonReference=0` +
  `addonExcludedForCountry=true`; (b) nước không thuộc danh sách → ref bình
  thường, flag false; (c) always-mode addon (DHL, không exclusions) không
  ảnh hưởng.
- Diagnose: (a) billed signature ở nước miễn → KHONG_KHOP + verdict
  "nước được miễn"; (b) nước thường giữ nguyên 3 hành vi hiện có (regression).
- Fleet verify sau --apply: đúng 2 dòng mới chuyển từ passthrough → config
  (SA + CZ), tổng tiền byte-một-byte như trước.
