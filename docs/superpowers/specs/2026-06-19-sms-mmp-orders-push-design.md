# SMS → MMP Orders Push — Design

**Date:** 2026-06-19
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề

MMP đã có receiver `POST /api/integration/orders` + trang admin orders, nhưng **0
đơn** vì SMS chưa từng đẩy đơn sang. Cần dựng luồng **SMS→MMP orders-push** để MMP
có bản ghi đơn cho các đơn có hàng brand (brand sản xuất).

Phân biệt với brand-request đã có: brand-request đẩy **từng dòng** out_of_stock sang
`/api/integration/brand-requests` (timestamped HMAC). Orders-push đẩy **bản ghi ĐƠN**
sang `/api/integration/orders` (**body-only HMAC** — scheme KHÁC).

## Quyết định đã chốt
- **Phạm vi:** chỉ đẩy đơn **có ≥1 dòng brand/MMP** (out_of_stock). Không đẩy đơn
  toàn-kho.
- **PII tối giản:** chỉ gửi `orderNumber`, `store`, **tên người nhận**, **quốc gia
  ship**, và các dòng brand `{sku, title, qty}`. **KHÔNG** gửi email/SĐT/địa chỉ chi
  tiết (address1/2, city, postcode), **không** gửi giá.
- **Trigger:** sau kiểm kho (khi đã biết dòng brand) — KHÔNG đẩy lúc đơn vừa về
  (lúc đó dòng còn `pending_check`).
- **Secret:** dùng lại `MMP_OUTBOUND_SECRET` (cùng giá trị = MEAN_WEBHOOK_SECRET phía
  MMP). URL riêng: env mới `MMP_ORDERS_URL`.

## Kiến trúc / components

### 1. HMAC body-only — `features/mmp/hmac.ts` (thêm)
```ts
/** Body-only HMAC cho SMS→MMP orders: sha256=<hex> của HMAC_SHA256(secret, rawBody).
 *  KHÁC signMmpPayload (timestamped). MMP verify endpoint /api/integration/orders
 *  bằng scheme này. */
export function signMmpBody(secret: string, rawBody: string): string  // trả 'sha256=<hex>'
```

### 2. Payload builder thuần — `features/mmp/order-push-logic.ts` (mới)
```ts
export interface MmpOrderLine { sku: string | null; title: string; qty: number }
export interface MmpOrderPayload {
  orderNumber: string; store: string;
  recipientName: string | null; shipCountry: string | null;
  lines: MmpOrderLine[];
}
export function buildMmpOrderPayload(input: {
  orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
  brandLines: Array<{ sku: string | null; title: string; qty: number }>;
}): MmpOrderPayload
```
Thuần, không I/O. CHỈ chứa các field đã chốt (không PII chi tiết).

### 3. Sender — `features/mmp/order-outbound.ts` (mới)
```ts
export async function sendOrderToMmp(orderId: string): Promise<SendResult>
```
- Gate config: `MMP_ORDERS_URL` + secret (`MMP_OUTBOUND_SECRET`) — thiếu → `{ ok:false, error:'not configured' }`.
- Load đơn + **chỉ các dòng brand** (order_fulfillment_lines status out_of_stock/brand
  → map về sku/title/qty từ shopify_order_lines). Nếu **không có dòng brand** → skip
  `{ ok:false, error:'no brand lines' }` (không gửi).
- `recipientName` = `shopify_orders.shipName`; `shipCountry` = `shopify_orders.shipCountry`.
- Ký body-only (`signMmpBody`), POST `MMP_ORDERS_URL`, header `x-mean-signature`,
  timeout 10s. Trả `{ ok, externalRef? }` (đọc externalRef nếu MMP trả).

### 4. Trigger — `features/fulfillment/actions.ts`
Trong `checkStockForOrder`, cạnh `await sendPendingBrandRequests(orderId)` (sau khi
phân loại xong), thêm `await sendOrderToMmp(orderId)`. Hàm tự gate (chỉ gửi khi có
dòng brand + đã cấu hình). Nuốt lỗi (không chặn kiểm kho) — log + để retry.

### 5. Backfill — action/script
`backfillMmpOrders()`: quét các đơn ĐÃ có dòng brand (out_of_stock) → gọi
`sendOrderToMmp` từng đơn. Chạy 1 lần cho tồn đọng. Idempotent (MMP dedupe theo
orderNumber+store).

### 6. Config / doc
- `.env.example`: thêm `MMP_ORDERS_URL`.
- `docs/mmp-outbound-integration.md`: thêm mục Orders (endpoint, body-only HMAC,
  payload tối giản, response) cho MMP align receiver.

## Wire contract (MMP align theo)
- `POST <MMP_ORDERS_URL>` (=`/api/integration/orders`)
- Headers: `content-type: application/json`, `x-mean-signature: sha256=<hex>` (body-only, KHÔNG timestamp).
- Body: `MmpOrderPayload` (§2).
- Response: `2xx` + (tùy chọn) `{ externalRef }`. Non-2xx → SMS coi gửi lỗi (retry sau).
- Idempotency: MMP dedupe theo `orderNumber`+`store`.

## Error handling
- Gate cấu hình + gate "có dòng brand" trước khi gửi.
- Lỗi gửi nuốt ở trigger (không chặn kiểm kho); backfill báo số ok/lỗi.
- Không gửi PII ngoài tên người nhận + quốc gia (theo chốt).

## Test
- `signMmpBody`: hex đúng cho body cố định; khác `signMmpPayload` (không timestamp).
- `buildMmpOrderPayload`: map đúng field; CHỈ field đã chốt (không lọt email/địa chỉ);
  lines = dòng brand.
- (`sendOrderToMmp`/trigger: integration — kiểm gate "no brand lines" + "not configured"
  bằng unit cho phần thuần, phần POST là integration.)

## Ngoài phạm vi
- Không đổi brand-request (đã xong).
- Không đẩy đơn toàn-kho; không gửi PII chi tiết.
- Không dựng UI orders phía SMS (MMP có admin orders riêng).
