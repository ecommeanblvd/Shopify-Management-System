# Làm chắc luồng push order sang MMP — log + cờ "đã đẩy" + retry — Design

**Date:** 2026-06-20
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Kênh **order push** (`sendOrderToMmp` → MMP `/api/integration/orders`) hiện chỉ POST rồi thôi: **không ghi dấu vết ở DB mình, không retry, không cờ "đã đẩy"**. Hệ quả:
- Push lỗi (MMP down) → đơn đó **không được đẩy lại tự động**, không ai biết.
- Re-push phụ thuộc hoàn toàn **dedupe phía MMP** (không kiểm soát được phía mình).
- Backfill chạy lại đẩy lại TOÀN BỘ (flood MMP).

(Kênh **brand-requests** đã có tracking riêng trên `brand_order_requests` — KHÔNG đụng.)

Auto-push hiện có: cuối action kiểm kho (`features/fulfillment/actions.ts`, sau xử lý dòng) gọi `await sendOrderToMmp(orderId)` (best-effort try/catch). Backfill: `backfillMmpOrders` (đã có nút giới hạn N).

## Quyết định đã chốt
- **1 trạng thái / đơn** (gọn, đúng pattern brand-request), KHÔNG per-attempt log.
- **`payloadHash`**: re-push khi nội dung đơn đổi (dòng `out_of_stock` phát sinh sau) — cờ "đã đẩy" content-aware, không bỏ sót.
- Retry bằng **cron sẵn có** (chèn vào `cron:sync-orders` + route HTTP), không thêm cron service.

## Kiến trúc

### 1. Schema — migration tay `mmp_order_pushes`
- Enum `mmp_push_status`: `'pending' | 'sent' | 'failed'`.
- Bảng `mmp_order_pushes`:
  - `id uuid pk`, `orderId uuid` (FK `shopify_orders.id` onDelete cascade, **unique**),
  - `status mmp_push_status not null default 'pending'`,
  - `attempts integer not null default 0`,
  - `lastError text`, `sentAt timestamp`, `externalRef text`, `payloadHash text`,
  - `createdAt timestamp default now()`, `updatedAt timestamp default now()`.
  - index trên `status` (cho cron quét).
- `db/schema.ts`: enum + bảng + quan hệ. Số migration là số **kế tiếp trên `main`** lúc build (xác định bằng `ls db/migrations`).

### 2. Đơn vị thuần — `features/mmp/order-push-state.ts` (mới)
```ts
export type MmpPushStatus = 'pending' | 'sent' | 'failed';
export interface MmpPushState { status: MmpPushStatus; attempts: number; payloadHash: string | null }
/** Có nên POST không: chưa từng sent, HOẶC nội dung đổi (hash khác). */
export function shouldPushOrder(state: MmpPushState | null, currentHash: string): boolean
/** Hash payload ổn định (JSON đã chuẩn hoá) để phát hiện nội dung đổi. */
export function hashOrderPayload(rawBody: string): string  // sha256 hex
/** Đơn đủ điều kiện retry: status ∈ {pending,failed} và attempts < max. */
export function isRetryable(state: { status: MmpPushStatus; attempts: number }, maxAttempts: number): boolean
```
- `shouldPushOrder`: `state == null` → true; `state.status !== 'sent'` → true; `sent` nhưng `state.payloadHash !== currentHash` → true; còn lại false.

### 3. Push có tracking — `pushOrderToMmp(orderId)` trong `features/mmp/order-outbound.ts`
- Refactor: tách phần **build payload** (đã có, dùng `buildMmpOrderPayload`) khỏi phần **gửi + ghi state**.
- Luồng:
  1. Dựng `rawBody` + `payloadHash = hashOrderPayload(rawBody)` (cần đọc order/brand lines như hiện tại; nếu không có dòng brand → không tạo state, trả `{ ok:false, error:'no brand lines' }`).
  2. Đọc `mmp_order_pushes` theo orderId. `shouldPushOrder(state, payloadHash) === false` → trả `{ ok:true, skipped:'already sent' }` (không POST).
  3. Upsert dòng `status='pending'`, set `payloadHash` (tạo TRƯỚC khi POST để cron retry được nếu POST ném).
  4. POST (tái dùng `signMmpBody` + fetch hiện có). Thành công → update `status='sent', sentAt=now, externalRef, attempts+1`. Lỗi/throw → `status='failed', attempts+1, lastError`.
  5. Chưa cấu hình env (`MMP_ORDERS_URL`/`MMP_OUTBOUND_SECRET`) → trả `{ ok:false, error:'not configured' }`, **KHÔNG** tạo state (tránh rác khi chưa bật).
