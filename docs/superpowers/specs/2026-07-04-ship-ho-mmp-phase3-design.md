# Ship hộ Phase 3 — Tích hợp 2 chiều SMS ⇄ MMP (webhook + partner-requests + backfill)

**Ngày:** 2026-07-04
**Trạng thái:** Đã duyệt thiết kế

## Bối cảnh

MMP đã build xong phía brand (đăng ký + tạo đơn + nhận cập nhật trạng thái) và tích hợp thật với 2 API
đã có (`estimate` §2, `orders` §3). Contract: `docs/integrations/mmp-ship-ho-api.md`. Phần còn thiếu phía SMS
để chạy 2 chiều gồm 3 sub-project độc lập (build theo thứ tự ưu tiên MMP):

- **A. Webhook sender (SMS→MMP)** — đẩy cập nhật vòng đời đơn cho brand xem tiến độ/giá cuối. **Ưu tiên #1.**
- **B. Partner-requests receiver (MMP→SMS)** — nhận đăng ký dịch vụ của brand chưa duyệt → MEAN duyệt tự động.
- **C. Backfill GET** — MMP đồng bộ bù khi lỡ webhook. Ưu tiên thấp.

## Hạ tầng chung (tái dùng)

- Ký **SMS→MMP** bằng `signMmpPayload(secret, ts, rawBody)` (đã có, ký `${ts}.${rawBody}`) + secret `MMP_OUTBOUND_SECRET`
  (giá trị = secret MMP dùng để verify). Header `x-mean-signature: sha256=<hex>` + `x-mean-timestamp`.
- Verify **MMP→SMS** bằng `verifyMmpSignature` + `MMP_WEBHOOK_SECRET` (đọc `rawBody` text trước khi parse).
- Env mới: `MMP_SHIP_HO_WEBHOOK_URL` = `https://web-production-bb145.up.railway.app/ship-ho/order-updates` (prod).
- Outbox + cron retry theo pattern `mmpOrderPushes` / `retry-mmp-orders` hiện có.
- Số tiền VND nguyên đồng; thời gian ISO8601. **Giữ trung tính** (không tên hãng) trong mọi payload gửi brand.

---

## A. Webhook sender (SMS → MMP)

### A1. DB — outbox `ship_ho_order_events`

```sql
CREATE TYPE "ship_ho_event_status" AS ENUM('pending','delivered','failed');
CREATE TABLE "ship_ho_order_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "ship_ho_orders"("id"),
  "mmp_ref" text NOT NULL,
  "code" text NOT NULL,
  "event" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "payload" jsonb NOT NULL,            -- envelope.data
  "delivery_status" "ship_ho_event_status" NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_attempt_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "ship_ho_order_events_delivery_idx" ON "ship_ho_order_events" ("delivery_status");
CREATE INDEX "ship_ho_order_events_order_idx" ON "ship_ho_order_events" ("order_id");
```
Schema Drizzle tương ứng. `occurred_at` = thời điểm phát; MMP dedupe theo `(mmp_ref, event, occurred_at)`.

### A2. Emit helper — `features/ship-ho/mmp-events.ts`

```ts
export type ShipHoEvent =
  | 'order.received' | 'order.accepted' | 'order.priced' | 'order.needs_info'
  | 'order.rejected' | 'order.cancelled' | 'order.reconciled'
  | 'shipment.booked' | 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception';

/** Ghi 1 event vào outbox — CHỈ khi đơn là brand-created (source='mmp' + có mmp_ref). No-op nếu không. */
export async function emitShipHoEvent(
  order: { id: string; code: string; source: string; mmpRef: string | null },
  event: ShipHoEvent, data: Record<string, unknown>,
): Promise<void>;
```
- Bỏ qua đơn nội bộ (`source !== 'mmp'` hoặc `mmpRef == null`) — không ghi outbox.
- Ghi row `pending`. Gọi best-effort ngay `deliverShipHoEvent(row)` (không chặn action nếu MMP lỗi; cron sẽ retry).

