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
      { "label": "Phí giao nhà dân", "amountVnd": 84400 },
      { "label": "Ký nhận trực tiếp (Direct Signature)", "amountVnd": 92700 },
      { "label": "Phụ phí xăng dầu", "amountVnd": 25500 },
      { "label": "Phí xử lý đơn hàng", "amountVnd": 50000 },
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
- `lines` cộng lại = `chargedVnd` (hiển thị trực tiếp cho brand). Các dòng phụ phí tách RIÊNG khi > 0 để minh bạch: **"Phí giao nhà dân"** (residential) và **"Ký nhận trực tiếp (Direct Signature)"** chỉ xuất hiện khi thực sự áp; nếu = 0 thì ẩn. `lines` là danh sách động — MMP render nguyên si theo thứ tự trả về.
- `directSignatureAvailable` (boolean) — nước đích có hỗ trợ ký nhận trực tiếp không. **MMP chỉ hiển thị toggle "Yêu cầu ký nhận" khi = `true`.**
- `directSignatureFeeVnd` (number) — phí ký nhận (92700₫/đơn) để MMP hiển thị nhãn. **Chỉ cộng vào `chargedVnd` khi `directSignature=true` ở request VÀ nước hỗ trợ.** Mặc định (`false`/omit) KHÔNG gồm phí này.
- **Tier chiết khấu (từ 09/07/2026):** response thêm `tierName` + `discountPct`; `lines` gồm dòng `"Cước cơ bản — bảng giá gốc (…)"` và dòng ÂM `"Chiết khấu {tier} (−d% bảng giá gốc)"` — MMP render nguyên si (tổng lines vẫn = `chargedVnd`). Chi tiết bậc tier: xem doc ratecard.

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
- **Nước FedEx MIỄN Direct Signature (fix 08/07/2026):** FedEx không thu phí ký nhận ở 13 nước: **SA, QA, IL, IQ, OM, KZ, JO, MC, LU, CY, CZ, PE, AO**. Các nước này trả `directSignatureAvailable: false` ⇒ MMP ẩn toggle. Trước đây SA/IL/LU/CZ trả `available: true` nhưng bật DS lại không cộng phí (mâu thuẫn) — nay đã khớp: hoặc available+cộng phí, hoặc unavailable+ẩn toggle.

## 3. Tạo đơn — `POST /api/mmp/ship-ho/orders`

Gọi khi brand xác nhận tạo đơn. **SMS sinh mã đơn mới** và trả về; MMP lưu map `mmpRef ↔ code`.

