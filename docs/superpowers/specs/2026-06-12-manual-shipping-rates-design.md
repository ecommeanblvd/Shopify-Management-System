# Spec: Manual Shipping rates (Functions hub) — xem ma trận + apply backup

**Ngày:** 2026-06-12
**Module:** Functions hub (`/f/functions`) + Markets (tái dùng)
**Specs nền:** market-shipping (offer matrix), markets apply (runMarketsApply / executeMarketsApply)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-12)

Bảng giá ship offer (weight-based flat rate theo zone) hiện nằm trong
`market_store_overrides.shipping`, quản lý ở **Markets**, apply → Shopify delivery
profile (flat rates). Đây CHÍNH là "manual shipping rates" — backup khi carrier
API (FedEx/DHL) gãy. Cần **mặt riêng trong Functions hub** để xem nhanh & apply
khi khẩn cấp.

Quyết định (operator chốt):
1. **Dùng chung data Markets** — không tạo storage mới; trang là mặt xem + apply
   trên cùng `market_store_overrides.shipping`.
2. **Phạm vi: xem ma trận + apply cho store** (1-click). KHÔNG regenerate, KHÔNG
   sửa tay (sinh giá vẫn dùng script `gen-fedex-offer-matrix`).
3. **Vị trí: trang riêng trong Functions hub** `/f/functions/manual-shipping-rates`
   (ops page thường, KHÔNG phải storefront FunctionManifest) + 1 card trên
   `/f/functions`.
4. **Apply tái dùng `executeMarketsApply`** (đẩy toàn bộ cấu hình market của store,
   gồm flat rates) — operator chấp nhận để khỏi viết lại luồng apply.

## 1. Helper thuần (`features/markets/domain/shipping-matrix-view.ts`, TDD)

Làm phẳng ma trận để render bảng + dễ test:
```ts
import type { MarketShipping } from '../types';
export interface RateRow { label: string; price: number; currency: string; }
export interface ZoneView { zoneName: string; countries: string[]; rates: RateRow[]; }
/** Phẳng hoá shipping → list zone, mỗi zone list rate (sắp theo cận trên bậc cân). */
export function flattenShippingMatrix(shipping: MarketShipping | null): ZoneView[];
```
- `null`/không zone → `[]`.
- Zone: giữ thứ tự key (Object.entries). Rate trong zone: **sắp theo cận trên kg**
  trích từ label (regex `/–\s*([\d.]+)\s*kg/`, en-dash); label không khớp → đẩy
  cuối (giữ thứ tự gốc). `countries` từ `zone.countries`.

## 2. Component bảng (`components/functions/ShippingMatrixTable.tsx`)

Server component (không tương tác) nhận `zones: ZoneView[]` + render bảng:
- Mỗi zone: tiêu đề `zoneName` + danh sách nước (chip nhỏ); bảng 2 cột
  `Bậc cân (label) | Giá` (fmt theo currency, vd `$54.50`). Rỗng → dòng "Chưa có
  giá cho market này".

## 3. Trang (`app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`)

Server component:
- Auth: session + `hasPermission(role, 'view_markets_history')` (xem). Không có →
  Forbidden (pattern như các trang khác).
- Load `stores` (đã kết nối). Chọn store qua `?store=<id>` (mặc định store đầu).
- Với store chọn: `listOverridesForStore(storeId)` → mỗi override có `shipping`;
  `flattenShippingMatrix(o.shipping)` → render `ShippingMatrixTable` theo từng
  market (heading = `marketHandle`).
- **Store selector**: link-tab các store (như pattern warehouse tabs) đổi `?store=`.
- **Apply backup**: nếu `hasPermission(role, 'apply_markets')`, render
  `<ApplyModal stores={[...]} onPreview onApply />` (tái dùng nguyên component
  markets) với 2 server-action wrapper:
  ```ts
  async function preview(storeId: string) { 'use server'; const r = await previewMarketsApply(storeId); return { ops: r.ops }; }
  async function apply(storeId: string) { 'use server'; const r = await executeMarketsApply(storeId, s.user.id); return { errors: r.kind === 'applied' ? r.errors : [] }; }
  ```
  (Khớp ĐÚNG pattern `/f/markets/apply/page.tsx`: cả `preview`/`apply` re-check
  session, `apply` map `r.kind === 'applied' ? r.errors : []`.)
- Banner cảnh báo: *"Đây là giá flat backup — apply sẽ đẩy toàn bộ cấu hình market
  của store lên Shopify (gồm flat rates). Dùng khi carrier API FedEx/DHL gãy."*

## 4. Card trong Functions hub (`app/(dashboard)/f/functions/page.tsx`)

- Thêm **1 section/card riêng** (TÁCH khỏi lưới storefront FUNCTIONS) — vì manual
  rates không phải storefront function (không embed/endpoint).
- Card: icon `Truck`, tiêu đề "Manual Shipping rates", mô tả "Bảng giá ship flat
  backup — apply khi carrier API gãy", link `/f/functions/manual-shipping-rates`.
- Chỉ hiện khi `hasPermission(role, 'view_markets_history')`.

## 5. Kiểm thử (TDD)
- `shipping-matrix-view.test.ts`: (a) null/rỗng → []; (b) nhiều zone giữ thứ tự;
  (c) rate sắp theo cận trên kg (0.5 < 1 < 2…); (d) label không khớp regex đẩy cuối;
  (e) countries truyền đúng.
- UI/page/card: không unit test; tsc + eslint + build sạch; tái dùng action/
  ApplyModal đã test.

## 6. Ngoài phạm vi
- Không regenerate/sửa giá trong UI (dùng script `gen-fedex-offer-matrix`).
- Không apply shipping-only (tái dùng executeMarketsApply đẩy cả market).
- Không thêm storefront endpoint / FunctionManifest registry.
- Không đụng engine/đối soát.