### A3. Điểm phát (wire vào action hiện có)

| Trigger (code) | Event | `data` |
|---|---|---|
| `intakeBrandOrder` (sau insert) | `order.received` | `{ chargedVnd }` (giá dự kiến) |
| `requoteShipHoOrder` (đơn mmp) | `order.priced` | `{ pricedVnd, vsEstimateVnd? }` |
| `setShipHoTracking` (gán tracking) | `shipment.booked` | `{ trackingNumber, service, estimatedDeliveryAt? }` |
| `trackAndStoreShipHo` (deliveryStatus) | `shipment.in_transit` / `shipment.delivered` | in_transit: `{}`; delivered: `{ deliveredAt, podUrl? }` |
| reconcile (`actualCarrierCostVnd` set) | `order.reconciled` | `{ finalChargedVnd, currency:'VND', vsEstimateVnd? }` |
| Nút MEAN "Từ chối" (mới) | `order.rejected` | `{ reason }` |
| Nút MEAN "Cần bổ sung" (mới) | `order.needs_info` | `{ reason, requiredFields? }` |

- Map delivery status → event thuần: `delivered` → `shipment.delivered`; các trạng thái đang giao khác → `shipment.in_transit`; lỗi/exception (nếu provider trả) → `shipment.exception`. Hàm thuần `deliveryStatusToEvent(status)` test riêng.
- **Nút MEAN tối thiểu** (trang chi tiết `f/ship-ho/[id]`): "Từ chối" (nhập lý do) + "Cần bổ sung thông tin" (lý do + field) — chỉ hiện với đơn `source='mmp'`. Set trạng thái/ghi chú nội bộ + emit event.

### A4. Giao + retry

- `deliverShipHoEvent(event)` — build envelope `{ event, mmpRef, code, occurredAt, data }`, `signMmpPayload` + POST `MMP_SHIP_HO_WEBHOOK_URL`. `2xx` → `delivered`; khác → `attempts+1`, `last_error`, giữ `pending` (hoặc `failed` sau N lần).
- Cron mới `app/api/cron/retry-ship-ho-events` (Bearer `CRON_SECRET`) → `retryPendingShipHoEvents()` lấy các `pending`, redeliver. Đăng ký lịch như cron khác.
- Idempotent phía MMP theo `(mmpRef, event, occurredAt)` — retry an toàn.

---

## B. Partner-requests receiver (MMP → SMS)

### B1. DB — `ship_ho_partner_requests`

```sql
CREATE TYPE "ship_ho_partner_request_status" AS ENUM('pending','approved','rejected');
CREATE TABLE "ship_ho_partner_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_slug" text NOT NULL,
  "contact_name" text, "contact_email" text, "contact_phone" text,
  "status" "ship_ho_partner_request_status" NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,          -- toàn bộ body đăng ký (giữ nguyên, khỏi đổi schema khi MMP thêm field)
  "review_note" text, "reviewed_by" text, "reviewed_at" timestamp,
  "callback_sent_at" timestamp, "callback_error" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "ship_ho_partner_requests_status_idx" ON "ship_ho_partner_requests" ("status");
CREATE INDEX "ship_ho_partner_requests_brand_idx" ON "ship_ho_partner_requests" ("brand_slug");
```
`id` = `ref` trả về MMP. Cột lõi (`brand_slug`, contact, status) + `payload jsonb` cho phần còn lại.

### B2. Endpoint — `POST /api/mmp/ship-ho/partner-requests`

- HMAC vào (`MMP_WEBHOOK_SECRET`). Bắt buộc `brandSlug`; phần còn lại lưu vào `payload`.
- Dedupe: nếu đã có request `status='pending'` cùng `brand_slug` → trả `ref` cũ (không tạo trùng).
- Insert `pending` → `200 { ok:true, ref }`. Lỗi → `{ code }` non-200.