**Request body**
```json
{
  "brandSlug": "kalisa",
  "mmpRef": "26-INSLG-SV-000123",
  "customerRef": "ORD-BRAND-2024-001",
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
- Bắt buộc: `brandSlug`, `mmpRef` (mã đơn hệ thống MMP tạo — **dùng làm `code` hiển thị ở danh sách; cũng dùng để idempotency**), `address.country`, `parcel.weightKg`.
- Tùy chọn: `customerRef` (mã đơn gốc của khách/brand để đối soát/track — SMS hiển thị cột "Mã đơn gốc"; nếu không gửi, cột để trống —).
- **Trường địa chỉ theo quốc gia** (bắt buộc theo nước):
  - **SA (Saudi Arabia):** cần `shortAddress` (định dạng 4 chữ + 4 số, vd `RBMA4176`) **hoặc** `mapsUrl` (link http/https).
  - **AE, QA, KW, BH, OM:** cần `houseNumber`.
  - Thiếu → `400 bad_input`.

**Response 200**
```json
{ "ok": true, "orderId": "uuid", "code": "26-INSLG-SV-000123", "idempotent": false, "estimate": { /* như mục 2 */ } }
```
- Gửi lại cùng `mmpRef` → trả đơn cũ với `idempotent: true` (không tạo trùng).
- `code` **bằng đúng `mmpRef`** đã gửi (mã MMP tạo, `26-INSLG-SV-XXXX`) — SMS dùng làm mã đơn hiển thị. MMP map theo `mmpRef` (= `code`).

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
| Giá | `order.measured` | SMS (Inecso) cân/đo lại kiện tại kho — **luôn gửi** (khớp hay lệch). MMP ghi kết quả lên đơn của brand; giá mới (nếu đổi) nằm trong `data.price`. Chi tiết payload: mục 4b. |
| Vận chuyển | `shipment.booked` | Đã tạo/SỬA vận đơn. `data`: `{ trackingNumber, carrierKey ("fedex"\|"dhl"\|null), trackingUrl (link tra cứu public\|null), service, previousTrackingNumber? }`. Bắn lại mỗi lần tracking/carrier đổi — bản `occurredAt` mới nhất là hiện hành; `previousTrackingNumber` có mặt khi SỬA mã (MMP thay mã cũ). |
| | `shipment.picked_up` / `in_transit` / `customs` / `out_for_delivery` | Mốc hành trình |
| | `shipment.exception` | Sự cố (delay/kẹt/giao lỗi) + hành động cần |
| | `shipment.delivered` | Đã giao (thời điểm, POD nếu có) |
| | `shipment.returned` | Hoàn hàng |

### Đơn khởi tạo TỪ SMS (origin `sms`) — từ 20/07/2026 · ĐÃ CHỐT 4 CÂU HỎI CỦA MMP

Brand có thể đưa hàng trực tiếp cho MEAN mà không tạo đơn trên MMP → SMS tạo đơn hộ
và ĐẨY sang MMP để brand vẫn thấy đơn + giá trên portal.

**Q1 — Ai sinh ref?** **SMS sinh**, format riêng **`YY-INSMS-SV-NNNN`** (prefix `INSMS`
≠ `INSLG` → hai counter độc lập, không bao giờ đụng khoá; NNNN reset theo năm phía SMS).
MMP **KHÔNG** sinh gì thêm và **KHÔNG parse format** — dùng `mmpRef` như **chuỗi opaque**
làm khoá duy nhất. (Vài đơn cũ tạo trước 20/07 mang mã tự do, vd `#KLS1996` — vẫn là khoá
nguyên văn, đừng reject theo format.) `ShipHoCounter` của MMP giữ nguyên cho đơn MMP tạo.

**Q2 — Phân biệt origin?** Field **`origin`** trong envelope — SMS ĐÃ gửi (deploy 20/07):
envelope nay là `{ event, mmpRef, code, origin: 'mmp'|'sms', occurredAt, data }` cho MỌI
event (đơn MMP tạo cũng có `origin:'mmp'`). Với origin sms: `mmpRef` = `code`.

**Q3 — PII?** Kênh ship-hộ **không phải** contract PII-minimal (đó là pipeline đơn BÁN
Shopify). Chiều MMP→SMS vốn đã gửi tên + SĐT + địa chỉ khi tạo đơn (mục 3); chiều SMS→MMP
gửi tương đương: `data.recipient { name, company, phone }` + `data.address { country, city,
province, postcode, address1, address2, houseNumber, shortAddress, mapsUrl }`. Cùng kênh
HMAC, cùng cấp dữ liệu.

**Q4 — Status + quyền sửa?** SMS chỉ bắn `order.received` SAU khi đã báo giá → MMP tạo đơn
ở trạng thái tương đương **"đã tiếp nhận & báo giá" (quoted)**, hiển thị `chargedVnd`.
**Brand KHÔNG sửa được** — nguồn sự thật là SMS (đơn nhận hàng vật lý tại kho); cần đổi
thông tin thì brand liên hệ MEAN, SMS sửa và re-emit `order.received` (upsert). MMP render
read-only + badge "Tạo bởi MEAN" (gợi ý).

**Idempotent:** cùng `mmpRef` không tạo trùng; `order.received` gửi lại (requote/sửa) =
upsert latest-wins theo `occurredAt`. Event khác tới trước `order.received` (retry lệch thứ
tự) → 409 như hiện tại, outbox SMS tự gửi lại.

