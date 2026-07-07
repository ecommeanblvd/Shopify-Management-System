# Ship-hộ FedEx: Direct Signature opt-in + Residential auto-detect — Design

**Goal:** Estimate ship-hộ MMP (FedEx) tính đúng 2 phụ phí hãng thực bill: (A) Direct
Signature theo lựa chọn của brand (nội bộ luôn tính khi có thể), (B) Residential
phát hiện tự động qua FedEx Address Validation API. Kết quả: giá ước tính khớp bill
FedEx, và gửi đúng thông tin (nhà dân / có ký nhận) cho khách ship-hộ.

**Bối cảnh (đã xác minh trong codebase):**
- Estimate ship-hộ: `features/ship-ho/brand-estimate.ts` gọi `quote()` nhưng KHÔNG
  truyền `isResidential` / `signatureOptIn` → residential luôn = 0 (thiếu), DS chỉ
  vào tổng nhờ 1 dòng `apply_mode='always'`.
- Engine `features/carrier-rates/engine/quote.ts` ĐÃ hỗ trợ 2 cờ `isResidential` và
  `signatureOptIn` + `addon_fixed apply_mode='when_billed'`. KHÔNG cần đổi engine.
- `lib/fedex/client.ts` ĐÃ có OAuth2 client_credentials + token cache + `fedexFetch`,
  thiết kế sẵn cho "Rate, Track, **Address Validation**, Ship".
- Env FedEx (`FEDEX_CLIENT_ID/SECRET/ACCOUNT_NUMBER/API_BASE=apis.fedex.com`) ĐÃ set
  trên Railway prod.
- Phí FedEx (prod): `residential_fixed = 84.400₫` scope `country_codes=['US','CA']`;
  Direct Signature `addon_fixed = 92.700₫`, dòng hiện hành `apply_mode='always'`.

## Scope & Decomposition

Hai component ĐỘC LẬP, deploy tách rời. Thứ tự: **B trước** (giá trị cao, sửa đúng
lỗi thiếu phí, rủi ro thấp — chỉ thêm 1 API call + cắm cờ), rồi **A** (đụng nhiều
nơi quote nội bộ).

Điểm cắm chung: `brand-estimate.ts` truyền `isResidential` + `signatureOptIn` vào
`quote()`. Không đổi engine.

## Global Constraints

- KHÔNG hard-code khoá FedEx — chỉ đọc từ env (đã có `lib/fedex/client.ts`).
- KHÔNG sửa engine `quote.ts` (2 cờ đã đủ).
- Phí residential giữ scope hiện tại **US/CA** (theo `residential_fixed.country_codes`);
  mở rộng nước khác là việc riêng, ngoài phạm vi.
- Fallback phải AN TOÀN theo hướng "không đối soát thiếu": lỗi API residential →
  coi như nhà dân (cộng phí).
- Tiền: mọi thay đổi phí phải có test + verify trên prod trước khi chốt.

---

## Component B — Residential auto-detect (FedEx Address Validation)

### B.1 Module gọi API — `lib/fedex/address-validation.ts`

```ts
export type FedexAddressClassification = 'RESIDENTIAL' | 'BUSINESS' | 'MIXED' | 'UNKNOWN';

export interface AddressInput {
  streetLines: string[]; city?: string; stateOrProvinceCode?: string;
  postalCode?: string; countryCode: string; // ISO-2
}

/** Gọi POST /address/v1/addresses/resolve; trả classification của địa chỉ đầu.
 *  Ném lỗi khi FedEx trả non-2xx (caller quyết fallback). */
export async function resolveAddressClassification(addr: AddressInput): Promise<FedexAddressClassification>;
```

- Body: `{ addressesToValidate: [{ address: { streetLines, city, stateOrProvinceCode, postalCode, countryCode } }] }`.
- Đọc `output.resolvedAddresses[0].classification` (FedEx trả đúng 4 giá trị trên).
- Thuần I/O; parse-classification tách hàm thuần để test.

### B.2 Map classification → isResidential (hàm thuần, có test)

```ts
export function isResidentialFromClassification(c: FedexAddressClassification): boolean {
  return c !== 'BUSINESS'; // RES + MIXED + UNKNOWN → true (chốt với CEO)
}
```

### B.3 Tích hợp vào `brand-estimate.ts`

- CHỈ gọi khi `country ∈ RESIDENTIAL_FEE_COUNTRIES` (= `['US','CA']`, khớp scope phí)
  VÀ địa chỉ đủ tối thiểu (street + postcode). Nước khác: bỏ qua, `isResidential=false`.
- Cache theo địa chỉ chuẩn hoá (`street|city|state|zip|country` upper/trim) trong
  vòng đời request/短-lived để estimate re-fire không gọi lặp.
- Fallback: `resolveAddressClassification` ném lỗi / timeout → `isResidential=true`
  (cộng phí, không đối soát thiếu) + `console.warn` (không chặn estimate).
