# Đối soát ship — "KG billed" lấy từ hoá đơn carrier (Design)

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Vấn đề

Trong module Đối soát ship, bảng có 3 cột cân: **KG Shopify**, **KG cân** (cân thực
trên cân, từ file Operation), và **KG bill**. Cột "KG bill" hiện hiển thị
`ReconcileRow.chargeableKg` = `engine.chargeableWeightKg` = `max(cân thực, dim)` +
làm tròn bậc carrier — tức số do **engine tính từ file Operation**, KHÔNG phải cân
mà đơn vị vận chuyển thực tế tính phí trên hoá đơn.

Cân carrier thật **đã có sẵn** trong DB: cột `shipment_charges.billing_weight_kg`,
được ghi khi import hoá đơn **FedEx FBO** (`source='fedex_fbo'`) hoặc **DHL invoice**
(`source='dhl_invoice'`). Nó chỉ chưa được hiển thị trong bảng đối soát.

Mục tiêu: đưa cân carrier thật vào bảng, và giữ được góc so sánh "văn phòng tính"
vs "carrier tính" (chính là giá trị của việc đối soát).

## Giải pháp (đã chốt)

Thêm MỘT cột mới **"KG carrier"** hiển thị `shipment_charges.billing_weight_kg`,
và đổi tên cột engine cũ "KG bill" → **"KG dự kiến"** để phân biệt rõ:

| Cột | Nhãn | Nguồn |
| --- | --- | --- |
| 1 | KG Shopify | `shopify_orders.ship_weight_kg` (sync Shopify) |
| 2 | KG cân | `shipments.actual_weight_kg` (file Operation) |
| 3 | KG dự kiến (đổi tên từ "KG bill") | `engine.chargeableWeightKg` = max(cân, dim) + làm tròn |
| 4 | **KG carrier (MỚI)** | `shipment_charges.billing_weight_kg` (hoá đơn FBO/DHL); `null` → "—" |

## Kiến trúc / luồng dữ liệu

`reconcile.ts` ĐÃ select từ `shipment_charges` (các cột `billedTotal`, `billedBase`,
`billedFuel`… ở khối select quanh dòng 136–151, lấy từ ĐÚNG dòng charge hoá đơn
carrier của shipment). Cân carrier thật nằm trên CÙNG dòng charge đó.

1. **Đọc:** thêm `billedWeightKg: schema.shipmentCharges.billingWeightKg` vào khối
   select sẵn có trong `reconcile.ts`. Vì lấy cùng dòng charge với `billedTotal`,
   nó luôn nhất quán với nguồn hoá đơn carrier đang dùng cho các phí billed khác.
2. **Map:** thêm `billedWeightKg: number | null` vào `interface ReconcileRow`
   (`reconcile.ts:19`), gán `billedWeightKg = num(row.billedWeightKg)` (parse numeric
   → number | null) ở chỗ dựng row (cạnh `chargeableKg` ~ dòng 511). Theo đúng
   convention parse số đang dùng cho các billed field khác.
3. **Hiển thị:** trong `ReconcileTable.tsx`:
   - Đổi nhãn cột hiện tại "KG bill" (`~dòng 264`) → "KG dự kiến" (giữ nguyên ô
     dữ liệu `r.chargeableKg` và highlight dim-overage sẵn có).
   - Thêm cột th "KG carrier" + tooltip "Cân carrier thật tính phí trên hoá đơn
     (FBO/DHL); '—' nếu chưa import hoá đơn".
   - Thêm ô td: `r.billedWeightKg === null ? '—' : r.billedWeightKg`.
4. **Làm nổi chênh lệch:** khi `billedWeightKg !== null` VÀ `chargeableKg !== null`
   VÀ hai số khác nhau → ô "KG carrier" tô amber + tooltip "carrier tính khác văn
   phòng (dự kiến X)". Tái dùng style amber sẵn có cho cột dim-overage.

## Edge cases

- Chưa import hoá đơn carrier → `billing_weight_kg` null → cột hiện "—". Không
  fallback sang số engine (không bịa).
- Shipment có nhiều `shipment_charges` (vd `ops_xlsx` + `fedex_fbo`): billed weight
  lấy từ cùng dòng charge mà `reconcile.ts` đang dùng cho `billedTotal` — tức dòng
  hoá đơn carrier. `ops_xlsx` không ghi `billing_weight_kg` nên không gây nhiễu.
- Số 0 hợp lệ vẫn hiển thị (chỉ `null` → "—").

## Phạm vi & không-trong-phạm-vi

- **Trong phạm vi:** `features/shipments/reconcile.ts` (select + ReconcileRow),
  `components/shipping-reconcile/ReconcileTable.tsx` (đổi nhãn + cột mới + highlight).
  Kiểm tra `reconcile-view.ts`/`ReconcileDetailPanel.tsx` có cần đồng bộ nhãn/field
  không (nếu detail panel cũng show cân thì thêm tương tự).
- **KHÔNG trong phạm vi:** import/parser hoá đơn (FBO/DHL) — `billing_weight_kg` đã
  được ghi sẵn, không đụng. Không đổi logic engine/quote. Không đổi schema DB.

## Test

- `reconcile.ts`: row mapping — charge có `billing_weight_kg` → `ReconcileRow.billedWeightKg`
  đúng số; charge null/không có hoá đơn → `null`.
- `ReconcileTable.tsx` (nếu có test component, nếu không → test thuần hàm format):
  cột "KG carrier" hiện số khi có; "—" khi null; tô amber khi `billedWeightKg`
  khác `chargeableKg`; nhãn cột 3 là "KG dự kiến".
