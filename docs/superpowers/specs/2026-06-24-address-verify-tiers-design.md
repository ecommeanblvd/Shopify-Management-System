# Verify địa chỉ US — 4 mức tin cậy + US Census (miễn phí) — Design

> Giảm báo động giả cho địa chỉ US hợp lệ mà FedEx không DPV-xác nhận được (điển hình: nhà mới xây).
> Thêm nguồn verify thứ 2 miễn phí (US Census Geocoder). Không đổi semantics `addrDeliverable`
> (reconcile vẫn đọc nguyên).

**Ngày:** 2026-06-24
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/address-verify-tiers`

## 1. Bối cảnh & vấn đề

Logic hiện tại: địa chỉ **US** mà FedEx không trả DPV/Resolved/Matched → `addrDeliverable=false` →
nhãn đỏ "Không giao được". Đúng cho địa chỉ sai, nhưng cũng "dính" địa chỉ **thật & giao được**
mà FedEx (dựa USPS DPV) chưa có — điển hình **nhà mới xây** ở vùng tăng trưởng nhanh (vd
`28014 Harper Meadow Lane, Fulshear, TX 77441`: Google Maps có, FedEx trả `STANDARDIZED.ADDRESS.NOTFOUND`
nhưng vẫn chuẩn hoá được tới ZIP `FULSHEAR, TX, 77441`).

Mục tiêu: (a) phân biệt "chưa xác minh số nhà nhưng ZIP hợp lệ" với "thật sự không giao được";
(b) thêm nguồn verify thứ 2 **miễn phí** — US Census Geocoder (free, không API key) — để nâng tin
cậy cho nhà mới xây mà Census đã có.

## 2. Quyết định đã chốt

- **4 mức** `addrConfidence` thay cho hiển thị nhị phân.
- Thêm cột mới `addr_confidence` (text, migration **0077**); **GIỮ NGUYÊN** `addr_deliverable`
  (= "FedEx DPV xác nhận") để reconcile không đổi hành vi.
- Nguồn verify thứ 2 = **US Census Geocoder** (chỉ US, best-effort, free, không key).
- Census **chỉ gọi** khi đơn US và FedEx chưa xác nhận (`zip_only`/`undeliverable`) — tiết kiệm + lịch sự.
- Census **timeout 4s** (AbortController); lỗi/timeout/không khớp → giữ tier FedEx, không ném.
- Row cũ (`addrConfidence` null) → UI/list fallback về boolean `addrDeliverable` như hiện tại; re-verify
  dần qua cron/nút sẽ điền `addrConfidence`.

## 3. Mô hình 4 trạng thái

| `addrConfidence` | Điều kiện | Nhãn UI | Màu |
|---|---|---|---|
| `verified` | FedEx positive (DPV‖Resolved‖Matched) **hoặc** đơn ngoài US | ✓ Giao được | xanh |
| `census_verified` | US + FedEx không positive **nhưng** Census khớp ≥1 | ✓ Xác nhận qua Census | xanh |
| `zip_only` | US + FedEx không positive, standardized có ZIP hợp lệ, Census không khớp/không gọi được | ⚠ Chưa xác minh số nhà (ZIP hợp lệ) | vàng |
| `undeliverable` | US + FedEx không positive **và** không có ZIP hợp lệ trong standardized (không khớp gì) | ⚠ Không giao được | đỏ |

`addrDeliverable` (boolean) vẫn = FedEx positive (true) / không positive (false) / null — KHÔNG đổi.
Census **không** đổi `addrDeliverable` (chỉ đổi `addrConfidence`), để reconcile ổn định.

## 4. Luồng dữ liệu

```
verifyAndStoreOrderAddress(orderId)
  └─ FedEx resolve ─ parseAddressVerification(raw, country)
        → { classification, deliverable, issue, standardized, confidence: 'verified'|'zip_only'|'undeliverable' }
  └─ nếu country=US AND confidence ∈ {zip_only, undeliverable}:
        Census geocodeOneLine(oneLine)  (best-effort, 4s)
          ├─ khớp ≥1 → addrConfidence='census_verified'; addrStandardized = Census matchedAddress
          └─ không khớp/lỗi → addrConfidence = confidence (FedEx)
     ngược lại: addrConfidence = confidence (FedEx)   // verified, hoặc non-US
  └─ lưu: addrConfidence, addrDeliverable (FedEx positive), addrIssue, addrStandardized, addrClass, addrVerifiedAt