- Truyền `isResidential` vào `quote()`. `b.residential` (84.400 × factor) nay vào
  `surchargesVnd` như các phụ phí khác (chịu fuel+VAT ở computeBrandCharge).

### B.4 Gửi thông tin cho khách

- `BrandEstimate.notes` thêm dòng khi `isResidential`:
  `'Địa chỉ nhà dân (residential) — đã gồm phụ phí giao nhà dân của hãng.'`
- (UI form MMP hiển thị notes sẵn — không cần đổi UI cho B.)

### B.5 Error handling / edge

- Địa chỉ thiếu (chưa nhập postcode) → chưa gọi API, `isResidential=false` tạm; khi
  đủ field, estimate re-fire sẽ gọi.
- FedEx OAuth lỗi (env sai) → fallback true + warn; không vỡ estimate.

---

## Component A — Direct Signature opt-in (nội bộ always / ship-hộ chọn)

### A.1 Data: đổi dòng DS `always` → `when_billed`

- Dòng `addon_fixed 92.700` hiện `apply_mode='always'` → đổi `'when_billed'`.
- Sau đổi, engine chỉ cộng DS khi caller truyền `signatureOptIn=true`.
- Script cập nhật DB (idempotent) + verify.

### A.2 Config nước có DS — `FEDEX_DIRECT_SIGNATURE_COUNTRIES`

- Allowlist tĩnh (constant trong code). FedEx KHÔNG công bố list sạch ("60+ nước, tự
  cập nhật") → seed từ thị trường shop đang ship có DS: `US, CA, GB, EU-27, AU, NZ,
  JP, KR, SG, HK, TW, ...` — operator review/sửa dễ. Dễ chỉnh 1 dòng khi cần.
- Hàm thuần `countrySupportsDirectSignature(iso): boolean`.

### A.3 Plumbing `signatureOptIn` theo NGỮ CẢNH

Quy tắc chung tại mỗi caller: `signatureOptIn = wantDS && countrySupportsDirectSignature(country)`.

- **Ship-hộ** (`brand-estimate.ts`): `wantDS = <checkbox brand chọn>` (mặc định false).
- **Nội bộ** (luôn tính khi có thể): `wantDS = true`. Các nơi cần set:
  - `features/carrier-rates/compare/build-comparison.ts`
  - `features/carrier-rates/checkout-rates.ts`
  - `features/shopify-orders/sync/resolve-shipping-estimate.ts`
  - `features/shopify-orders/sync/batch-shipping-estimator.ts`
  - `features/carrier-rates/push/recalc.ts`
  - `features/ship-ho/quote-adapter.ts` (nếu là đường nội bộ)
  - `reconcile.ts`: ĐÃ tự suy `signatureOptIn` từ bill → KHÔNG đụng.
- **Audit bắt buộc:** mỗi caller trên phải review để không rớt DS nội bộ (đây là rủi
  ro chính của A). Plan liệt kê từng file + hành vi trước/sau.

### A.4 Form MMP — nút gạt DS

- Thêm toggle "Yêu cầu ký nhận (Direct Signature) +92.700₫", CHỈ hiện khi
  `countrySupportsDirectSignature(destCountry)`.
- Tick → estimate request kèm `signatureOptIn=true` → `brand-estimate.ts` truyền vào quote.
- `EstimateParcel` thêm field `directSignature?: boolean`.

### A.5 Error handling / edge

- Nước không có DS: toggle ẩn; dù request có cờ vẫn bị gate `countrySupports…` chặn.
- DS chỉ áp cho `express` (FedEx) — service `standard` chưa có, không hiện.

---

## Testing

- **B:** unit `isResidentialFromClassification` (4 giá trị); unit parse classification
  từ payload FedEx mẫu; test tích hợp brand-estimate với mock resolver (RES→cộng,
  BUSINESS→không, lỗi→fallback cộng); verify prod bằng địa chỉ thật (nhà dân vs commercial).
- **A:** unit `countrySupportsDirectSignature`; unit gate `signatureOptIn = wantDS && supported`;
  test brand-estimate DS on/off; verify từng caller nội bộ giữ DS (so sánh trước/sau);
  verify prod dòng DS đã `when_billed`.
- Full `npx tsc --noEmit` + `npx vitest run` xanh trước mỗi push (theo quy tắc repo).

## Deploy

- B và A: mỗi cái 1 commit + verify prod riêng (data DS đổi qua script + railway run).
- Env FedEx đã có — không cần thêm gì để B chạy.

## Open items (chốt lúc implement)

- Danh sách `FEDEX_DIRECT_SIGNATURE_COUNTRIES` cụ thể: seed + operator review.
- Có mở phí residential ra ngoài US/CA không (ngoài scope hiện tại) — hỏi sau nếu cần.
