# MMP ⇄ SMS — Ship hộ Brand Self-Service API (cho team MMP)

**Đối tượng:** team MMP triển khai function "brand tự tạo đơn ship hộ + xem giá dự kiến" trên MMP portal.
**Vai trò:** SMS (meanblvd) là backend/nguồn sự thật; MMP dựng UI cho brand và gọi các API dưới đây.
**Trạng thái:** v1 — Estimate + Tạo đơn (Express Delivery). Webhook cập nhật trạng thái ở mục 4 (SMS build sau; contract để MMP chuẩn bị).

---

## 0. Nguyên tắc

- Chỉ **brand được duyệt** mới dùng được (SMS kiểm tra theo `brandSlug`). Brand chưa duyệt → `403`.
- Dịch vụ hiển thị cho brand: **"Express Delivery"** (đang có) và **"Standard Delivery"** (sắp có). **Không** dùng tên hãng vận chuyển ở bất kỳ đâu.
- Giá trả về là **giá dự kiến (provisional)** theo cân nặng & kích thước brand khai báo. **Hóa đơn cuối** tính lại theo **cân & phụ phí thực tế** khi đơn vị vận chuyển xuất bill.
- Tiền tệ: **VND** (số nguyên đồng).

## 1. Xác thực (HMAC SHA-256)

Mọi request MMP→SMS phải ký:

```
signature = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
Headers:
  X-MEAN-Signature: sha256=<hex>
  X-MEAN-Timestamp: <unix-seconds>
  Content-Type: application/json
```

- `secret`: khóa chia sẻ (SMS cấp; env `MMP_WEBHOOK_SECRET`). `timestamp` = giây Unix; lệch > **300s** bị từ chối.
- `rawBody` là **chuỗi JSON gửi đi nguyên văn** — ký trên đúng byte đó (không re-serialize sau khi ký).
- Sai/thiếu chữ ký → `401 { error, reason }`.

## 2. Estimate giá — `POST /api/mmp/ship-ho/estimate`

Gọi mỗi khi brand nhập/đổi thông tin kiện để hiện giá dự kiến.

**Request body**
```json
{
  "brandSlug": "kalisa",
  "parcel": {
    "country": "US",
    "city": "Riyadh",
    "postcode": "10001",
    "weightKg": 1.2,
    "dimLengthCm": 30,
    "dimWidthCm": 20,
    "dimHeightCm": 10,
    "packagingType": "box",
    "service": "express",
    "directSignature": false,
    "streetLines": ["123 Main St", "Apt 4B"],
    "stateOrProvinceCode": "NY"
  }
}
```
- Bắt buộc: `brandSlug`, `parcel.country` (ISO-2), `parcel.weightKg` > 0.
- Tùy chọn: `city`, `postcode`, `dim*`, `packagingType` (`"bag" | "box"`), `service` (`"express"` mặc định; `"standard"` → `422 service_unavailable`).
- Tùy chọn — **Direct Signature (Pha 1, đang chạy):**
  - `directSignature` (boolean, mặc định `false`) — brand yêu cầu ký nhận trực tiếp không. Chỉ cộng phí khi `= true` VÀ nước hỗ trợ dịch vụ (`directSignatureAvailable` trong response).
- Tùy chọn — **Residential chính xác (Pha 2, khi MMP gửi street):**
  - `streetLines` (string[]) — dòng địa chỉ chi tiết để SMS xác thực nhà dân vs công ty qua FedEx API. Chưa gửi → Pha 1 mặc định US/CA là nhà dân.
  - `stateOrProvinceCode` (string) — tỉnh/bang để validation. Tùy chọn, dùng kèm `streetLines`.