- **`sendOrderToMmp` cũ** → thay mọi caller bằng `pushOrderToMmp`. Caller: action kiểm kho (`features/fulfillment/actions.ts`) + `backfillMmpOrders`. Giữ best-effort try/catch ở kiểm kho.

### 4. Backfill bỏ qua đã-đẩy — `features/mmp/order-backfill.ts`
- Gọi `pushOrderToMmp` (đã tự bỏ qua đơn `sent` + hash trùng). `total` vẫn = tổng eligible; kết quả `skipped` gồm cả "already sent". Chạy lại chỉ POST phần chưa gửi → không flood.

### 5. Retry — `retryFailedMmpPushes(maxAttempts = 5)` (mới, file riêng `features/mmp/order-push-retry.ts`)
- Quét `mmp_order_pushes` `status ∈ {pending,failed}` và `attempts < maxAttempts` → `pushOrderToMmp` từng đơn → đếm `{ retried, recovered, stillFailing }`.
- Lộ qua:
  - **Route HTTP** `app/api/cron/retry-mmp-orders/route.ts` — gate `CRON_SECRET` bearer (mirror `app/api/cron/sync-orders`), `maxDuration=300`.
  - **Chèn vào script** `scripts/cron/sync-shopify-orders.ts` (chạy mỗi giờ trên Railway): sau sync, gọi `retryFailedMmpPushes()` → tự retry hàng giờ, không thêm cron service.

### 6. UI tối thiểu — fulfillment
- Badge trạng thái push MMP trên đơn (trang `f/fulfillment/[orderId]` hoặc worklist): `sent` (xanh "Đã đẩy MMP") / `failed` ("Lỗi đẩy MMP" + tooltip lastError) / chưa có (không hiện).
- Nút **"Đẩy lại MMP"** cho đơn `failed` → server action gọi `pushOrderToMmp` (giống `resendBrandRequest`). Quyền `manage_fulfillment`.

## Data flow
Kiểm kho đơn → dòng `out_of_stock` → `pushOrderToMmp`: tạo `pending` → POST → `sent`/`failed` (+ payloadHash). Lỗi → cron hàng giờ `retryFailedMmpPushes` đẩy lại tới khi `sent` hoặc hết `maxAttempts`. Nội dung đổi (dòng mới) → hash khác → đẩy lại. Backfill = một-lần seed cho tồn đọng, lần sau tự bỏ qua `sent`.

## Error handling / edge
- Chưa cấu hình MMP → không POST, không tạo state.
- POST throw/timeout → `failed`, cron nhặt lại.
- Hết `maxAttempts` → giữ `failed` (cần "Đẩy lại MMP" thủ công).
- Nội dung đơn đổi sau khi `sent` → hash khác → re-push (đặt lại pending trong `pushOrderToMmp`).
- Đơn mất dòng brand (hết out_of_stock) → `pushOrderToMmp` trả `no brand lines`, không đổi state cũ (giữ lịch sử).
- Race 2 lần push cùng đơn → unique(orderId) + upsert; cron và auto-push idempotent theo state.

## Test
- `shouldPushOrder`: null→true; sent+hash trùng→false; sent+hash khác→true; failed→true.
- `hashOrderPayload`: cùng input→cùng hash; khác→khác.
- `isRetryable`: failed attempts<max→true; attempts≥max→false; sent→false.
- Push/retry/backfill ghi DB + route + UI: integration → verify build + smoke.

## Ngoài phạm vi
- Per-attempt audit log (chọn 1-trạng-thái).
- Kênh brand-requests (đã có tracking).
- Thêm cron service mới trên Railway (chỉ chèn script + route HTTP).