**Chốt 2 câu hỏi build (20/07):**
- **`brandSlug` nằm trong `data.brandSlug`** — envelope KHÔNG có brandSlug. Thiếu → 422 là đúng.
- **Key giá là `chargedVnd`** (số nguyên VND) — đây là tên key JSON thật trên wire, không phải tên cột. MMP lấy `chargedVnd` làm primary và bỏ alias `pricedVnd`.
- `origin` gửi đúng chuỗi thường `"sms"` / `"mmp"` (normalize trim+lowercase phía MMP vẫn hoan nghênh — defense in depth).
- `occurredAt` của mỗi lần re-emit luôn là thời điểm emit (mới hơn bản trước) → upsert latest-wins an toàn.

**Fixture THẬT (envelope nguyên văn SMS ký gửi — đơn #KLS1996 trên prod):**
```jsonc
{
  "event": "order.received",
  "mmpRef": "#KLS1996",          // đơn cũ mã tự do; đơn mới: 26-INSMS-SV-NNNN
  "code": "#KLS1996",
  "origin": "sms",
  "occurredAt": "2026-07-20T14:00:07.787Z",
  "data": {
    "brandSlug": "kalisa",
    "customerRef": null,
    "recipient": { "name": "Shadyah AlSalem", "company": null, "phone": "+966 56 125 3658" },
    "address": {
      "country": "SA", "city": "Jeddah", "province": null, "postcode": "22843",
      "address1": "Makkah Province, Abdulah bin abdulatif Al sheikh, House: 0",
      "address2": null, "houseNumber": null,
      "shortAddress": "JRRR0000", "mapsUrl": "https://maps.app.goo.gl/fA5Bg996to6gCwGTA"
    },
    "country": "SA", "city": "Jeddah",
    "weightKg": 2.2, "dimLengthCm": 35, "dimWidthCm": 25, "dimHeightCm": 12,
    "packagingType": "box", "service": "express",
    "chargedVnd": 2152915, "createdVia": "sms"
  }
}
```

Đề xuất của MMP về doc `sms-ship-ho-order-created-build-requirements.md` phía repo MMP: OK —
mục này là nguồn chuẩn phía SMS, doc phía MMP là bản build-requirements đối chiếu.

### ⚠ `ratecard.updated` — trạng thái tích hợp (probe 17/07/2026)

SMS đã push thử với đủ biến thể envelope, kết quả phía MMP:

| Envelope | MMP trả | Nghĩa |
|---|---|---|
| `mmpRef: null` / thiếu `mmpRef` | 422 `{"error":"bad envelope"}` | Validator bắt buộc `mmpRef` là chuỗi |
| `mmpRef: "<brandSlug>"` | 409 `{"error":"order not found; retry later"}` | Qua validation nhưng receiver route MỌI event vào nhánh tra cứu ĐƠN HÀNG |

**MMP cần làm**: thêm nhánh xử lý event CẤP BRAND trước bước lookup đơn — khi
`event === 'ratecard.updated'`, key theo `code` (brandSlug), `data` = payload y hệt
response của endpoint pull `POST /api/mmp/ship-ho/ratecard`. SMS hiện gửi
`mmpRef = brandSlug` (chuỗi, để qua validator hiện tại).

| Tài chính | `order.reconciled` | Hoá đơn carrier về → **giá cuối**. `data`: `{ finalChargedVnd, previousChargedVnd, deltaVnd, billedWeightKg, reconcileResolution? }` — MMP cập nhật giá cuối cho brand (thay giá dự kiến). Bắn khi: (a) bill KHỚP dự tính (tự động), hoặc (b) operator **chấp nhận sai lệch** (lỗi nội bộ) — khi đó `reconcileResolution = "internal_error"`. Đơn CÓ sai lệch mà CHƯA duyệt thì KHÔNG bắn (giá giữ nguyên dự kiến). |
| Tài chính | `order.reconcile_pending` 🆕 | Bill carrier về CÓ sai lệch (chi phí thực ≠ dự tính) và **đang CHỜ operator duyệt**. MMP set đơn về trạng thái **"chờ đối soát"**, **GIỮ giá dự tính** (gỡ giá thực + nhãn "đã đối soát" nếu đã lỡ nhận trước đó); **KHÔNG** cập nhật giá cuối tới khi operator quyết định. `data`: `{ estimatedCostVnd, billedCostVnd, deltaVnd }`. Sau đó SMS gửi `order.reconciled` (chấp nhận/kết luận claim) hoặc `order.claim_pending` (đi claim). |
| Tài chính | `order.claim_pending` 🆕 | Bill về CÓ sai lệch và operator quyết định **đòi carrier** (claim). MMP set đơn sang trạng thái **"đợi claim đơn vị vận chuyển"**; **KHÔNG** cập nhật giá cuối (giữ giá dự kiến tới khi claim xong). `data`: `{ deltaVnd, estimatedCostVnd, billedCostVnd, reason (string\|null) }`. |
| Tài chính | `order.reconciled` (kết luận claim) 🆕 | Sau khi claim được KẾT LUẬN, SMS đẩy lại `order.reconciled` với `data.reconcileResolution = "claim_credited"` (carrier hoàn tiền chênh) hoặc `"claim_rejected"` (carrier từ chối). **Cả hai**: giá thu cuối = tính lại theo bill (`finalChargedVnd`). MMP gỡ trạng thái "đợi claim" + cập nhật giá cuối cho brand. |
| Bảng giá | `ratecard.updated` | Loại đối tác (tier/strategic) của brand đổi → SMS PUSH rate card mới. `code` = brandSlug, `mmpRef` = null, `data` = payload y hệt endpoint pull /ratecard (có `version`, `tierName`, `discountPct`, cells `rackVnd/offerVnd`). MMP thay bảng giá hiển thị cho brand NGAY; kênh pull vẫn dùng được như cũ. |
| | `statement.issued` | Bảng kê kỳ: danh sách đơn, tổng phải trả, hạn |
| | `statement.paid` / `statement.overdue` | Thanh toán / quá hạn (công nợ) |

**MMP→SMS bổ sung (v2):** `order.updated` (brand sửa khi chưa xử lý), `order.cancel_requested`, `order.price_accepted` (nếu giá cuối lệch quá ngưỡng).

### 4b. Event `order.measured` — SMS cân/đo lại tại kho

Khi hàng về kho, nhân viên SMS (Inecso) cân & đo lại kiện. **Mọi lần đo đều bắn event này** (khớp hay lệch) — cùng envelope + HMAC như các event khác (mục 4). MMP nhận và **ghi lên đơn hàng của brand**.

**Schema `data`:**

| Field | Kiểu | Ý nghĩa |
|---|---|---|
| `matched` | boolean | `true` = số SMS đo **khớp** brand khai (cân + kích thước + cân tính phí); `false` = lệch |
| `declared` | object | Số **brand khai** lúc tạo đơn: `{ weightKg, dimLengthCm, dimWidthCm, dimHeightCm, dimWeightKg, chargeableWeightKg }` (dim = L×W×H/5000; chargeable = max(cân, dim); dim `null` nếu không khai kích thước) |
| `measured` | object | Số **SMS đo** — cùng shape với `declared` |
| `delta.weightKg` | number | Chênh cân (đo − khai) |
| `delta.chargeableWeightKg` | number | Chênh **cân tính phí** (đây là số quyết định giá) |
| `price.changed` | boolean | Giá thu có đổi sau re-quote theo số đo không. LƯU Ý: có thể `matched=true` nhưng `price.changed=true` (fuel tuần mới) và ngược lại |
| `price.previousChargedVnd` | number\|null | Giá dự tính cũ (VND) |
| `price.chargedVnd` | number\|null | Giá dự tính MỚI (VND) — brand sẽ trả giá này |
| `price.deltaVnd` | number | Chênh giá (mới − cũ); `0` khi không đổi |
| `price.lines` | array? | CHỈ khi `changed=true`: cấu trúc giá mới `[{ label, amountVnd }]`, tổng = `chargedVnd` — render như estimate |

**Ví dụ 1 — KHỚP (MMP hiện "kho đã xác nhận số đo"):**
```json
{
  "event": "order.measured", "mmpRef": "26-INSLG-SV-0003", "code": "26-INSLG-SV-0003",
  "occurredAt": "2026-07-08T10:15:00.000Z",
  "data": {
    "matched": true,
    "declared": { "weightKg": 2, "dimLengthCm": 30, "dimWidthCm": 24, "dimHeightCm": 11, "dimWeightKg": 1.584, "chargeableWeightKg": 2 },
    "measured": { "weightKg": 2, "dimLengthCm": 30, "dimWidthCm": 24, "dimHeightCm": 11, "dimWeightKg": 1.584, "chargeableWeightKg": 2 },
    "delta": { "weightKg": 0, "chargeableWeightKg": 0 },
    "price": { "changed": false, "previousChargedVnd": 2012941, "chargedVnd": 2012941, "deltaVnd": 0 }
  }
}
```

**Ví dụ 2 — LỆCH + giá mới (MMP cập nhật giá hiển thị cho brand NGAY):**
```json
{
  "event": "order.measured", "mmpRef": "26-INSLG-SV-0002", "code": "26-INSLG-SV-0002",
  "occurredAt": "2026-07-08T10:20:00.000Z",
  "data": {
    "matched": false,
    "declared": { "weightKg": 2, "dimLengthCm": 30, "dimWidthCm": 24, "dimHeightCm": 10, "dimWeightKg": 1.44, "chargeableWeightKg": 2 },
    "measured": { "weightKg": 2.4, "dimLengthCm": 32, "dimWidthCm": 24, "dimHeightCm": 12, "dimWeightKg": 1.843, "chargeableWeightKg": 2.4 },
    "delta": { "weightKg": 0.4, "chargeableWeightKg": 0.4 },
    "price": {
      "changed": true, "previousChargedVnd": 2182684, "chargedVnd": 2350000, "deltaVnd": 167316,
      "lines": [
        { "label": "Cước cơ bản (Express Delivery)", "amountVnd": 1400000 },
        { "label": "Phụ phí vùng/địa chỉ", "amountVnd": 152700 },
        { "label": "Phụ phí xăng dầu", "amountVnd": 540000 },
        { "label": "Phí xử lý đơn hàng", "amountVnd": 50000 },
        { "label": "VAT", "amountVnd": 207300 }
      ]
    }
  }
}
```

**MMP cần làm khi nhận:**
1. Verify HMAC (`x-mean-signature` + `x-mean-timestamp`, secret outbound — như mọi event) → `200` để SMS ngừng retry.
2. Ghi lên đơn brand: `matched=true` → note "Kho đã cân/đo lại — khớp số khai"; `matched=false` → hiện `measured` vs `declared` + delta.
3. `price.changed=true` → **cập nhật giá hiển thị cho brand ngay** (`chargedVnd` mới + render `lines`); giá này thay giá quote cũ.
4. Idempotent theo (`mmpRef`, `event`, `occurredAt`) — đo lại nhiều lần sinh nhiều event, lần mới nhất (occurredAt lớn nhất) là hiện hành.

## 5. Ghi chú tích hợp

- Rate card cơ bản mỗi brand (bảng giá theo zone × mức cân, **giá đã gồm markup của brand**) sẽ được SMS cung cấp để MMP hiển thị (push hoặc `GET .../ratecard?brandSlug=` — v2). Estimate (mục 2) là nguồn giá chính xác theo từng kiện.
- Không cache giá lâu ở MMP: phụ phí xăng dầu đổi theo tuần; luôn gọi estimate khi brand chốt.
- Mọi số tiền là VND nguyên đồng. Không suy luận margin/cước gốc — SMS không cung cấp các số đó.
