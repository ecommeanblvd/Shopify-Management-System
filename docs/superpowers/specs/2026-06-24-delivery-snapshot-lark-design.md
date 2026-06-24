# Snapshot trạng thái giao từ Lark (freeze vào shipments) — Design

> Cột Vận chuyển hiện "Chưa cập nhật" dù Lark đã có trạng thái giao + ngày giao thật. FedEx tracking
> hết hạn/tái dùng sau ~3 tháng nên không dựa hẳn vào poll live được. Lấy trạng thái giao từ Lark
> (nguồn chính, không hết hạn) + freeze vĩnh viễn vào `shipments`.

**Ngày:** 2026-06-24
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/delivery-snapshot-lark`

## 1. Bối cảnh

`shipments.delivery_status` hiện chỉ đến từ FedEx track API (`trackPendingShipments`: FedEx-only, label
≤45 ngày, 100 đơn/giờ). Nhiều đơn `delivery_status=null` ("Chưa cập nhật") vì poll không kịp/quá hạn —
trong khi Lark đã có "Final | Delivery Status" + "Ngày giao thực tế". FedEx tracking number tái dùng sau
~3 tháng → poll số cũ không tin cậy; cap 45 ngày hiện tại đã nằm trong cửa sổ an toàn (không poll số tái
dùng). Giải pháp: Lark là nguồn delivered chính, freeze vào `shipments` để không phụ thuộc số tracking
còn sống.

## 2. Quyết định đã chốt

- Nguồn delivered = **Lark chính + FedEx bổ sung** (giữ FedEx poll 45d cap cho real-time đang-giao).
- Freeze vào **`shipments`** (per-pack, theo `order_id`) — đúng mô hình snapshot "khi gắn tracking → khi nhận".
- `delivered` **sticky**: không ghi đè delivered đã có (cả FedEx lẫn Lark đều không hạ cấp).
- Cột Vận chuyển đọc `shipments.delivery_status` như cũ (tự hiện "Đã giao"); thêm ngày giao "Đã giao · dd/MM".

## 3. Mapping Lark "Final | Delivery Status" → DeliveryStatus

| Giá trị Lark | DeliveryStatus |
|---|---|
| Chậm hơn dự kiến · Đúng dự kiến · Nhanh hơn dự kiến | `delivered` |
| Đang giao hàng | `out_for_delivery` |
| Đang xử lý | `in_transit` |
| Giao hàng thất bại · Gặp vấn đề · Mất hàng khi giao | `exception` |
| (khác/rỗng) | `null` (không đụng) |

`DeliveryStatus` = union ở `lib/fedex/track.ts:3` (`in_transit|out_for_delivery|delivered|exception|unknown`).
"Ngày giao thực tế" (epoch ms) → `actualDeliveredAt` (VN-date, như các field date Lark khác).

## 4. Components

### 4.1 `features/lark/parse-status-row.ts` (mở rộng, THUẦN + test)
- `mapLarkDelivery(raw: string | null): DeliveryStatus | null` — map bảng §3.
- Đọc "Ngày giao thực tế" → `actualDeliveredAt: Date | null` (dùng lại `larkEpochToVnMidnight`; non-số→null).
- `LarkStatusRow` thêm `deliveryState: DeliveryStatus | null` (= `mapLarkDelivery(raw 'Final | Delivery Status')`) và `actualDeliveredAt: Date | null`. (Giữ `deliveryStatus` text thô hiện có cho cột LARK.)

### 4.2 Migration `0079`
- `shipments` thêm `delivery_source text` (nullable): 'lark' | 'fedex' | null — provenance.
- `0079_shipment-delivery-source.sql`: `ALTER TABLE "shipments" ADD COLUMN "delivery_source" text;`
- Journal idx 78 → **79**.
- `db/schema.ts`: `shipments` thêm `deliverySource: text('delivery_source')`.

### 4.3 `features/lark/sync.ts` (mở rộng)
- Trong vòng gom status per đơn (đã có), gom thêm `deliveryState` + `actualDeliveredAt` theo `orderId`
  (ghi đè có điều kiện: delivered thắng; record sau bù record trước thiếu).
- Freeze: với mỗi đơn có `deliveryState`, update các shipment của đơn (chunk 200/tx):
  ```sql
  UPDATE shipments
  SET delivery_status = <deliveryState>,
      delivered_at = <actualDeliveredAt nếu deliveryState='delivered' và delivered_at đang null, else giữ>,
      delivery_source = 'lark', updated_at = now()
  WHERE order_id = <orderId>
    AND (delivery_status IS NULL OR delivery_status <> 'delivered')
  ```
  (Drizzle: dùng `eq(order_id)` + `or(isNull, ne('delivered'))`. `delivered_at` chỉ set khi delivered và đang null — không đè delivered_at thật của FedEx.)
- Đếm `deliveryFrozen: number` vào `LarkSyncSummary`.
- Best-effort: nằm trong cùng cron Lark; lỗi phần này không chặn logistics (đặt trong try/catch giống QC block).

### 4.4 `features/shipments/track.ts` (1 dòng)
- Trong `trackAndStoreShipment`, khi FedEx ghi, set `deliverySource: 'fedex'` (đối xứng provenance). Không đổi logic poll/cap.

### 4.5 `worklist-status-queries.ts` + `WorklistTable.tsx`
- `shipAgg` json_agg thêm `deliveredAt` per tracking (`delivered_at`).
- `ship.tracks` item thêm `deliveredAt: string | null`.
- `WorklistTable`: chip Vận chuyển — khi `deliveryStatus='delivered'` và có `deliveredAt`, nhãn "Đã giao · dd/MM" (tái dùng `formatTrackingStatus` cho tone + ghép ngày bằng helper cắt chuỗi `dd/MM`). Các trạng thái khác giữ như Task QC-KCS.

## 5. Guard / lỗi

- Freeze chỉ set khi shipment chưa `delivered` → không hạ cấp/đè delivered thật.
- `delivered_at` Lark chỉ điền khi đang null → giữ ngày FedEx nếu đã có.
- Lark delivery rỗng/không map được → không đụng shipment.
- Phần freeze trong try/catch best-effort — không chặn sync logistics/QC.
- FedEx tái dùng số: cap 45 ngày sẵn có đã an toàn; không thêm gì.

## 6. Test (TDD)

- `mapLarkDelivery` (thuần): mọi nhánh §3 + rỗng/lạ→null.
- `actualDeliveredAt` parse: epoch→VN-date; non-số→null.
- freeze SQL / sync / query json_agg / UI chip = integration → verify tsc/vitest/build.

## 7. Ngoài phạm vi

- Bỏ FedEx poll (giữ bổ sung).
- Ghi ngược Lark (one-way).
- Đổi cron schedule / throughput FedEx poll.
- Sửa 3 file WIP user (Orders-address follow-up).
- Freeze delivered_at per-pack chính xác khi đơn giao tách kiện (dùng ngày order-level — chấp nhận).
