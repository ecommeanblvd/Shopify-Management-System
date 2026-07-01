# So sánh cước carrier (Carrier Rate Comparison) — Design

**Goal:** Một bảng cross-carrier giúp vận hành chọn line ship tốt hơn: hàng = mốc cân
0.5→20kg, cột = quốc gia hay có đơn Shopify, mỗi ô liệt kê **đủ rate all-in (VND) của
mọi carrier phủ nước đó**, highlight carrier rẻ nhất kèm **% chênh** so với rẻ nhất để
thấy "tốt hơn bao nhiêu", không chỉ "ai rẻ nhất".

**Architecture:** Tái dùng engine quote thuần (`engine/quote.ts` → `quote()`) + loader
(`engine/load.ts` → `loadAccountSnapshot()`). Trang server load snapshot mọi carrier
account + top nước Shopify, một hàm thuần fan-out `quote()` cho từng (nước × cân ×
carrier) tại `effectiveDate = now()` (tự lấy fuel tuần hiện tại), quy mọi total về VND,
xếp hạng rẻ→đắt. Client chỉ render + lọc cột nước.

**Tech Stack:** Next.js App Router (RSC), Drizzle (chỉ ở loader/top-countries), engine
thuần sẵn có, Vitest.

## Global Constraints

- **All-in cost = `breakdown.carrierCost` (đơn vị cost currency của account)** — cước ta
  TRẢ carrier, đã gồm base + fuel + VAT, **KHÔNG gồm markup** (không phải giá bán khách).
- **Quy về VND** để so sánh:
  - `costCurrency === 'VND'` → dùng `breakdown.carrierCost` (đã VND: DHL, FedEx).
  - ngược lại nếu `displayCurrency === 'VND'` → dùng `breakdown.carrierCostDisplay`
    (Aramex: cost USD, display VND).
  - còn lại (không bên nào VND) → `carrierCost × 26000` (fallback USD→VND).
- **Fuel "hiện tại"**: `effectiveDate = now()` → engine tự chọn row `fuel_percent` tuần
  hiện tại (DHL/FedEx). Aramex bảng giá đã gồm xăng dầu + VAT (không có row fuel/vat) →
  engine trả đúng giá card, **không double-count**.
- **Packaging = `'bag'` (Pak)**. Engine tự fallback về giá Package khi carrier không có
  ô Pak cho tier đó (`base = pakBase ?? packageRate`) → không bao giờ "—" nhầm.
- **Lưới cân**: 0.5→20kg, bước 0.5 = **40 mốc** (chung cho cả 3 carrier).
- **Không phụ phí phụ thuộc postcode** (remote/residential) vì so ở mức "đến nước X, cân
  W" — không có địa chỉ. Demand theo **quốc gia** (FedEx `demand_per_kg` có country_codes)
  vẫn được engine tính (không cần postcode). Đây là hệ quả tự nhiên của việc gọi `quote()`
  không truyền `destinationPostcode`.
- **Top nước**: mặc định **12 nước**, cửa sổ **6 tháng**, đếm theo `shopify_orders.ship_country`.
- **Auto-carrier**: lặp mọi carrier account `active` → thêm carrier mới có zone tới nước
  đó thì tự xuất hiện trong ô, không sửa code.

---

## Components

### 1. Lưới cân — `features/carrier-rates/compare/weight-grid.ts`
Hằng số `COMPARE_WEIGHT_GRID: number[]` = `[0.5, 1, 1.5, …, 20]` (40 mốc). Pure.

### 2. Top nước — `features/carrier-rates/compare/top-countries.ts`
`topShopifyCountries(limit = 12, monthsBack = 6): Promise<{ code: string; orders: number }[]>`
— `GROUP BY ship_country` (loại NULL/rỗng), lọc `created_at > now() - monthsBack tháng`,
`ORDER BY count DESC LIMIT limit`. Trả ISO-2 upper + số đơn.

### 3. Hàm build thuần — `features/carrier-rates/compare/build-comparison.ts`
Không I/O. Nhận snapshot đã load + danh sách nước + lưới cân + `effectiveDate`, gọi
`quote()` cho từng tổ hợp.

