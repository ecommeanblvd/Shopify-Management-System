# SMS → MMP Outbound — Hợp đồng tích hợp (brand production request)

**Mục đích:** Khi một đơn Shopify có dòng **hết kho** (out_of_stock), SMS gửi một
*brand production request* sang MMP để brand sản xuất/giao. Hiện MMP **mới chỉ
đẩy sản phẩm VÀO SMS** (inbound). Để chiều này chạy, **MMP cần dựng 1 endpoint
nhận (receiver)** theo đúng hợp đồng dưới đây.

Scheme HMAC **giống hệt** chiều inbound MMP→SMS đang chạy (chỉ đảo chiều), nên team
MMP tái dùng được logic verify sẵn có.

---

## 1. Những gì cần để bật outbound

**Trạng thái:** MMP đã dựng receiver `POST /api/integration/brand-requests` (verify
HMAC bằng `MEAN_WEBHOOK_SECRET` phía MMP, idempotency theo `requestId`, trả
`200 {externalRef,duplicate}` / `422` brand không tồn tại / `401` sai chữ ký). Còn lại
là cấu hình phía SMS.

| Việc | Ai làm | Ghi chú |
| --- | --- | --- |
| Receiver `POST /api/integration/brand-requests` | **MMP** | ĐÃ XONG |
| `MMP_OUTBOUND_URL` = URL receiver | **Ops SMS** | vd `https://<mmp-host>/api/integration/brand-requests` |
| `MMP_OUTBOUND_SECRET` = **giá trị** `MEAN_WEBHOOK_SECRET` phía MMP | **Ops SMS** | Lấy giá trị từ MMP; set trên Railway (KHÔNG commit) |

> ⚠️ **Secret theo CHIỀU — khớp theo GIÁ TRỊ, không theo tên biến:**
> - **MMP→SMS** (product webhook): SMS verify bằng `MMP_WEBHOOK_SECRET`.
> - **SMS→MMP** (brand-request): SMS **ký** bằng `MMP_OUTBOUND_SECRET`; MMP verify
>   bằng `MEAN_WEBHOOK_SECRET`. ⇒ `MMP_OUTBOUND_SECRET` (SMS) phải **bằng đúng GIÁ
>   TRỊ** `MEAN_WEBHOOK_SECRET` (MMP).
> - Hai secret này **KHÁC nhau** (`MMP_WEBHOOK_SECRET` ≠ `MEAN_WEBHOOK_SECRET`).
>   KHÔNG dùng `MMP_WEBHOOK_SECRET` để ký outbound (sẽ 401).
> - SMS hiện **chưa** có luồng "orders push" sang MMP, nên không thể copy secret từ
>   đó — Ops lấy thẳng giá trị `MEAN_WEBHOOK_SECRET` từ MMP.
>
> Nếu `MMP_OUTBOUND_URL`/`MMP_OUTBOUND_SECRET` chưa set → SMS trả `"not configured"`
> và **không gửi gì** (an toàn).

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

## 5. Orders push (SMS → MMP)

Sau khi `checkStockForOrder` hoàn tất (kể cả gửi brand-request riêng lẻ), SMS tự động
đẩy **một bản ghi đơn tổng hợp** sang MMP — chỉ khi đơn có ít nhất một dòng brand
(`out_of_stock | brand_requested | brand_confirmed | brand_rejected`).

- **Endpoint MMP:** `POST /api/integration/orders`
- **Header:** `x-mean-signature: sha256=<hex>` — body-only HMAC
  (`HMAC_SHA256(MMP_OUTBOUND_SECRET, rawBody)`, **không** có timestamp trong payload ký)
