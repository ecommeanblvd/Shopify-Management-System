# Đối soát ship "order-driven" — Design (mảng A)

> Sub-project A của chương trình lớn. Sub-project B (tích hợp Lark fill cân/dims/tracking
> từ vận hành) là spec riêng, làm sau khi có cấu trúc dữ liệu Lark.

**Ngày:** 2026-06-21
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

Hiện đối soát ship **driven từ `shipment_charges`** (billed): một shipment chỉ xuất hiện
sau khi hoá đơn carrier về (hàng tuần sau khi ship). Operator không thấy đơn vừa đóng gói,
và sort theo |delta| đẩy đơn mới xuống cuối.

Muốn: **shipment tự vào đối soát ngay khi kho tạo pack**, hệ thống tính **ước tính engine**
ngay sau khi có cân kho, rồi **billed fill dần** để so. Cân Shopify KHÔNG dùng để tính
(engine chỉ dùng cân kho `actualWeightKg` hoặc override) → chưa cân thì chưa có ước tính,
đơn ở trạng thái "chờ cân đo".

## 2. Quyết định đã chốt (từ brainstorm)

- **Ước tính trước khi cân?** KHÔNG. Chưa cân kho (và không có override) → không tính,
  trạng thái `chờ cân đo`. (Không fallback sang cân Shopify — cân Shopify không đáng tin.)
- **Tập đơn vào worklist?** Chỉ **đơn đã có shipment** (kho đã tạo pack). Không placeholder
  cấp đơn cho đơn chưa đóng gói.
- **Granularity:** row = **shipment** (cân/billed/tracking đều per-shipment; 79 đơn tách 2–4
  kiện). Giữ nguyên đơn vị hiện tại.
- **Tiền:** report công nợ + vòng đời claim **chỉ tính trên billed**. Ước tính engine của
  dòng tiền-billed KHÔNG vào số công nợ — chỉ để theo dõi.

## 3. Kiến trúc — lật chiều JOIN

`features/shipments/reconcile.ts` hàm dựng query (hiện ~dòng 170):

**Trước:**
```ts
.from(schema.shipmentCharges)
.innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
.innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
.innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId));
```

**Sau:**
```ts
.from(schema.shipments)
.leftJoin(schema.shipmentCharges, eq(schema.shipmentCharges.shipmentId, schema.shipments.id))
.innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
.innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId));
```

- `billedTotal`, `billedWeightKg`, các cột billed → **nullable** trong row thô.
- Billed vẫn match theo tracking như cũ (quan hệ shipment 1:1 charge qua `shipmentId`,
  unique index `shipment_charges_shipment_uniq` giữ nguyên).
- Billed không khớp shipment nào → vẫn thuộc banner "billed chưa khớp tracking" (#196),
  không đổi.
- Engine giữ nguyên (per-shipment, cân kho/override). **Không migration, không cột DB mới.**

## 4. Máy trạng thái — 2 trạng thái "tiền billed" (phái sinh)

Phái sinh trong `buildRow` / `effStatus`, KHÔNG lưu DB (giống `pending` ảo hiện tại).

| Điều kiện | Trạng thái | Hiển thị |
|---|---|---|
| billed null + chưa cân (`actualWeightKg` null & `shipWeightKgOverride` null) | `awaiting_measurement` ("chờ cân đo") | cước trống |
| billed null + đã cân (engine ra số) | `awaiting_billed` ("chờ billed") | hiện **engineTotal (ước tính)**, billed "—", delta trống |
| billed null + đã cân nhưng engine null (thiếu bảng giá/nước) | `awaiting_billed` + ghi chú lý do | như trên, ghi chú "chưa có bảng giá" |
| billed có | pending / reconciled / disputing / ignored / carrier_error / credited / accepted (như cũ) | so thật |

`ReconcileViewRow` thêm trạng thái mới vào union `ReconcileStatus`. `effStatus` trả 2 giá trị
mới khi `billedTotal == null` (ưu tiên: đã cân → `awaiting_billed`, chưa cân →
`awaiting_measurement`).

## 5. Sort / filter / summary / UI

- **Sort** (`filterReconcileRows`, đã đổi ở #200): #200 xếp **chỉ `pending`** lên nhóm đầu
  (group 0), mọi trạng thái khác group 1, trong nhóm mới-nhất-trước (theo `labelDate`).
  Mảng A **mở rộng group 0 thành `{pending, awaiting_measurement, awaiting_billed}`** — cả 3
  đều "chưa đối soát" nên lên đầu. Các trạng thái còn lại (disputing/carrier_error/
  reconciled/ignored/credited/accepted) giữ group 1 như #200.
- **Filter trạng thái:** thêm 2 mục `awaiting_measurement`, `awaiting_billed` vào dropdown.
- **Summary:** tổng billed **bỏ qua dòng billed null** (`sumBilled` chỉ cộng khi có billed);
  thêm đếm 2 trạng thái mới (vd "12 chờ cân đo · 30 chờ billed").
- **Cột billed/delta:** billed null → "—"; dòng `awaiting_billed` hiện cột engine (ước tính),
  delta trống.
- **Hành động (accept/dispute/credit/ignore):** chỉ render cho dòng **đã có billed**. Dòng
  tiền-billed không có nút thao tác (chỉ badge trạng thái chờ).
- **Filter "Lệch ≥ %":** dòng billed null có `deltaPct` null → tự loại khi bật filter (logic
  `deltaPct !== null` đã có).

## 6. Edge case

- **Số học null:** `Number(r.billedTotal)` vỡ khi null → nhánh `buildRow` cho billed null
  (không tính delta/deltaPct, vẫn chạy engine để ra ước tính nếu cân được).
- **Đã cân, thiếu bảng giá/nước:** weight có, engine null → vẫn `awaiting_billed` + ghi chú,
  KHÔNG phải lỗi/`internal_error`.
- **Report & claim không đổi:** số công nợ + vòng đời claim chỉ chạy trên billed. Dòng
  tiền-billed bị loại khỏi các truy vấn đó (chúng vốn lọc theo status billed / `delta`).
- **CSV export:** dòng tiền-billed xuất với billed/delta rỗng, có cột engine + trạng thái.

## 7. Test (TDD — chủ yếu thuần engine `reconcile.ts`)

1. Shipment KHÔNG charge + đã cân (actualWeight) → row `awaiting_billed`, `engineTotal` có
   số, `billedTotal` null, `deltaVnd` null.
2. Shipment KHÔNG charge + chưa cân (actualWeight null, override null) → `awaiting_measurement`,
   `engineTotal` null, `billedTotal` null.
3. Shipment KHÔNG charge + đã cân nhưng không có rate card → `awaiting_billed` + ghi chú
   (không `internal_error`).
4. `sumBilled` bỏ qua dòng billed null (tổng = chỉ các dòng có billed).
5. Shipment CÓ charge → giữ nguyên hành vi cũ (pending/reconciled… không đổi).
6. `filterReconcileRows`: filter `status='awaiting_billed'` chỉ trả dòng đó; sort xếp
   `awaiting_billed` vào nhóm "chưa xong" (trên nhóm reconciled).

## 8. Ngoài phạm vi (mảng A)

- Tích hợp Lark (sub-project B) — fill `actualWeightKg`/dims/tracking vào shipments từ vận
  hành. Chờ cấu trúc dữ liệu Lark.
- Tạo shipment từ đơn chưa đóng gói (placeholder cấp đơn) — đã loại theo quyết định §2.
- Đổi cách report công nợ tính tiền — giữ nguyên billed-based.
