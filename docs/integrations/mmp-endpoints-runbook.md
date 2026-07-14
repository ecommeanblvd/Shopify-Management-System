# MMP endpoints — RUNBOOK (khi MMP đổi domain / path)

> **Dùng khi:** MMP đổi domain hoặc đường dẫn endpoint → event/đơn SMS→MMP bắt đầu
> lỗi (404/405). Đã xảy ra 1 lần (2026-07): MMP rebuild app, domain
> `web-production-bb145.up.railway.app` **chết**, chuyển sang
> `mean-merchant-portal.up.railway.app` và **đổi luôn path** một số endpoint.

## 3 biến URL trỏ MMP (đặt trên **Railway** — service SMS, KHÔNG commit)

| Biến | Chiều | Endpoint MMP (app hiện tại) | Secret ký | HMAC scheme |
|---|---|---|---|---|
| `MMP_ORDERS_URL` | SMS→MMP: bản ghi đơn (đơn có hàng brand) | `https://mean-merchant-portal.up.railway.app/api/integration/orders` | `MMP_OUTBOUND_SECRET` | **body-only**: `HMAC(secret, rawBody)`, header `x-mean-signature` |
| `MMP_OUTBOUND_URL` | SMS→MMP: brand production request | `https://mean-merchant-portal.up.railway.app/api/integration/brand-requests` | `MMP_OUTBOUND_SECRET` | `HMAC(secret, ${ts}.${rawBody})`, header `x-mean-signature` + `x-mean-timestamp` |
| `MMP_SHIP_HO_WEBHOOK_URL` | SMS→MMP: event ship-hộ (order.reconciled, order.claim_pending, shipment.*, …) | `https://mean-merchant-portal.up.railway.app/api/integration/ship-ho/order-updates` | `MMP_WEBHOOK_SECRET` | `HMAC(secret, ${ts}.${rawBody})`, header `x-mean-signature` + `x-mean-timestamp` |

**2 secret KHÁC NHAU (khớp theo GIÁ TRỊ, không theo tên):**
- `MMP_OUTBOUND_SECRET` (SMS) = `MEAN_WEBHOOK_SECRET` (MMP) — cho orders + brand-requests.
- `MMP_WEBHOOK_SECRET` (SMS) — cho ship-hộ events + chiều MMP→SMS. (fingerprint `ed699da6b1d1`, chốt 08/07.)

Ship-hộ event: MMP trả **`409` = đơn chưa tồn tại phía MMP → retry sau**; `401 "stale"` = timestamp quá 5 phút; `401` khác = sai chữ ký.

## Dấu hiệu MMP đã đổi (event không tới)
- **Outbound đơn**: bảng `mmp_order_pushes` có `status='failed'`, `last_error='http 404'`.
- **Event ship-hộ**: bảng `ship_ho_order_events` có `delivery_status='pending'` + `last_error='http 404'` (route/domain mất) hoặc `'http 405'` (path giờ là trang web, không nhận POST).

## Cách TEST 1 URL nhanh (không cần deploy)
```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 -X POST \
  -H 'content-type: application/json' -H 'x-mean-signature: sha256=x' -H 'x-mean-timestamp: 1' \
  -d '{}' "<URL>"
```
- **401** (`{"error":"stale"}` / invalid signature) = ✅ receiver SỐNG, đúng path (chỉ thiếu chữ ký hợp lệ).
- **404** = domain chết / route không tồn tại.
- **405** hoặc **GET ra 200** = path là **trang web**, không phải API receiver → sai path, hỏi MMP path đúng.

## Quy trình SỬA (khi MMP báo domain/path mới)
1. Lấy từ MMP: URL POST đầy đủ mới của endpoint bị đổi.
2. Test URL bằng lệnh curl trên → phải ra **401** (không phải 404/405).
3. Set trên Railway (tự trigger redeploy service SMS):
   ```bash
   railway variables --set "MMP_SHIP_HO_WEBHOOK_URL=<url mới>"
   # (đổi tên biến tương ứng cho MMP_ORDERS_URL / MMP_OUTBOUND_URL)
   ```
4. **Re-deliver các event/đơn đang kẹt** (dùng env mới qua `railway run`):
   - Ship-hộ events (order.reconciled, claim_pending, shipment.*):
     ```bash
     railway run npx tsx -e "import('@/features/ship-ho/mmp-events').then(m=>m.retryPendingShipHoEvents()).then(r=>console.log(r))"
     ```
     (hoặc chờ cron `retry-ship-ho-events` / gọi `/api/cron/retry-ship-ho-events` với bearer CRON_SECRET.)
   - Đơn ship-hộ owned-store sang MMP: `railway run npx tsx scripts/push-owned-store-mmp.ts`.
   - Retry đơn brand: cron `/api/cron/retry-mmp-orders`.
5. Kiểm lại: `retryPendingShipHoEvents()` trả `delivered=tried, failed=0`; outbox `ship_ho_order_events` không còn `pending`.

## Nếu event đã chuyển `failed` (quá 8 lần thử) → reset về pending để giao lại
```sql
UPDATE ship_ho_order_events SET delivery_status='pending', attempts=0, last_error=NULL
 WHERE delivery_status='failed';
```
(chạy read-only trước để đếm; MAX_ATTEMPTS=8 trong `features/ship-ho/mmp-events.ts`.)

## File liên quan
- `features/ship-ho/mmp-events.ts` — emit + deliver + `retryPendingShipHoEvents`.
- `features/mmp/order-outbound.ts` — push đơn (MMP_ORDERS_URL).
- `features/mmp/outbound.ts` — brand-request (MMP_OUTBOUND_URL).
- `docs/integrations/mmp-ship-ho-api.md` — hợp đồng event ship-hộ.
- `docs/mmp-outbound-integration.md` — hợp đồng orders push + brand-request.
