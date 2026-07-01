# Chuỗi trạng thái vòng đời đơn (Sub-project B) — Design

> Phần B của "tối ưu bảng Vận hành đơn". Cột **Tình trạng** hiện luôn kẹt ở "Cần đặt brand"
> vì đọc `order_fulfillment.status` — trạng thái này rollup từ **line action kho** gần như
> không dùng. B thay bằng **stage suy ra (derive) từ các tín hiệu THẬT**.

**Ngày:** 2026-07-01 · **Phụ thuộc:** Sub-project A (auto-track → `shipments.deliveryStatus`).

## 1. Vấn đề
`order_fulfillment.status` (received→…→shipped) rollup từ `orderFulfillmentLines` — thao tác
kho thủ công gần như không chạy → mọi đơn kẹt "Cần đặt brand", không phản ánh chuỗi thật.

## 2. Cách tiếp cận
KHÔNG sửa state-machine cũ (giữ nguyên `order_fulfillment` cho phần khác). Thêm **hàm THUẦN
`deriveOrderStage(signals)`** tính stage hiển thị từ tín hiệu đã có, cắm vào bảng vận hành.
Không migration, không đụng dữ liệu.

## 3. Tín hiệu (đều đã có trong DB)
- **Đã báo brand:** `mmp_order_pushes.status = 'sent'` (join `orderId`, unique/đơn). Tin cậy.
- **KCS / brand đã gửi:** `lark_order_status.qc_status` (`pass|fail|pending|extra`). Có KCS ⇒
  brand đã gửi hàng về (không cần match `mmp_line_received` mong manh).
- **Đóng gói / vận đơn / giao:** agg `shipments` (đã auto-track ở A): `packs, withTracking,
  delivered, exception, inTransit, outForDelivery`. Cross-check `lark_order_status.dispatch_status`
  ('Delivery Completed' / 'On Delivery' / 'Return-Processing' / 'Package Lost' …).
- **Nhánh kho/brand (best-effort):** `allInStock` — mọi SKU của đơn có tồn > 0 trong
  `warehouse_inventory` (pre-agg theo sku). Kho nhập tay 611 SKU → đa số đơn = đặt brand.

## 4. `features/fulfillment/order-stage.ts` (MỚI, thuần)

```ts
export type StageKey =
  | 'awaiting_brand_order' | 'pick_warehouse' | 'brand_notified'
  | 'kcs_pending' | 'kcs_failed' | 'ready_to_pack' | 'packed'
  | 'shipped' | 'out_for_delivery' | 'delivered' | 'exception';

export interface StageSignals {
  pushedMmp: boolean;
  larkQc: string | null;        // pass|fail|pending|extra|null
  larkDispatch: string | null;  // carrier state từ Lark (fallback/cross-check)
  ship: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number; outForDelivery: number };
  allInStock: boolean;
}
export interface OrderStage { key: StageKey; label: string; tone: 'ok'|'info'|'warn'|'bad'|'muted' }
export function deriveOrderStage(s: StageSignals): OrderStage;
```

**Thứ tự ưu tiên (xa nhất trước — chặng sau ghi đè chặng trước):**
1. **delivered** — `ship.packs>0 && ship.delivered===ship.packs` **hoặc** `larkDispatch==='Delivery Completed'` → "Hoàn tất" (ok).
2. **exception** — `ship.exception>0` **hoặc** `larkDispatch` ∈ {Return-Processing, Package Lost, Delivery Attempt Failed, Cancel at Cnee Country} → "Sự cố" (bad).
3. **out_for_delivery** — `ship.outForDelivery>0` **hoặc** `larkDispatch==='On Delivery'` → "Đang giao" (info).
4. **shipped** — `ship.inTransit>0 || ship.withTracking>0` → "Đã ship · đang chuyển" (info).
5. **packed** — `ship.packs>0` → "Đã đóng gói" (info).
6. **ready_to_pack** — `larkQc==='pass'` → "Chờ đóng gói" (warn).
7. **kcs_failed** — `larkQc==='fail'` → "KCS lỗi" (bad).
8. **kcs_pending** — `larkQc ∈ {pending, extra}` → "Brand gửi · chờ KCS" (warn).
9. **brand_notified** — `pushedMmp` → "Đã báo brand" (info).
10. **pick_warehouse** — `allInStock` → "Lấy từ kho" (warn).
11. **awaiting_brand_order** — mặc định → "Chờ đặt brand" (muted).

Nhánh kho/brand (10/11) hiện ở **nhãn** stage, không cần badge riêng.

## 5. Wiring `features/fulfillment/worklist-status-queries.ts` (SỬA)
- Thêm 2 query gom (theo pattern Map sẵn có):
  - `pushedSet`: `SELECT order_id FROM mmp_order_pushes WHERE status='sent'` → Set.
  - `stockAgg`: `SELECT ol.order_id, bool_and(coalesce(wi.q,0)>0) all_in_stock FROM shopify_order_lines ol LEFT JOIN (SELECT sku, sum(qty_on_hand) q FROM warehouse_inventory GROUP BY sku) wi ON wi.sku=ol.sku GROUP BY ol.order_id` → Map.
- Thêm `outForDelivery` vào `shipAgg` (`filter (where delivery_status='out_for_delivery')`).
- Mỗi row: `stage = deriveOrderStage({...})`; thêm `stage: OrderStage` vào `WorklistStatusRow`.

## 6. UI `components/fulfillment/WorklistTable.tsx` (SỬA)
- Cột **Tình trạng** render `row.stage` (label + tone→class) thay `ORDER_STATUS_LABELS[row.status]`.
- Bộ lọc "Tất cả trạng thái" đổi sang lọc theo `stage.key` (danh sách 11 stage). Giữ nguyên các cột khác.

## 7. Testing (Vitest, thuần) — `features/fulfillment/order-stage.test.ts`
Mỗi bậc 1 case + ưu tiên: delivered thắng khi mọi kiện giao; exception; OFD; shipped (có tracking);
packed (có kiện, chưa tracking); ready_to_pack (qc pass); kcs_failed; kcs_pending; brand_notified
(pushed, chưa KCS); pick_warehouse (allInStock, chưa push); awaiting_brand_order (mặc định);
larkDispatch 'Delivery Completed' → delivered dù ship trống (fallback).

## 8. Ngoài phạm vi
- Sub-project C (phát hiện đơn sửa). Aramex delivery. Không sửa `order_fulfillment` state-machine cũ.