### B3. MEAN review — trang `f/ship-ho/partner-requests`

- List request `pending` + xem chi tiết (`payload`).
- **Duyệt**: nhập `markupPercent` (validate ≥ 30 qua `markupFloorError`) → upsert `ship_ho_partners` cho brand (`self_service_enabled=true`, `status='active'`, markup) → set request `approved` (+ reviewer/note) → emit callback `partner.request.approved`.
- **Từ chối**: nhập lý do → set request `rejected` → emit callback `partner.request.rejected`.
- Link "Đăng ký ship hộ" từ danh sách partner + badge số request pending.

### B4. Callback partner request → MMP

- Gửi tới cùng receiver MMP (`MMP_SHIP_HO_WEBHOOK_URL`, ký như A) event `partner.request.approved` / `partner.request.rejected`, envelope `{ event, brandSlug, ref, occurredAt, data:{ note? } }`.
- **Best-effort** (không cần outbox riêng — volume thấp): gửi ngay khi duyệt/từ chối, lưu kết quả gửi (`callback_sent_at` / `callback_error` trên request). Nếu lỗi → nút **"Gửi lại callback"** trên dòng request để MEAN re-send. Reuse `signMmpPayload` + POST như A4 (không đưa vào cron retry).

---

## C. Backfill GET (SMS)

### C1. `GET /api/mmp/ship-ho/orders?updatedSince=<ISO8601>&brandSlug=`

- HMAC vào; **GET ký body rỗng**: `signature = HMAC(secret, "${ts}.")` (rawBody = `""`). Verify tương ứng.
- Trả list đơn `source='mmp'` (lọc `brandSlug` nếu có) cập nhật sau `updatedSince`, mỗi đơn kèm trạng thái + data mới nhất theo shape §2a (code, mmpRef, status, trackingNumber?, finalChargedVnd?, deliveredAt?…). Giới hạn trang (vd 200) + `nextUpdatedSince`.
- Ưu tiên thấp — làm sau A, B.

---

## Đơn vị & ranh giới

- `mmp-events.ts` (emit + deliver + map thuần `deliveryStatusToEvent`) — nguồn sự thật webhook sender.
- Emit chỉ được gọi ở các action lifecycle; action KHÔNG tự build payload HMAC.
- Partner-request: endpoint mỏng + core `partner-request-actions` (insert/approve/reject).
- Backfill: query thuần theo `updatedSince` + route mỏng.

## Test

- `deliveryStatusToEvent`: delivered→shipment.delivered; đang giao→in_transit; exception→shipment.exception.
- `emitShipHoEvent`: đơn internal → no-op (không ghi); đơn mmp → ghi row pending đúng envelope.
- `markupFloorError` (đã có) dùng lại ở duyệt partner.
- Route: thiếu HMAC → 401; partner-request dedupe theo brand pending; backfill GET ký body rỗng verify đúng.
- Envelope shape (event/mmpRef/code/occurredAt/data) khớp §2a — test builder.

## Ngoài phạm vi

- `statement.*` (công nợ) — đợt Đối soát sau.
- `order.accepted` (chưa có thao tác "nhận xử lý" rõ ràng) — thêm sau nếu MEAN cần.
- Xoay secret là việc cấu hình (MEAN + MMP), không thuộc code.

## Cấu hình MEAN cấp (ngoài chat)

- `MMP_SHIP_HO_WEBHOOK_URL` (prod railway), staging nếu dùng.
- Xoay `MMP_OUTBOUND_SECRET` / `MMP_WEBHOOK_SECRET` mới cho cả 2 bên (giá trị cũ từng lộ).

## Kế hoạch build (3 plan, theo thứ tự MMP)

- **Plan A** — webhook sender (A1–A4) + nút MEAN reject/needs-info.
- **Plan B** — partner-requests (B1–B4) + callback.
- **Plan C** — backfill GET (C1).
