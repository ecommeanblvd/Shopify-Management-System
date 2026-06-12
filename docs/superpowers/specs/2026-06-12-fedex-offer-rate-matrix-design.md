# Spec: Sinh giá ship FedEx vào ma trận market (offer Shopify)

**Ngày:** 2026-06-12
**Module:** Markets (`/f/markets`) + carrier-rates engine
**Specs nền:** carrier-rates engine (quote), markets shipping (market-shipping domain)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-12)

Cần bảng giá ship weight-based để offer trên Shopify, cover đủ chi phí FedEx.
Ma trận zone **đã có sẵn**: `market_store_overrides.shipping.zones`, mỗi zone tên
`"<Region> — DHL <d> / FedEx <f>"` (gắn rõ cả 2 carrier zone), rates theo **59 bậc
cân 0.5kg** ("FedEx IP (a–b kg)"), tiền USD. Hiện chỉ **middle-east** cấu hình
(3 zone); giá đang **cũ/thiếu** (tính trước khi signature thành always-apply).

Quyết định:
1. **Giá offer = `(carrierCostDisplay + $5) × markupFactor`**, làm tròn **lên $0.5**.
   - `carrierCostDisplay`: cost trần engine (base+fuel+demand+signature+VAT; US thêm
     import handling; remote KHÔNG gộp), tiền USD.
   - `$5` = packing/ops fee cố định (PACKING_FEE).
   - `markupFactor` = `finalDisplay/carrierCostDisplay` của engine (= 1 + markup% đã
     cấu hình, hiện **15%**). $5 cũng được markup (chốt operator).
2. Trong 1 shipping-zone có nhiều nước cùng FedEx zone nhưng demand/signature khác →
   **max giá trên các nước thuộc zone** ⇒ luôn cover.
3. **Ghi thẳng vào ma trận** `market_store_overrides.shipping` (qua script), rồi luồng
   **apply markets** sẵn có đẩy lên Shopify. GIỮ nguyên rates DHL đã có; chỉ tính/cập
   nhật **FedEx IP** (DHL = follow-up cùng cơ chế).

## 1. Hàm giá thuần (`features/markets/domain/fedex-offer-pricing.ts`, TDD)

```
fedexOfferPrice(perCountryFinalAndCost[], packingFeeUsd, roundUpUsd) → number
```
- Input: với mỗi nước trong zone, cặp `{ carrierCostDisplay, finalDisplay }` (USD) do
  engine quote ở 1 bậc cân.
- Mỗi nước: `priceCty = (carrierCostDisplay + packingFeeUsd) × (finalDisplay/carrierCostDisplay)`.
  (Khi carrierCostDisplay=0 → bỏ nước đó.)
- Trả `roundUp(max(priceCty), roundUpUsd)` — làm tròn LÊN bội số `roundUpUsd` ($0.5).
- Hằng số: `PACKING_FEE_USD = 5`, `ROUND_UP_USD = 0.5` (export, chỉnh dễ).

Tách thuần để test: max-over-countries, công thức +fee×markup, làm tròn lên.

## 2. Dựng cấu trúc zone per market (`features/markets/.../build-fedex-zones.ts` hoặc trong script)

Cho mỗi market (`market_templates.countries`):
- Map mỗi nước → (FedEx zone label qua `carrier_zone_countries`, DHL zone label tương tự).
- Gom nước theo cặp **(fedexZone, dhlZone)** → 1 shipping-zone:
  - tên: `"<MarketName> — DHL <dhlZoneNum> / FedEx <fedexZoneLetter>"` (đúng quy ước
    middle-east; trích số/chữ zone từ label "Zone 9"/"Zone H").
  - `countries`: danh sách nước thuộc cặp đó.
- Bỏ nước không map được FedEx zone (vd domestic VN) — ghi log.

## 3. Bậc cân & quote

- **Nguồn bậc CHUẨN = bộ 59 key "FedEx IP (...)" có sẵn** trong shipping config
  middle-east — tránh tự render sai en-dash/số. Đọc các key đó, parse upper-bound `b`
  từ mỗi key (số sau dấu "–", trước "kg"); đó là weightKg để quote. (Tier
  `carrier_weight_tiers` dùng để đối chiếu/đảm bảo đủ 59 bậc.) Mọi zone (cả 11 market)
  dùng CHUNG bộ key này.
- Với mỗi (shipping-zone, bậc b): quote từng nước thuộc zone ở `weightKg = b`
  (chargeable ceil sẵn về b), lấy `carrierCostDisplay`+`finalDisplay` → `fedexOfferPrice`.
- `effectiveDate` = now (fuel/markup hiện hành). Snapshot load 1 lần.

## 4. Script ghi ma trận (`scripts/gen-fedex-offer-matrix.ts`, dry-run/--apply)

- Tham số: `--store <handle|id>` (mặc định store đang có config middle-east) — vì
  `shipping` ở `market_store_overrides` theo (store, market).
- Cho mỗi market của store: dựng zones (§2) + rates FedEx IP (§3). **Merge** vào
  `shipping.zones` hiện có: zone đã tồn → cập nhật/đè key `"FedEx IP (...)"`, GIỮ key
  DHL; zone mới → tạo với chỉ rates FedEx. Ghi `market_store_overrides.shipping`
  (bump version), trong transaction.
- Dry-run in: số market × zone × bậc sẽ ghi; vài giá mẫu (Zone H 0.5kg ≈ $51.00) so
  giá cũ. Idempotent (chạy lại cho cùng kết quả).
- KHÔNG tự apply lên Shopify — operator dùng trang `/f/markets` apply như thường.

## 5. Kiểm thử (TDD)
- `fedex-offer-pricing`: (a) max-over-countries; (b) (cost+5)×factor; (c) làm tròn lên
  $0.5; (d) carrierCostDisplay=0 bị loại; (e) 1 nước.
- Dựng zone: gom đúng theo (fedex,dhl); tên đúng format; bỏ nước no-zone.
- Script: dry-run không ghi; verify Zone H 0.5kg ≈ $51.00; đếm market/zone/bậc; merge
  GIỮ key DHL cũ (middle-east DHL rates không mất).

## 6. Ngoài phạm vi
- **DHL rates**: follow-up (cùng cơ chế, engine DHL + markup, key "DHL (a–b kg)").
- Không tự push Shopify (dùng luồng apply markets sẵn có).
- Remote-area buffer: không gộp (markup 15% + $5 đệm phần nào).
- Không làm UI "refresh matrix" đợt này (script đủ; UI là mở rộng sau).
