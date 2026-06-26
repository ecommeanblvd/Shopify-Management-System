# Thêm carrier Aramex (qua Hợp Nhất) vào hệ thống — Design

> Carrier mới: **Aramex**, chạy qua công ty **Hợp Nhất (HNC)**, line ship là Aramex. Có bảng giá HN & HCM
> (HN đắt hơn ≤ $0.88/đơn theo offset cố định theo nước). Đưa vào hệ thống để nhận diện đơn Aramex +
> tính engine estimate. Dùng **bảng HN**. Giá USD (đã gồm fuel+VAT), hiển thị VND @ 26.000.

**Ngày:** 2026-06-26
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/aramex-carrier`

## 1. Bối cảnh

Hệ thống đã có model carrier-rates tổng quát (spec 2026-05-25): `carriers` (key dhl/fedex) → `carrierAccounts` → `carrierZones` → `carrierZoneCountries` → `carrierWeightTiers` → `carrierRateCards` → `carrierRateCells`. Engine `engine/quote.ts` + `engine/load.ts` tính estimate theo account. Reconcile so billed (từ carrier bill) vs estimate.

Hạn chế hiện tại chặn Aramex:
- Nhận diện carrier (`parse-pack-row.normalizeCourier`, `detect-carrier.detectCarrierKey`) chỉ map fedex/dhl; "Aramex" → cảnh báo "carrier lạ".
- Kiểu `CarrierKey`/union `'fedex'|'dhl'` rải rác.
- `reconcile.ts` có allowlist cứng: `if (a.key !== 'fedex' && a.key !== 'dhl') continue` → bỏ qua account khác.
- `fxCostPerDisplay` numeric(14,4): công thức engine `display = cost / fx`, fx = "số cost-unit cho 1 display-unit". Cost=USD/display=VND cần fx=1/26000≈0.0000384615 → scale 4 không chứa nổi.

## 2. Quyết định đã chốt

- Dùng **bảng HN** (1 bảng; HN ≥ HCM ≤$0.88, an toàn). Không làm offset/HCM.
- Tiền: **cost=USD, display=VND**, fx = 1/26000 ≈ 0.0000384615 → **migration mở rộng `fx_cost_per_display` → numeric(20,10)**.
- Tỷ giá 26000 (chỉnh sau trong quản lý account, không cần code).
- Phạm vi cân: **≤ 20kg** (bậc 0.5). >20kg per-kg ("Call") → no estimate.
- **Mỗi nước = 1 zone** (20 nước trong ma trận; Syria chỉ ở header per-kg → bỏ v1).
- Giá đã gồm fuel+VAT → **không surcharge** (cell = giá all-in).
- Bill import Aramex/Hợp Nhất: **ngoài phạm vi** (làm sau khi có mẫu bill).

## 3. Components

### 3.1 Migration `drizzle/0080_aramex-carrier.sql` (hand-authored)
- `ALTER TABLE carrier_accounts ALTER COLUMN fx_cost_per_display TYPE numeric(20,10);` (an toàn: 26000.0000 → 26000.0000000000).
- `INSERT INTO carriers (key, name) VALUES ('aramex', 'Aramex (Hợp Nhất)') ON CONFLICT (key) DO NOTHING;`
- KHÔNG seed account/zones/tiers/cells trong SQL (làm ở module TS §3.4 cho dễ kiểm chứng + idempotent).

### 3.2 Nhận diện carrier (code + test)
- `features/lark/parse-pack-row.ts` `normalizeCourier`: thêm `if (s.includes('aramex')) return 'aramex';`. Kiểu `PackRow.carrierKey` + return type thêm `'aramex'`.
- `features/shopify-orders/sync/detect-carrier.ts`: `CarrierKey` thêm `'aramex'`; thêm nhánh `if (/\baramex\b/.test(haystack)) return 'aramex';`.
- Cập nhật các nơi union `'fedex'|'dhl'` cần mở rộng để tsc xanh (vd `reconcile.ts:110`, `reconcile-view`, chỗ tiêu thụ `carrierKey`). Plan liệt kê chính xác qua `tsc`.

### 3.3 Reconcile engine (`features/shipments/reconcile.ts`)
- Đổi allowlist `a.key !== 'fedex' && a.key !== 'dhl'` → thêm `'aramex'` (cho phép account aramex vào reconcile/estimate).
- Mở rộng kiểu `carrierKey?: 'fedex'|'dhl'` → thêm `'aramex'`.

### 3.4 Seed dữ liệu Aramex (`features/carrier-rates/import/aramex-hn-2025.ts` mới + action chạy 1 lần)
Idempotent (chạy lại không nhân đôi — check tồn tại theo key/label). Tạo:
- **Account** (carrier aramex): name "Aramex HN (Hợp Nhất)", weightUnit kg, costCurrency 'USD', displayCurrency 'VND', fxCostPerDisplay '0.0000384615' (=1/26000), dimDivisorCm3PerKg 5000, chargeableRoundingKg NULL (tiers 0.5 tự ceil), enabled true.
- **Zones**: 1 zone/nước (label = tên nước), `position` theo thứ tự bảng.
- **Zone-countries**: ISO-2 code mỗi nước (BH, BD, EG, JO, KW, ZA, QA, SA, AE, CH, OM, US, SG, JP, CN, HK, TW, TH, IN, ID) — khớp định dạng code `carrier_zone_countries.country_code` đang dùng (plan xác nhận theo dhl-2025-zones).
- **Weight tiers**: upperKg 0.5, 1.0, …, 20.0 (40 bậc), position tăng dần.
- **Rate card**: label "Aramex HN 2025-10", effectiveFrom '2025-10-01', effectiveTo NULL (card mở).
- **Rate cells**: packageType 'package', costAmount = giá HN (USD) cho mỗi (zone, tier). ~800 ô.
- **Độ chính xác:** trích số từ PDF (dùng `pdftotext`/`import/pdf-text.ts`) → bảng số có cấu trúc; KHÔNG gõ tay 800 số nếu tránh được. Test spot-check vài ô đã biết; reviewer cuối đối chiếu toàn bộ với PDF.

### 3.5 Chạy seed
- Theo pattern dhl-2025 (plan kiểm cách dhl-2025 được kích hoạt: action admin hoặc script). Aramex seed chạy 1 lần sau deploy (migration tạo carrier row + mở fx; seed tạo account/zones/tiers/card/cells).

## 4. Guard / lỗi

- Đơn carrier "aramex" chưa có account/card phủ ngày → engine trả no-estimate như carrier khác (không vỡ).
- >20kg → không có tier → no estimate (đúng "Call").
- fx precision: migration không đổi giá trị DHL/FedEx (26000 giữ nguyên).
- Seed idempotent: chạy lại không tạo trùng (unique theo carrier key, account name, zone label, tier upperKg, card label, cell unique index).
- Country code không khớp zone → đơn nước đó no-estimate (cảnh báo), không vỡ.

## 5. Test (TDD)

- `normalizeCourier`/`detectCarrierKey`: "Aramex", "aramex delivery" → 'aramex'; giữ fedex/dhl; lạ → null.
- Engine quote (thuần qua `engine/quote.ts`): 1 mẫu Aramex — vd cân 1.0kg đi Japan, cost $19.72 → display VND = round(19.72 / (1/26000)) = 512.720 VND; cân 0.7kg → tier 1.0 (ceil 0.5). Kiểm cost→display dùng fx mới.
- Seed (integration): sau seed, load account → có 20 zone, 40 tier, card mở, ô mẫu đúng.
- Migration + reconcile allowlist + types = verify `tsc`/`vitest`/`build`.

## 6. Ngoài phạm vi

- Import hoá đơn Aramex/Hợp Nhất (định dạng bill chưa có) → reconcile billed side sau.
- >20kg per-kg ("Call").
- Bảng HCM + model offset (chỉ dùng HN).
- Tự động đổi tỷ giá (chỉnh tay trong quản lý account).