**Response 200**
```json
{
  "ok": true,
  "estimate": {
    "chargedVnd": 189540,
    "currency": "VND",
    "provisional": true,
    "service": "express",
    "lines": [
      { "label": "Cước cơ bản (Express Delivery)", "amountVnd": 130000 },
      { "label": "Phụ phí vùng/địa chỉ", "amountVnd": 20000 },
      { "label": "Phụ phí xăng dầu", "amountVnd": 25500 },
      { "label": "VAT", "amountVnd": 14040 }
    ],
    "notes": [
      "Giá dự kiến theo cân nặng & kích thước khai báo; hóa đơn cuối tính theo cân & phụ phí thực tế.",
      "Phụ phí xăng dầu áp theo tuần giao hàng của đơn vị vận chuyển.",
      "Đã gồm VAT."
    ],
    "directSignatureAvailable": true,
    "directSignatureFeeVnd": 92700
  }
}
```
- `lines` cộng lại = `chargedVnd` (hiển thị trực tiếp cho brand).
- `directSignatureAvailable` (boolean) — nước đích có hỗ trợ ký nhận trực tiếp không. **MMP chỉ hiển thị toggle "Yêu cầu ký nhận" khi = `true`.**
- `directSignatureFeeVnd` (number) — phí ký nhận (92700₫/đơn) để MMP hiển thị nhãn. **Chỉ cộng vào `chargedVnd` khi `directSignature=true` ở request VÀ nước hỗ trợ.** Mặc định (`false`/omit) KHÔNG gồm phí này.

**Lỗi**
| HTTP | `code` | Ý nghĩa |
|---|---|---|
| 400 | `bad_input` | thiếu field / cân ≤ 0 |
| 401 | — | HMAC sai |
| 403 | `brand_not_approved` | brand chưa được duyệt dịch vụ |
| 422 | `quote_failed` | không tính được cước tuyến này |
| 422 | `no_carrier` | chưa cấu hình dịch vụ |
| 422 | `service_unavailable` | `standard` chưa mở |

### Ghi chú: Residential & Direct Signature

**Residential (phân loại nhà dân/công ty):**
- **Pha 1 (hiện tại):** Mặc định US/CA = nhà dân (phụ phí nhà dân đã gồm trong cước). Các nước khác = công ty.
- **Pha 2 (khi MMP gửi `streetLines`):** SMS xác thực chính xác từng địa chỉ qua FedEx Address Validation API; phí nhà dân chỉ cộng khi địa chỉ là nhà dân thực tế.

**Direct Signature (ký nhận trực tiếp):**
- Chỉ áp dụng nước hỗ trợ (kiểm `directSignatureAvailable` trong response).
- Khi brand chọn `directSignature: true` ở request:
  - SMS cộng thêm `directSignatureFeeVnd` (92700₫) vào cước.
  - `chargedVnd` trong response = cước cơ bản + phụ phí + phí ký nhận + VAT.
- Khi brand không chọn (`directSignature: false` hoặc omit):
  - MMP **không cộng phí ký nhận**.
  - `chargedVnd` = cước cơ bản + phụ phí (không gồm ký nhận) + VAT.
- MMP chỉ hiển thị tùy chọn "Yêu cầu ký nhận" khi `directSignatureAvailable: true`.

## 3. Tạo đơn — `POST /api/mmp/ship-ho/orders`

Gọi khi brand xác nhận tạo đơn. **SMS sinh mã đơn mới** và trả về; MMP lưu map `mmpRef ↔ code`.

**Request body**
```json
{
  "brandSlug": "kalisa",
  "mmpRef": "MMP-ORDER-000123",
  "recipient": { "name": "Nguyen A", "phone": "+966 5xxxxxxx" },
  "address": {
    "country": "SA",
    "city": "Riyadh",
    "postcode": "12345",
    "address1": "…",
    "houseNumber": "12B",
    "shortAddress": "RBMA4176",
    "mapsUrl": "https://maps.app.goo.gl/…"
  },
  "parcel": {
    "country": "SA", "weightKg": 1.2,
    "dimLengthCm": 30, "dimWidthCm": 20, "dimHeightCm": 10,
    "packagingType": "box"
  }
}
```
- Bắt buộc: `brandSlug`, `mmpRef` (id đơn phía MMP — dùng để **idempotency**), `address.country`, `parcel.weightKg`.
- **Trường địa chỉ theo quốc gia** (bắt buộc theo nước):
  - **SA (Saudi Arabia):** cần `shortAddress` (định dạng 4 chữ + 4 số, vd `RBMA4176`) **hoặc** `mapsUrl` (link http/https).
  - **AE, QA, KW, BH, OM:** cần `houseNumber`.
  - Thiếu → `400 bad_input`.