```ts
import { quote, type CarrierAccountSnapshot } from '../engine/quote';

export interface CarrierRate {
  accountId: string;
  carrierName: string;    // snapshot.name
  vnd: number;            // all-in, đã quy VND
  cheapest: boolean;      // rẻ nhất trong ô
  pctOverCheapest: number;// 0 cho rẻ nhất; +% cho phần còn lại (làm tròn 0 dp)
}
export interface ComparisonCell { rates: CarrierRate[]; } // rỗng khi không carrier nào phủ
export interface ComparisonCube {
  countries: string[];
  weights: number[];
  // cells[country][weightKg] = ComparisonCell
  cells: Record<string, Record<number, ComparisonCell>>;
}

export function carrierCostToVnd(
  snap: Pick<CarrierAccountSnapshot, 'costCurrency' | 'displayCurrency'>,
  breakdown: { carrierCost: number; carrierCostDisplay: number },
): number;

export function buildComparison(
  snaps: CarrierAccountSnapshot[],
  countries: string[],
  weights: number[],
  effectiveDate: Date,
): ComparisonCube;
```

Với mỗi (country, weight): với mỗi snap gọi `quote(snap, { destinationCountry: country,
weightKg: weight, packagingType: 'bag', effectiveDate })`. Chỉ giữ kết quả `ok` → quy VND
qua `carrierCostToVnd`. Sắp xếp `vnd` tăng dần; phần tử đầu `cheapest = true`,
`pctOverCheapest = 0`; các phần tử sau `pctOverCheapest = round((vnd/min − 1) × 100)`.
Ô không có carrier nào `ok` → `rates: []`.

### 4. Server action/loader — `features/carrier-rates/compare/actions.ts`
`'use server'`. `getRateComparison(): Promise<{ cube; countryMeta; asOf }>`:
- Auth: `hasPermission(role, 'view_carrier_rates')`.
- `topShopifyCountries()` → nước.
- Mọi `carrierAccounts` active → `loadAccountSnapshot(id, now)` (Promise.all), bỏ null
  (account không có card hiệu lực hôm nay).
- `buildComparison(snaps, countryCodes, COMPARE_WEIGHT_GRID, now)`.
- Trả kèm `countryMeta` (code + tên hiển thị + số đơn) và `asOf` (ISO date) để UI ghi
  "cước tại thời điểm dd/MM/yyyy".

### 5. Trang — `app/(dashboard)/f/carrier-rates/compare/page.tsx`
RSC: check quyền, gọi `getRateComparison()`, render `<RateComparison … />`. Link vào từ
trang danh sách carrier-rates (nút "So sánh cước").

### 6. Client bảng — `components/carrier-rates/RateComparison.tsx`
`'use client'`. Props = cube + countryMeta + asOf. Render:
- Ô **search** lọc nhanh cột nước (theo tên/ISO-2).
- Bảng sticky: cột đầu = mốc cân; mỗi cột nước = header (cờ/tên + số đơn).
- Mỗi ô: list carrier rẻ→đắt; rẻ nhất **đậm + nền xanh + ✓**; còn lại `tên  VND  +x%`.
  Ô rỗng → "—".
- Định dạng VND: `Intl.NumberFormat('vi-VN')`, rút gọn "k"/"tr" cho gọn nếu cần.

## Data flow
Shopify orders → top nước · carrier accounts → snapshots. `(snapshots, nước, cân, now)`
→ `buildComparison` → cube → trang → client (lọc/hiển thị). Không ghi DB. Chỉ đọc.

## Error handling
- Không carrier nào có card hiệu lực → trang hiện empty-state "chưa có bảng giá hiệu lực".
- Nước không đơn nào → không xuất hiện (top rỗng → empty-state).
- `quote()` trả error cho 1 tổ hợp → bỏ carrier đó khỏi ô (không phá cả bảng).

## Testing (Vitest, thuần)
`features/carrier-rates/compare/build-comparison.test.ts`:
1. Quy VND đúng: account cost=VND dùng `carrierCost`; account display=VND (cost USD) dùng
   `carrierCostDisplay`; fallback ×26000.
2. Xếp hạng + cờ `cheapest` + `pctOverCheapest` (rẻ nhất 0, kế +x% đúng công thức).
3. Carrier `quote()` lỗi (nước không zone) → không nằm trong ô; nếu tất cả lỗi → `rates: []`.
4. Aramex-style (không row fuel/vat) → VND = giá card quy đổi, không cộng thêm.

`weight-grid.ts`: 40 phần tử, đầu 0.5, cuối 20, bước 0.5.
