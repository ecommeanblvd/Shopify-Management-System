# Spec: Order Operations Phase 2 — MMP Brand Requests

**Ngày:** 2026-06-09
**Module:** Vận hành đơn (`/f/fulfillment`) — mở rộng cho luồng thiếu hàng → brand
**Spec nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md)

## 1. Mục tiêu

Khi một dòng sản phẩm của đơn **hết hàng** (Phase 1 đánh dấu `out_of_stock`), SMS **tự động đẩy yêu cầu sản xuất sang MMP** (hệ ngoài), theo dõi cho tới khi **brand confirm + điền ngày giao dự kiến**, và cung cấp danh sách **follow-up theo ngày giao tới hạn**. Khi hàng về, operator cập nhật kho MEAN + check lại tồn (cơ chế Phase 1) → dòng quay lại luồng pick.

## 2. Quyết định đã chốt
- Hướng truyền: **SMS đẩy (push) sang MMP** + **MMP webhook confirm** ngược về SMS.
- Đơn vị: **per-line** — mỗi dòng `out_of_stock` = 1 brand request (1:1 với `order_fulfillment_lines`).
- Kích hoạt: **tự động gửi** ngay khi check ra `out_of_stock`, **idempotent** (không gửi lại nếu request đã tồn tại cho dòng đó).
- Brand được nhận diện qua trường `vendor` của order line (gửi nguyên cho MMP định tuyến).

## 3. Mô hình dữ liệu (`db/schema.ts`)

### 3.1 Enums
- Mở rộng `fulfillmentLineStatusEnum` (Phase 1) thêm: `brand_requested`, `brand_confirmed`, `brand_rejected`.
- Mới:
```
brandRequestSendStatus: 'pending' | 'sent' | 'failed'
brandRequestConfirmStatus: 'awaiting' | 'confirmed' | 'rejected'
```

### 3.2 `brand_order_requests`
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `fulfillmentLineId` | uuid FK→`order_fulfillment_lines.id` cascade **notNull unique** | 1:1 với dòng |
| `orderId` | uuid FK→`shopify_orders.id` cascade notNull | denormalized để truy ngược |
| `brandSlug` | text | từ order line `vendor` (nullable nếu vendor trống → xem edge case) |
| `sku` | text | |
| `qty` | integer notNull | |
| `sendStatus` | `brandRequestSendStatus` notNull default `'pending'` | |
| `sendAttempts` | integer notNull default 0 | |
| `lastError` | text | lỗi gửi gần nhất |
| `sentAt` | timestamp | |
| `externalRef` | text | id MMP trả về (nếu có) |
| `confirmStatus` | `brandRequestConfirmStatus` notNull default `'awaiting'` | |
| `expectedDeliveryDate` | date | brand điền khi confirm |
| `note` | text | |
| `confirmedAt` | timestamp | |
| `createdAt`/`updatedAt` | timestamp | |

Index: `brand_order_requests_confirm_idx` trên `confirmStatus`; `brand_order_requests_order_idx` trên `orderId`.

## 4. Trạng thái

Dòng (`order_fulfillment_lines.status`) — nối tiếp Phase 1:
```
out_of_stock ──(tạo request + gửi MMP ok)──> brand_requested
brand_requested ──(webhook confirm)──> brand_confirmed | brand_rejected
brand_confirmed ──(hàng về: cập nhật kho + check lại)──> in_stock  [cơ chế Phase 1]
```
- Order rollup (`rollupOrderStatus`, Phase 1): `brand_requested`, `brand_confirmed`, `brand_rejected` đều được tính vào nhóm **`awaiting_brand`** (đơn vẫn đang chờ brand). Giữ logic Phase 1 ổn định — chỉ mở rộng tập "out" coi như awaiting_brand.
- Các transition brand **không** đi qua `canTransitionLine` (vốn dành cho pick/pack/ship) — chúng do auto-send và webhook điều khiển.

## 5. Outbound — đẩy sang MMP

`features/mmp/outbound.ts`:
- `buildBrandRequestPayload(req)` (thuần, test được) → `{ requestId, orderNumber, brandSlug, sku, qty }`.
- `signOutbound(body, timestamp, secret)` — HMAC-SHA256 over `${timestamp}.${rawBody}` (đối xứng với chiều inbound; tái dùng helper trong `features/mmp/hmac.ts` nếu có hàm ký, nếu không thì thêm `signMmpPayload`).
- `sendBrandRequest(req)` — `POST MMP_OUTBOUND_URL` với headers `x-mean-signature`, `x-mean-timestamp`, body JSON. Trả `{ ok, externalRef? , error? }`. Timeout hợp lý, không throw ra ngoài.