**Response 200**
```json
{ "ok": true, "orderId": "uuid", "code": "SH1000", "idempotent": false, "estimate": { /* như mục 2 */ } }
```
- Gửi lại cùng `mmpRef` → trả đơn cũ với `idempotent: true` (không tạo trùng).
- `code` là **mã đơn SMS** (hiện dạng tạm `SH{n}`; sẽ đổi theo format chính thức sau — MMP luôn map theo `mmpRef`).

**Lỗi:** như mục 2 (`400/401/403/422`) + `bad_input` khi thiếu trường địa chỉ theo nước.

**Sau khi tạo:** đơn vào hàng xử lý của MEAN (chọn dịch vụ, book vận chuyển, ship). Trạng thái/tracking/đối soát cập nhật về MMP qua webhook (mục 4).

## 4. Webhook SMS → MMP (cập nhật trạng thái — v2, contract để chuẩn bị)

SMS sẽ **push** cập nhật để brand thấy tiến độ, chi phí cuối, và việc cần làm. MMP cung cấp 1 endpoint nhận:

```
POST {MMP_URL}/ship-ho/order-updates
Headers: X-MEAN-Signature, X-MEAN-Timestamp (HMAC như mục 1)
Body (envelope): { "event": string, "mmpRef": string, "code": string, "occurredAt": ISO8601, "data": {…} }
```
- **Idempotent** phía MMP theo (`mmpRef`, `event`, `occurredAt`). SMS retry tới khi nhận `200`.
- Backfill: MMP có thể gọi `GET /api/mmp/ship-ho/orders?updatedSince=<ISO8601>` để đồng bộ bù khi lỡ webhook.

**Danh mục sự kiện**

| Nhóm | `event` | Ý nghĩa (brand thấy) |
|---|---|---|
| Tiếp nhận | `order.received` | SMS đã nhận đơn + mã |
| | `order.accepted` | Đã nhận xử lý |
| | `order.needs_info` | Thiếu thông tin (địa chỉ…) — cần brand bổ sung |
| | `order.rejected` | Không nhận (kèm lý do) |
| | `order.cancelled` | Đã hủy |
| Giá | `order.priced` | Chốt giá (kèm chênh vs dự kiến + lý do) |
| Vận chuyển | `shipment.booked` | Đã tạo vận đơn (`trackingNumber`, "Express Delivery", dự kiến giao) |
| | `shipment.picked_up` / `in_transit` / `customs` / `out_for_delivery` | Mốc hành trình |
| | `shipment.exception` | Sự cố (delay/kẹt/giao lỗi) + hành động cần |
| | `shipment.delivered` | Đã giao (thời điểm, POD nếu có) |
| | `shipment.returned` | Hoàn hàng |
| Tài chính | `order.reconciled` | Cước thực về → **giá cuối** (có thể khác dự kiến) |
| | `statement.issued` | Bảng kê kỳ: danh sách đơn, tổng phải trả, hạn |
| | `statement.paid` / `statement.overdue` | Thanh toán / quá hạn (công nợ) |

**MMP→SMS bổ sung (v2):** `order.updated` (brand sửa khi chưa xử lý), `order.cancel_requested`, `order.price_accepted` (nếu giá cuối lệch quá ngưỡng).

## 5. Ghi chú tích hợp

- Rate card cơ bản mỗi brand (bảng giá theo zone × mức cân, **giá đã gồm markup của brand**) sẽ được SMS cung cấp để MMP hiển thị (push hoặc `GET .../ratecard?brandSlug=` — v2). Estimate (mục 2) là nguồn giá chính xác theo từng kiện.
- Không cache giá lâu ở MMP: phụ phí xăng dầu đổi theo tuần; luôn gọi estimate khi brand chốt.
- Mọi số tiền là VND nguyên đồng. Không suy luận margin/cước gốc — SMS không cung cấp các số đó.
