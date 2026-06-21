# Cảnh báo billed chưa khớp shipment (tracking lệch) — Design

**Date:** 2026-06-21
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Đối soát ship nối **billed (hoá đơn carrier)** ↔ **shipment** ↔ **order** qua **tracking number** (INNER JOIN). Tracking trên shipment do vận hành nhập (`shipPack`). Nếu tracking nhập ở vận hành **lệch** AWB/tracking trên hoá đơn (typo/format/chưa ship-pack), thì dòng billed **không khớp shipment nào** → đơn **rớt khỏi đối soát** một cách âm thầm: ops không biết đơn nào bị thiếu.

Cần: **liệt kê các tracking trên hoá đơn carrier không khớp shipment nào** để ops sửa tracking (hoặc tạo shipment).

## Cách phát hiện (thống nhất DHL + FedEx)
Cả 2 carrier đều tạo `carrier_bill_lines` có `trackingNumber`. Dòng "billed chưa khớp" =
> `carrier_bill_lines` có `trackingNumber` (≠ null) **và KHÔNG** `shipments` nào trùng `trackingNumber`.

Dùng **LEFT JOIN `carrier_bill_lines` → `shipments` theo `trackingNumber`, lấy `shipments.id IS NULL`** — chính xác theo trạng thái thật, **không** phụ thuộc cột `carrier_bill_lines.shipmentId` (vốn chỉ DHL-reconcile set). `shipments.trackingNumber` có unique index → join 1-1 an toàn.

## Kiến trúc

### 1. Query — `features/shipments/unmatched-billed.ts` (mới)
```ts
export interface UnmatchedBilledRow {
  tracking: string;
  billNumber: string | null;
  carrierKey: string | null;       // carrier_accounts.carrierKey
  accountId: string;
  accountName: string;
  amountVnd: number | null;        // carrier_bill_lines.total (nếu có)
  billPeriodStart: string | null;  // carrier_bills.period_start
}
/** Các tracking trên hoá đơn carrier KHÔNG khớp shipment nào (đơn rớt đối soát). */
export async function listUnmatchedBilledTracking(): Promise<UnmatchedBilledRow[]>
```
- FROM `carrier_bill_lines`
  LEFT JOIN `shipments` ON `shipments.trackingNumber = carrier_bill_lines.trackingNumber`
  INNER JOIN `carrier_bills` ON `carrier_bills.id = carrier_bill_lines.billId`
  INNER JOIN `carrier_accounts` ON `carrier_accounts.id = carrier_bills.carrierAccountId`
  WHERE `carrier_bill_lines.trackingNumber IS NOT NULL` AND `shipments.id IS NULL`.
- **Distinct theo tracking**: mỗi tracking lệch xuất hiện ĐÚNG 1 dòng (DISTINCT ON `trackingNumber`, hoặc gom) — tránh đếm đôi khi 1 tracking có nhiều dòng bill. Lấy dòng `total` đại diện.
- Sắp xếp theo account rồi tracking. Map numeric (`total`) qua `Number(...)`.

### 2. Đơn vị thuần — `summariseUnmatched(rows)` (trong cùng file hoặc tách)
```ts
export interface UnmatchedSummary { total: number; byCarrier: Array<{ carrierKey: string | null; count: number; sumVnd: number }> }
export function summariseUnmatched(rows: UnmatchedBilledRow[]): UnmatchedSummary
```
- Đếm tổng + gom theo carrier (count, Σ amount). THUẦN, test được.

### 3. UI — banner/section trên trang Đối soát ship
- `app/(dashboard)/f/shipping-reconcile/page.tsx`: gọi `listUnmatchedBilledTracking()` (song song với các query hiện có), truyền xuống.
- Component `components/shipping-reconcile/UnmatchedBilledBanner.tsx` (client, collapsible):
  - Khi `rows.length > 0`: banner amber **"⚠ {n} tracking trên hoá đơn chưa khớp shipment nào — kiểm tra tracking vận hành"** + (Σ theo carrier).
  - Mở rộng → bảng: `tracking · số HĐ · carrier/account · số tiền · kỳ`.
  - Nút **"Tải CSV"** link tới route export.
  - `rows.length === 0` → không hiện gì.
- Đặt **ngay dưới header** trang Đối soát ship (trên `ReconcileTable`).

### 4. CSV export — `app/(dashboard)/f/shipping-reconcile/unmatched-billed.csv/route.ts`
- Mirror route `carrier-errors.csv`: gate `view_carrier_rates`, `force-dynamic`, dùng `csvBody`.
- Cột: `tracking, bill_number, carrier, account, amount_vnd, bill_period_start`.

## Data flow
Upload billed → `carrier_bill_lines` (có tracking). Vận hành nhập tracking → `shipments.trackingNumber`. Nếu lệch → bill line không có shipment trùng tracking → `listUnmatchedBilledTracking` bắt được → banner cảnh báo + CSV. Ops sửa tracking ở vận hành (hoặc tạo shipment) → lần render sau hết cảnh báo, đơn vào đối soát.

## Error handling / edge
- Không có dòng lệch → banner ẩn hoàn toàn.
- Tracking xuất hiện nhiều dòng bill (vd nhiều khoản phí cùng AWB) → query **distinct theo tracking** (1 dòng/tracking) nên `summariseUnmatched` chỉ cần đếm rows.
- Quyền: `view_carrier_rates` (như trang đối soát + route CSV).
- Hiệu năng: query LEFT JOIN trên bill_lines (vài nghìn dòng) — nhẹ; không nằm trong engine cache nặng, chạy song song ở page.

## Test
- `summariseUnmatched`: tổng + gom theo carrier (count, Σ); distinct tracking.
- Query + UI + CSV: integration → verify build + smoke.
- (Nếu tách logic distinct/format ra hàm thuần thì test thêm.)

## Ngoài phạm vi
- Chiều ngược (shipment chưa bị bill = bình thường).
- Tự sửa tracking / tự tạo shipment (chỉ cảnh báo, ops xử lý).
- Đụng engine đối soát / cache.