Tích hợp vào `checkStockForOrder` (Phase 1): trong cùng transaction khi set một dòng = `out_of_stock`, **ensure** một `brand_order_requests` (insert nếu chưa có, `onConflictDoNothing` theo `fulfillmentLineId`). Việc **gửi HTTP** chạy **sau khi commit** (fire-and-forget per request): nếu ok → cập nhật `sendStatus=sent`, `sentAt`, `externalRef`, và line → `brand_requested`; nếu lỗi → `sendStatus=failed`, `lastError`, `sendAttempts+1` (line vẫn `out_of_stock`).

`ENV` cần: `MMP_OUTBOUND_URL`, `MMP_OUTBOUND_SECRET` (thêm vào `.env.example`). Nếu thiếu cấu hình → không gửi, để `pending` + ghi `lastError='not configured'` (không làm hỏng check tồn).

## 6. Inbound — webhook confirm

`app/api/mmp/order-confirmations/route.ts` (Node runtime, mirror `app/api/mmp/products/route.ts`):
- Verify HMAC bằng `verifyMmpSignature` (header `x-mean-signature`, secret `MMP_WEBHOOK_SECRET` — chiều MMP→SMS dùng secret inbound như sản phẩm).
- Body: `{ requestId, status: 'confirmed' | 'rejected', expectedDeliveryDate?, note? }`.
- Xử lý (thuần `applyConfirmation`, test được): tìm request theo `requestId`; cập nhật `confirmStatus`, `expectedDeliveryDate`, `note`, `confirmedAt`; line → `brand_confirmed` (confirmed) / `brand_rejected` (rejected). **Idempotent**: nếu đã ở trạng thái đích thì no-op trả 200.
- Ghi 1 dòng audit vào `order_fulfillment_events` (đã có từ Phase 1; `lineId` = dòng tương ứng).

## 7. UI
- **Chi tiết đơn** (`OrderDetailPanel`): với dòng `out_of_stock`/`brand_*`, hiện badge gửi/confirm + **ngày giao dự kiến** + nút **"Gửi lại"** khi `sendStatus=failed`.
- **Trang Yêu cầu brand** `/f/fulfillment/brand-requests`: bảng request, lọc theo `confirmStatus` và **ngày giao tới hạn** (quá hạn/sắp tới — để follow-up). Cột: order#, brand, sku, qty, send, confirm, ngày giao, lỗi.

## 8. Server actions (`features/fulfillment/brand-actions.ts`, RBAC `manage_fulfillment`)
- `resendBrandRequest(requestId)` — gửi lại request `failed`/`pending`.
- (Auto-send nằm trong `checkStockForOrder` đã có; chỉ bổ sung phần ensure+send.)

## 9. Test
- Thuần: `buildBrandRequestPayload`, ký/verify HMAC (đối xứng), `applyConfirmation` (confirmed/rejected/idempotent), lọc follow-up theo ngày (hàm thuần nhận ngày tham chiếu).
- Webhook: chữ ký sai → 401; body hợp lệ → cập nhật đúng; gọi lại → idempotent 200.

## 10. Edge cases
- `vendor` trống trên order line → `brandSlug=null`; vẫn tạo request nhưng `sendStatus=failed`, `lastError='no brand'` (operator xử lý tay).
- Re-check một dòng đã `brand_requested`/`brand_confirmed` → **không** tạo request mới, **không** đổi về out_of_stock (giữ tiến trình brand).
- MMP confirm cho `requestId` không tồn tại → 404 (log), không tạo bừa.
- Đơn bị cancel sau khi đã gửi brand → để Phase sau (chỉ log; không tự huỷ ở MMP).

## 11. Ngoài phạm vi (YAGNI)
- Cron retry tự động (chỉ nút "Gửi lại" thủ công).
- Tự nhận biết hàng đã về (dùng check-lại-tồn Phase 1).
- Gộp nhiều đơn/nhiều dòng thành 1 đơn sản xuất.
- Huỷ/ă sửa request ở MMP từ SMS.
