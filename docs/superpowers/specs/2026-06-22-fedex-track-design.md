# Theo dõi đơn FedEx (Track API) — hệ #4 — Design

> Sub-project #4 của chương trình vận hành đơn. #1 verify địa chỉ, #2 brand follow-up, #3 KCS
> queue đã merge. DHL Track tách riêng (làm sau khi có DHL API key).

**Ngày:** 2026-06-22
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

Đơn đã ship (có `trackingNumber`) hiện không tự cập nhật trạng thái giao. Dùng **FedEx Track
API** (tái dùng `fedexFetch` OAuth có sẵn) để cập nhật trạng thái giao (đang chuyển / đã giao /
sự cố) cho shipment FedEx, lưu trạng thái **mới nhất** (không lưu lịch sử scan).

**Phạm vi đợt này: CHỈ FedEx.** DHL chưa có API client → tách hệ sau (cần DHL API credential).

## 2. Quyết định đã chốt

- Carrier: **FedEx trước** (tái dùng `fedexFetch`; DHL sau).
- Lưu: **trạng thái mới nhất** (status + delivered_at + last_tracked_at + mô tả), KHÔNG bảng
  event history.
- Trigger: **cron hằng giờ + nút per-đơn**.

## 3. Đã có sẵn (tái dùng)

- `lib/fedex/client.ts`: `fedexFetch<T>(path, {method, json})` (OAuth token tự lo).
- `shipments`: `trackingNumber`, `carrierKey`, `labelCreatedAt`.
- Pattern cron-chain (`sync-shopify-orders.ts`) + verify-địa-chỉ (rate-limit/cap) làm mẫu.

## 4. Kiến trúc & component

### Storage — migration `0075_shipment-delivery-tracking.sql` (idx 75)
`ALTER TABLE shipments` thêm:
- `delivery_status text` (nullable) — giá trị rút gọn: `in_transit | out_for_delivery | delivered | exception | unknown`.
- `delivered_at timestamp` (nullable).
- `last_tracked_at timestamp` (nullable).
- `track_detail text` (nullable) — mô tả trạng thái mới nhất (statusByLocale/description).
+ cập nhật `db/schema.ts` (`deliveryStatus`, `deliveredAt`, `lastTrackedAt`, `trackDetail`) + journal idx 75.

### FedEx Track lib — `lib/fedex/track.ts`
- `mapFedexStatus(code: string): DeliveryStatus` — **THUẦN**: map FedEx `latestStatusDetail.code`
  → status rút gọn. (DL→delivered; OD/OF→out_for_delivery; IT/IN/AR/DP/PU→in_transit;
  DE/SE/CA→exception; còn lại→unknown.) `DeliveryStatus` = union 5 giá trị trên.
- `parseFedexTrack(raw: unknown): { statusCode: string | null; status: DeliveryStatus; description: string | null; deliveredAt: Date | null }` —
  **THUẦN**: đọc `output.completeTrackResults[0].trackResults[0]` → latestStatusDetail.code/desc
  + dateAndTimes (type ACTUAL_DELIVERY → deliveredAt). Không tìm thấy → status 'unknown'.
- `trackFedex(trackingNumber): Promise<ReturnType<parseFedexTrack>>` — `fedexFetch('/track/v1/trackingnumbers', { method:'POST', json:{ includeDetailedScans:false, trackingInfo:[{ trackingNumberInfo:{ trackingNumber } }] } })` → `parseFedexTrack`.

### Sync — `features/shipments/track.ts`
- `trackAndStoreShipment(shipmentId): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }>` —
  đọc shipment (carrierKey='fedex', có trackingNumber) → `trackFedex` → update
  `delivery_status/track_detail/delivered_at(nếu delivered)/last_tracked_at`. Không tracking/không
  phải fedex → `{ok:false, error}`.
- `trackPendingShipments(opts?: { limit?: number }): Promise<{ tracked: number; delivered: number; failed: number }>` —
  chọn shipment `carrier_key='fedex' AND tracking_number IS NOT NULL AND (delivery_status IS NULL
  OR delivery_status <> 'delivered') AND label_created_at >= now()-interval '45 days'` (đừng poll
  vô hạn), order theo `last_tracked_at` nulls first, limit (cron 100). Loop
  `trackAndStoreShipment`, **rate-limit 300ms**, lỗi per-đơn → đếm `failed`, không chặn.

### Server action + nút — `features/fulfillment/actions.ts`
- `trackShipmentAction(shipmentId): Promise<{ ok; status?; error? }>` — gate `manage_fulfillment`
  (requirePerm), gọi `trackAndStoreShipment`, revalidate trang vận hành.
- Nút client "Cập nhật vận chuyển" (`useTransition`) cạnh pack/shipment trong trang vận hành đơn.

### Cron — chain vào `scripts/cron/sync-shopify-orders.ts`
- Sau block addr-verify, thêm try/catch gọi `trackPendingShipments({ limit: 100 })`, log
  `track-fedex: tracked X, delivered Y, failed Z`.

### UI — badge trạng thái giao
- Component hiển thị `delivery_status` (đang chuyển / đã giao + ngày / sự cố / chưa rõ) trên trang
  vận hành đơn (per pack/shipment) — viền/màu theo trạng thái. Hiện `track_detail` + `last_tracked_at`.

## 5. Guard / lỗi

- Lỗi FedEx API per-đơn → catch, `{ok:false,error}` / đếm `failed`; batch không dừng. Rate-limit
  300ms. Cron cap 100 + chỉ poll đơn 45 ngày gần.
- Đơn đã `delivered` → không poll lại (điều kiện query).
- Không tracking / không phải fedex → bỏ qua (`error`), không gọi API.
- Map code lạ → `unknown` (không vỡ).

## 6. Test (TDD)

- `mapFedexStatus` (thuần): các code → status đúng; code lạ → unknown.
- `parseFedexTrack` (thuần): response thật rút gọn → status/desc/deliveredAt; thiếu field → unknown/null.
- `trackFedex`/`trackAndStoreShipment`/`trackPendingShipments`/action/cron/UI = integration (repo
  không test DB) → verify tsc/build.

## 7. Ngoài phạm vi (hệ #4 đợt này)

- **DHL Track** (cần DHL API client + credential) — hệ sau.
- Lịch sử scan (chỉ trạng thái mới nhất).
- Đẩy trạng thái giao ngược lên Shopify/MMP/Lark.
- Webhook FedEx push (chỉ poll cron + nút).
- Label (#5).