- **Body (`MmpOrderPayload`):**
  ```json
  {
    "orderNumber": "#MBLVD28899",
    "store": "Mirer",
    "recipientName": "Nguyen Van A",
    "shipCountry": "VN",
    "placedAt": "2026-06-15T10:00:00.000Z",
    "receivedAt": "2026-06-20T00:00:00.000Z",
    "financialStatus": "PAID",
    "fulfillmentStatus": "FULFILLED",
    "cancelledAt": null,
    "lines": [
      { "sku": "ABC-123", "title": "Product name", "qty": 1, "vendor": "denio", "receivedAt": "2026-06-20T00:00:00.000Z" }
    ]
  }
  ```
  - `recipientName` / `shipCountry`: PII tối giản — tên + quốc gia, không địa chỉ/SĐT/email.
  - `placedAt`: ngày đặt đơn (Shopify `processed_at`, ISO). `null` nếu thiếu.
  - `receivedAt` (cấp order): ngày MEAN nhận hàng từ brand MỚI NHẤT trong các line. `null` nếu chưa nhận.
  - `lines`: chỉ dòng brand `{ sku, title, qty, vendor, receivedAt }`. `receivedAt` per-line = ngày nhận của SKU đó.
  - **Giá (từ 18/07/2026) — CHỈ đơn của STORE RIÊNG của brand** (`store` ∈ {`tinhatelier`, `mirermirer-official`}) để brand đối soát doanh thu + phí ship:
    - per-line thêm `unitPrice` (đơn giá bán, order currency);
    - payload thêm khối `pricing`: `{ currency, subtotal, totalDiscount, totalShipping, totalShippingDiscount, totalTax, totalPrice }` — `subtotal` = Σ unitPrice×qty các line gửi kèm; `totalShipping` = phí ship khách trả (SAU giảm); `totalShippingDiscount` = số tiền GIẢM phí ship (promo 50% off shipping của brand; phí gốc = totalShipping + totalShippingDiscount; KEY VẮNG MẶT khi đơn cũ chưa có dữ liệu shippingLines (không gửi null)); `totalPrice` = tổng khách thanh toán.
    - Payload có pricing thì kèm **`currency` CẤP GỐC** (= pricing.currency) — validator MMP yêu cầu khi line có unitPrice (siết 21/07).
    - **`pricing.refundedAmount` (từ 30/07/2026)**: tổng tiền ĐÃ HOÀN khách (order currency, Σ mọi lần refund — hoàn MỘT PHẦN cũng có số; 0 = chưa hoàn). **Doanh thu thực = totalPrice − refundedAmount** — engine MMP tự trừ. (Store đa-brand chưa có field này: refund cấp đơn không quy được về từng brand; cần line-level refund sync — sẽ bàn riêng nếu MMP cần.)
    - **`pricing.refunds` (từ 31/07/2026)** — chi tiết TỪNG LẦN hoàn (key vắng mặt khi đơn không có refund): `[{ refundedAt, amount, shippingAmount?, lines?: [{sku,title,qty,amount}] }]`. `amount` = tổng tiền hoàn lần đó; `shippingAmount` = phần hoàn PHÍ SHIP; `lines` = hoàn ĐỒ theo SKU (amount = subtotal phần hoàn của SKU). ⚠️ Pattern Shopify: có lần "trả hàng" ghi `lines` nhưng `amount = 0` (chỉ đánh dấu hàng về), tiền hoàn thật nằm ở lần refund khác không gắn lines → đối soát TỔNG theo `refundedAmount`, dùng `lines` để biết sản phẩm nào bị trả.
    - **`pricing.shippingCost` (từ 03/08/2026 — hiện CHỈ đơn tinhatelier)**: CHI PHÍ SHIP thực của MEAN cho đơn, dùng làm "chi phí ship" khi MMP đối soát với brand TINH: `{ carrierVnd, insHandlingUsd, totalUsd, fxVndPerUsd, source: 'carrier_bill' }` — `carrierVnd` = cước carrier THẬT từ hoá đơn (VND); `insHandlingUsd` = phí đóng gói/xử lý INS cố định $5/đơn; **`totalUsd` = carrierVnd/fxVndPerUsd + insHandlingUsd** (số dùng đối soát). Key VẮNG MẶT = đơn chưa có bill carrier trong SMS (đơn trước hệ thống / đơn VN / POS) — SMS không suy đoán số.
    - `pricing.returnShippingVnd` (optional, **VND** — khác order currency): tổng cước HÀNG HOÀN đã phát sinh cho đơn, lấy từ bill carrier (nhận diện orderRef `_R` / `RETURN OF <tracking>`). Xuất hiện khi > 0 — để brand đối soát cả chi phí hoàn.
    - **Phí transaction cổng thanh toán (từ 24/07/2026)** — 3 key trong `pricing` của store riêng (CHỈ xuất hiện khi có dữ liệu):
      `transactionFee` (phí quy về **order currency**, suy từ Shopify `transactions.fees` các giao dịch SALE/CAPTURE thành công), `transactionFeeNative` + `transactionFeeNativeCurrency` (phí NGUYÊN GỐC theo đồng payout của cổng — ví dụ VND với Shopify Payments payout VN). Cả 3 KEY VẮNG MẶT khi đơn chưa có dữ liệu fees từ Shopify (validator MMP 31/07 không nhận null — field optional, absent = không có). Doanh thu net brand ≈ `totalPrice − transactionFee`.
    - **Store đa-brand (meanblvd/cici-mean) — từ 30/07/2026 (phương án 1)**: line CÓ giá `unitPrice` + `lineDiscount` (giảm giá PHÂN BỔ cho line; **thực thu line = unitPrice×qty − lineDiscount**) và payload kèm `currency` cấp gốc, nhưng **KHÔNG có khối `pricing` tổng cấp đơn**. ⚠️ MMP BẮT BUỘC lọc line theo `vendor` trước khi hiển thị — brand chỉ được thấy giá line của CHÍNH brand mình, không được lộ line brand khác trong cùng đơn. Đơn cũ chưa re-sync giá line có thể thiếu key giá (shape cũ).
    - Store riêng (tinhatelier/mirermirer) cũng có `lineDiscount` per-line như trên.
  - **`vendor`** = giá trị cột vendor Shopify (= `brandSlug` trong brand-request, **cùng
    nguồn** nên nhất quán 2 chiều). MMP **route đơn về đúng brand** theo field này:
    đơn nhiều brand → MMP tách thành 1 Order/brand `(orderNumber, brandId)`, mỗi Order
    chỉ chứa line của brand đó. `vendor` có thể `null` nếu line Shopify thiếu vendor →
    MMP báo line không map được.

  **🆕 Trạng thái đơn Shopify (2026-07-14 — cần MMP bổ sung lưu):** giá trị **thô** từ Shopify, MMP tự suy trạng thái hiển thị:

  | Field | Kiểu | Giá trị có thể có | MMP suy ra |
  | --- | --- | --- | --- |
  | `financialStatus` | string \| null | `PENDING` `AUTHORIZED` `PAID` `PARTIALLY_PAID` `PARTIALLY_REFUNDED` `REFUNDED` `VOIDED` `EXPIRED` | `pending` = `PENDING`; `refunded` = `REFUNDED`/`PARTIALLY_REFUNDED` |
  | `fulfillmentStatus` | string \| null | `FULFILLED` `UNFULFILLED` `PARTIALLY_FULFILLED` `IN_PROGRESS` `ON_HOLD` `SCHEDULED` `RESTOCKED` `null` | `fulfilled` = `FULFILLED` |
  | `cancelledAt` | string(ISO) \| null | thời điểm huỷ, hoặc `null` | `cancelled` = `cancelledAt != null` |

  - Đây là **trạng thái đơn Shopify cấp-order**, KHÁC trạng thái sản xuất brand (thể hiện qua việc line có mặt + `receivedAt`).
  - **`draft`**: KHÔNG áp dụng — SMS chỉ sync đơn thật, không sync draft order.
  - MMP nên lưu 3 field này và **cập nhật đè** mỗi lần nhận lại đơn (đơn có thể chuyển pending→paid→refunded, unfulfilled→fulfilled, hoặc bị cancel về sau).