```

## 5. Components (mỗi unit 1 trách nhiệm)

### 5.1 `lib/census/client.ts` (mới)
- `buildCensusUrl(oneLine: string): string` — thuần. `GET .../geocoder/locations/onelineaddress?address={enc}&benchmark=Public_AR_Current&format=json`.
- `parseCensusMatch(raw: unknown): { matched: boolean; matchedAddress: string | null }` — thuần; đọc `result.addressMatches[0].matchedAddress`; rỗng → `{matched:false, matchedAddress:null}`.
- `geocodeOneLine(oneLine: string): Promise<{ matched: boolean; matchedAddress: string | null }>` — fetch + AbortController 4s; bất kỳ lỗi/timeout → `{matched:false, matchedAddress:null}` (best-effort, không ném).

### 5.2 `lib/fedex/address.ts` (mở rộng)
- `AddressVerification` thêm `confidence: 'verified' | 'zip_only' | 'undeliverable'`.
- `parseAddressVerification(raw, countryCode?)`:
  - `verified` khi `positive` **hoặc** `!isUs`.
  - US + không positive: `zip_only` nếu standardized có **postalCode hợp lệ** (resolvedAddress.postalCode không rỗng); ngược lại `undeliverable`.
  - Giữ `deliverable`/`issue`/`standardized` như hiện tại (không đổi nhành vi cũ; chỉ THÊM field).

### 5.3 `features/shopify-orders/address-verify.ts` (mở rộng)
- Thêm helper `buildOneLine(o)` (thuần): `[address1, address2].join(' ') + ', ' + city + ', ' + province + ' ' + postcode`.
- Trong `verifyAndStoreOrderAddress`: sau FedEx, áp luồng §4; tính `addrConfidence` cuối; lưu cột mới.
- `verifyUnverifiedAddresses` (batch/cron) đi qua cùng lõi → tự có Census cho subset US fail.

### 5.4 `db/schema.ts` + migration `0077` (hand-authored)
- `shopifyOrders` thêm `addrConfidence: text('addr_confidence')`.
- Migration `0077_addr-confidence.sql`: `ALTER TABLE "shopify_orders" ADD COLUMN "addr_confidence" text;`
- Journal: latest idx 76 → **next 0077** (`0077_addr-confidence`).

### 5.5 `components/fulfillment/AddressVerifyCard.tsx` (mở rộng)
- Nhãn từ `addrConfidence` theo bảng §3 (xanh/vàng/đỏ). Card border đỏ chỉ khi `undeliverable`.
- Row cũ (`addrConfidence` null) → fallback nhãn boolean như hiện tại.
- `FulfillmentAddress` thêm `addrConfidence: string | null`.

### 5.6 `features/fulfillment/worklist-status.ts` + query (mở rộng)
- `summarizeAddr` nhận thêm `addrConfidence` → trả 4 tone: `verified`/`census_verified`→ok(✓ giao được), `zip_only`→warn(⚠ ZIP hợp lệ), `undeliverable`→bad(⚠ không giao được). `addrConfidence` null → fallback logic boolean cũ (deliverable=false→bad, true→ok, chưa verify→muted).
- `worklist-status-queries.ts` + `getFulfillmentDetail`/`order-actions` select thêm `addrConfidence`.

## 6. Guard / lỗi

- Census best-effort: lỗi/timeout/không khớp → giữ tier FedEx; không bao giờ làm fail verify hay vỡ trang.
- Census **chỉ** gọi cho US + chỉ khi FedEx chưa xác nhận → tránh gọi thừa cho địa chỉ tốt/ngoài US.
- Census new-construction có thể cũng thiếu → khi đó ra `zip_only` (vàng) — vẫn tốt hơn đỏ.
- `addrConfidence` null (đơn chưa re-verify) → UI/list giữ hành vi cũ; không vỡ.

## 7. Test (TDD)

- `buildCensusUrl` / `parseCensusMatch` (thuần): có match / rỗng / raw lỗi.
- `parseAddressVerification.confidence` (thuần): US positive→verified; US notfound+ZIP→zip_only; US no-ZIP→undeliverable; non-US→verified.
- `summarizeAddr` (thuần): 4 tier + fallback null.
- `geocodeOneLine` / orchestration / UI = integration → verify `tsc` + `vitest` + `build` xanh.

## 8. Ngoài phạm vi

- Đổi semantics/giá trị `addrDeliverable` (giữ nguyên cho reconcile).
- Google/Nominatim (đã chọn Census; thêm nguồn khác để sau nếu cần).
- Tự re-verify hàng loạt ngay (để cron/nút điền dần `addrConfidence`).
- Lưu toạ độ Census / map preview (YAGNI — chỉ cần matched address text).
