# SMS → MMP Outbound — Hợp đồng tích hợp (brand production request)

**Mục đích:** Khi một đơn Shopify có dòng **hết kho** (out_of_stock), SMS gửi một
*brand production request* sang MMP để brand sản xuất/giao. Hiện MMP **mới chỉ
đẩy sản phẩm VÀO SMS** (inbound). Để chiều này chạy, **MMP cần dựng 1 endpoint
nhận (receiver)** theo đúng hợp đồng dưới đây.

Scheme HMAC **giống hệt** chiều inbound MMP→SMS đang chạy (chỉ đảo chiều), nên team
MMP tái dùng được logic verify sẵn có.

---

## 1. Những gì cần để bật outbound

| Việc | Ai làm | Ghi chú |
| --- | --- | --- |
| Dựng endpoint receiver (verify HMAC + nhận payload) | **MMP** | Theo §2–§5 dưới |
| Chốt URL receiver | MMP | → set vào `MMP_OUTBOUND_URL` (SMS, Railway) |
| Secret HMAC | — | **Dùng chung secret inbound `MMP_WEBHOOK_SECRET`** (đã set sẵn ở Railway vì inbound đang chạy). MMP verify bằng đúng secret đó. KHÔNG cần secret mới. |
| Set env trên SMS production | **Ops SMS (bạn)** | Chỉ cần set `MMP_OUTBOUND_URL`. Railway env, KHÔNG commit vào repo |

> **Secret:** outbound mặc định **fallback về `MMP_WEBHOOK_SECRET`** (một secret
> chung cho cặp SMS↔MMP). Chỉ set `MMP_OUTBOUND_SECRET` riêng nếu muốn **tách secret
> theo chiều** — khi đó nó được ưu tiên.
> Lưu ý tên: biến là `MMP_WEBHOOK_SECRET` (KHÔNG phải `MEAN_WEBHOOK_SECRET`; chữ
> "MEAN" chỉ nằm ở header `x-mean-signature`).
>
> Nếu `MMP_OUTBOUND_URL` chưa set (hoặc không có secret nào) → SMS trả `"not
> configured"` và **không gửi gì** (an toàn, không lỗi).

---

## 2. Request SMS gửi sang MMP

- **Method:** `POST`
- **URL:** giá trị `MMP_OUTBOUND_URL` (endpoint MMP cung cấp)
- **Headers:**
  - `content-type: application/json`
  - `x-mean-signature: sha256=<hex>` — chữ ký HMAC (xem §4)
  - `x-mean-timestamp: <unix seconds>` — thời điểm ký (giây)
- **Timeout phía SMS:** 10s.

### Body (JSON)
```json
{
  "requestId":  "<uuid của brand_order_request>",
  "orderNumber": "#MBLVD28899",
  "brandSlug":  "tinh-atelier",
  "sku":        "ABC-123",
  "qty":        1
}
```
- `requestId`: id nội bộ SMS (idempotency key — MMP nên dedupe theo trường này).
- `brandSlug`: brand đích (suy từ vendor của dòng đơn). **Nếu null SMS không gửi**
  (`error: 'no brand'`) → cần đảm bảo dòng đơn có vendor/brand.

---

## 3. Response MMP trả về

- **2xx** = nhận thành công. Body JSON (tùy chọn):
  ```json
  { "externalRef": "<mã đơn sản xuất phía MMP>" }
  ```
  SMS lưu `externalRef` nếu có (để đối chiếu). Trả `non-2xx` → SMS coi là gửi lỗi
  (`http <status>`), sẽ hiện nút **"Gửi lại"** cho operator.

---

## 4. HMAC (giống inbound, đã chốt với MMP 2026-06-03)

```
signedPayload = `${x-mean-timestamp}.${rawBody}`          // rawBody = đúng chuỗi JSON gửi đi
signature     = HMAC_SHA256(MMP_OUTBOUND_SECRET, signedPayload)   // hex
header        = `x-mean-signature: sha256=<hex>`
```

**MMP receiver phải:**
1. Đọc body dạng **text thô** (đừng parse JSON rồi re-serialize — sẽ lệch byte).
2. Tính lại `HMAC_SHA256(secret, \`${x-mean-timestamp}.${rawBodyText}\`)` và so
   **timing-safe** với phần hex sau `sha256=`.
3. Từ chối nếu lệch chữ ký, hoặc `|now - x-mean-timestamp| > 300s` (chống replay,
   skew 5 phút — đúng mức Shopify/Stripe).

(Đây chính là `verifyMmpSignature` SMS đang dùng cho inbound — MMP có thể mirror.)

---

## 5. Vòng phản hồi đã có sẵn (MMP → SMS)

Sau khi brand xử lý, MMP gọi NGƯỢC về SMS endpoint **đã chạy**:
`POST /api/mmp/order-confirmations` (cùng scheme HMAC, secret `MMP_WEBHOOK_SECRET`)
với `{ requestId, status: 'confirmed'|'rejected', expectedDeliveryDate?, note? }`
→ SMS chuyển dòng sang `brand_confirmed`/`brand_rejected`. Phần này không cần làm gì thêm.

---

## 6. Các bước bật (sau khi MMP có receiver)

1. MMP cung cấp URL receiver. Secret: dùng lại `MMP_WEBHOOK_SECRET` đang có (MMP
   verify bằng đúng giá trị này) — không cần sinh secret mới.
2. Trên **Railway (SMS production)** đặt:
   - `MMP_OUTBOUND_URL = <URL receiver của MMP>`
   - (Tùy chọn) `MMP_OUTBOUND_SECRET` — chỉ khi muốn tách secret riêng cho chiều này.
3. Redeploy SMS. Thử 1 đơn out_of_stock → kiểm MMP nhận + SMS lưu `externalRef`.
4. Khi ổn, chạy kiểm kho cho các đơn `received` tồn — dòng hết kho tự bắn sang MMP.

> **Chưa làm được gì cho tới khi MMP có receiver.** Trước đó, đẩy MMP luôn trả
> `"not configured"`; cứ kiểm kho bình thường — dòng hết kho nằm chờ ở
> `out_of_stock`/`awaiting_brand`, không mất, gửi lại sau được.