- **Response:** `2xx { "externalRef": "<mã tham chiếu MMP>" }` — SMS lưu `externalRef`
  nếu có. Non-2xx → SMS log lỗi nhưng **không chặn** luồng kiểm kho.
- **Idempotency:** theo `orderNumber + store` (MMP nên dedupe theo cặp này).
- **Scope:** chỉ đơn có dòng brand; đơn thuần in-stock/out_of_stock chưa brand không gửi.
- **Gate:** `MMP_ORDERS_URL` hoặc `MMP_OUTBOUND_SECRET` chưa set → trả
  `{ ok: false, error: 'not configured' }` và **không gửi gì**.

> **HMAC khác brand-request:** orders push ký **body-only** (không timestamp trong
> signed payload), dùng `signMmpBody`. Brand-request ký `${timestamp}.${body}` dùng
> `signMmpPayload`. MMP phải dùng scheme tương ứng cho từng endpoint.

---

## 6. Vòng phản hồi đã có sẵn (MMP → SMS)

Sau khi brand xử lý, MMP gọi NGƯỢC về SMS endpoint **đã chạy**:
`POST /api/mmp/order-confirmations` (cùng scheme HMAC, secret `MMP_WEBHOOK_SECRET`)
với `{ requestId, status: 'confirmed'|'rejected', expectedDeliveryDate?, note? }`
→ SMS chuyển dòng sang `brand_confirmed`/`brand_rejected`. Phần này không cần làm gì thêm.

---

## 7. Các bước bật (sau khi MMP có receiver)

1. Lấy từ MMP: (a) URL receiver, (b) **giá trị** `MEAN_WEBHOOK_SECRET` (secret MMP
   verify request đến từ SMS).
2. Trên **Railway (SMS production)** đặt:
   - `MMP_OUTBOUND_URL = https://<mmp-host>/api/integration/brand-requests`
   - `MMP_OUTBOUND_SECRET = <giá trị MEAN_WEBHOOK_SECRET của MMP>`
3. Redeploy SMS. Thử 1 đơn out_of_stock → kiểm MMP nhận (`200`) + SMS lưu `externalRef`.
4. Khi ổn, chạy kiểm kho cho các đơn `received` tồn — dòng hết kho tự bắn sang MMP.

> **Chưa làm được gì cho tới khi MMP có receiver.** Trước đó, đẩy MMP luôn trả
> `"not configured"`; cứ kiểm kho bình thường — dòng hết kho nằm chờ ở
> `out_of_stock`/`awaiting_brand`, không mất, gửi lại sau được.


## Quy tắc tên hiển thị brand (thống nhất 2 bên — 21/07/2026)

- **Mỗi từ chỉ viết hoa CHỮ CÁI ĐẦU**, còn lại viết thường: `TOM FRIED` → `Tom Fried`,
  `LEKIEU` → `Lekieu`, `À TOUS` → `À Tous`, `21SIX` → `21Six` (từ bắt đầu bằng số:
  viết hoa chữ cái đầu tiên gặp). Unicode-aware.
- SMS đã chuẩn hoá toàn bộ `display_name` (91/154 brand đổi) và áp quy tắc ở tầng ingest.
- **MMP đồng bộ**: gọi `POST /api/mmp/brands` (HMAC như các endpoint khác, body `{}`)
  → `{ ok, rule: 'title-case-first-letter-only', brands: [{ slug, displayName, status }] }`
  — apply danh sách này + áp cùng quy tắc khi tạo brand mới phía MMP.
