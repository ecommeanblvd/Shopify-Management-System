# Ship hộ — Brand self-service tạo đơn + estimate (SMS ⇄ MMP) — DRAFT

**Ngày:** 2026-07-03
**Trạng thái:** DRAFT thiết kế (để build sau) — đã duyệt hướng

## Bối cảnh

Brand (khách hàng của MEAN) thao tác trên **MMP portal** (hệ merchant riêng). Dữ liệu ship hộ
(bảng giá, đơn, đối soát, công nợ) nằm ở **SMS** (repo này). Yêu cầu: brand **được approve** (hiện tại
là Kalisa) có thể **tự tạo đơn ship hộ** và **estimate giá ngay khi tạo**, ngay trong MMP.

Vì UI ở MMP còn dữ liệu/logic ở SMS, function này về bản chất là **API do SMS expose cho MMP gọi**
(không phải trang trong repo này). SMS đã có sẵn tích hợp MMP↔SMS qua API route ký **HMAC**
(`app/api/mmp/*`, `verifyMmpSignature`, header `X-MEAN-Signature`/`X-MEAN-Timestamp`,
`MMP_WEBHOOK_SECRET`). Draft này bám đúng pattern đó.

## Phạm vi

**Trong phạm vi (draft này):**
- Cổng approve theo brand (chỉ brand approve mới dùng function).
- API **estimate** giá cho 1 kiện theo bảng giá của brand (giá thu + tách phụ phí) — **1 quote duy nhất, FedEx làm chuẩn**, service line **Express** (Standard build sau).
- API **nhận đơn** brand tạo → **SMS sinh mã order mới** + tạo đơn ship hộ (source='mmp') cho MEAN xử lý & ship.
- **Webhook SMS→MMP** cập nhật trạng thái/tracking/đối soát của đơn cho brand (đồng bộ 2 chiều).
- Core dùng chung để estimate + intake tính giá nhất quán.

**Ngoài phạm vi (làm sau, đã chừa chỗ trong thiết kế):**
- UI phía MMP (do team MMP xây dựng, gọi API dưới đây).
- **Service line Standard** (build sau; Express trước) — cùng core, chỉ chọn account FedEx Standard.
- API đọc **thanh toán / công nợ** chi tiết cho brand (tái dùng statement/AR — đợt sau; webhook trạng thái làm trước).
- Tự động chọn carrier / auto-confirm đơn (giữ luồng MEAN duyệt thủ công).

## Quyết định

| Nội dung | Chốt |
|---|---|
| Nơi đặt function | API trong SMS (`app/api/mmp/ship-ho/*`), MMP gọi. UI ở MMP. |
| Auth | HMAC như `order-confirmations` (secret dùng chung `MMP_WEBHOOK_SECRET`), replay-protection sẵn có. |
| Định danh brand | `brandSlug` trong body — validate + approve-check server-side (không tin client). |
| Cổng approve | Cột `self_service_enabled boolean default false` trên `ship_ho_partners`. Kalisa = true. |
| Cơ sở giá estimate | **1 quote duy nhất, FedEx làm chuẩn (nội bộ)**. Service line brand-facing: **Express Delivery** (build ngay), **Standard Delivery** (build sau). Không quote được tuyến → lỗi rõ. |
| Định danh trung tính | Brand CHỈ thấy **"Express Delivery" / "Standard Delivery"** + nhãn phụ phí trung tính ("phụ phí xăng dầu theo hãng vận chuyển"…). **Tuyệt đối không lộ tên hãng (FedEx)** trong bất kỳ response/webhook nào gửi brand. |
| Giá hiển thị brand | Giá thu (chargedVnd) + **tách phụ phí** (base offer, fuel, phụ phí, VAT) — nhãn trung tính. Ẩn carrierCost/margin/markup/tên hãng. |
| Mã đơn | **SMS sinh mã order mới** (canonical, unique) khi nhận đơn. Hiện dùng **dãy số tuần tự tạm** (backfill lại khi có format chính thức); lưu `mmp_ref` để map + idempotency; trả mã SMS về MMP. |
| Luồng đơn brand | Vào `ship_ho_orders` với `source='mmp'`, status `draft` → MEAN chọn carrier/confirm/ship (luồng hiện có). Không thêm status enum mới. |
| Cập nhật cho brand | **Webhook SMS→MMP** (ký HMAC) đẩy trạng thái/tracking/đối soát khi đơn đổi trạng thái. |
| Idempotency | `mmp_ref` unique — resubmit trả đơn cũ (kèm mã SMS đã sinh). |

## Kiến trúc

```
Brand ── UI ──►  MMP Portal  ──HMAC──►  SMS API (repo này)  ──►  ship_ho_orders / rate card
                                         estimate + intake        (MEAN xử lý, ship)
```

### 1. DB (migration)

- `ship_ho_partners`: `+ self_service_enabled boolean NOT NULL DEFAULT false`.
- `ship_ho_orders`:
  - `+ source text NOT NULL DEFAULT 'internal'` ('internal' | 'mmp').
  - `+ mmp_ref text` với unique index (partial, chỉ khi not null) để idempotency + map mã MMP↔SMS.
  - `+ service text` ('express' | 'standard'; brand order mặc định 'express').
- Cập nhật `db/schema.ts` tương ứng. Set `self_service_enabled = true` cho Kalisa (data op một lần).

### 2. Core dùng chung — `features/ship-ho/estimate.ts`

```ts
export type ShipHoService = 'express' | 'standard'; // Standard build sau
export interface EstimateParcel {
  country: string; city?: string; postcode?: string;
  weightKg: number;
  dimLengthCm?: number; dimWidthCm?: number; dimHeightCm?: number;
  packagingType?: 'bag' | 'box' | null;
  service?: ShipHoService; // default 'express'; 'standard' → 'service_unavailable' cho tới khi build
}
export interface EstimateLine { label: string; amountVnd: number }
export interface BrandEstimate {
  chargedVnd: number;
  currency: 'VND';
  lines: EstimateLine[];   // markedBase, phụ phí, fuel, VAT — cộng lại = chargedVnd (Option A, mục 2b)
  provisional: true;       // giá dự kiến theo dim/cân khai báo; bill cuối theo số thực (mục 2c)
  notes: string[];         // nhãn trung tính, không tên hãng
}
export type EstimateResult =
  | { ok: true; estimate: BrandEstimate }
  | { ok: false; error: string; code: 'brand_not_approved' | 'no_fedex' | 'quote_failed' | 'service_unavailable' | 'bad_input' };

/** I/O: nạp partner (approve+markup), quote FedEx theo service line, tính giá brand (Option A, mục 2b), dựng breakdown minh bạch. */
export async function estimateForBrand(brandSlug: string, parcel: EstimateParcel): Promise<EstimateResult>;
```

Logic:
- Nạp partner theo `brandSlug`; nếu không có / `status!='active'` / `!self_service_enabled` → `brand_not_approved`.
- Service: mặc định `express`. `standard` → `service_unavailable` (chưa build). Chỉ 1 quote duy nhất, không so sánh nhiều line.
- Chọn account FedEx **Express** đang bật (định danh qua carrierKey/serviceKey — chốt map khi build); không có → `no_fedex`.
- `quoteShipHoOrder(...)` cho parcel → nếu fail → `quote_failed`.
- Tính giá brand theo **Công thức giá brand (mục 2b)** — KHÔNG dùng `computeOffer`.
- `lines`: `Cước cơ bản (Express Delivery) = markedBase`, `Phụ phí vùng/địa chỉ`, `Phụ phí xăng dầu`, `VAT`. Tổng `lines` = `chargedVnd` (bất biến, test).
- `notes`: nhãn surcharge **trung tính** (không dùng `SURCHARGE_LABELS` cũ vì có chữ "FedEx" — cần map brand-facing riêng, vd "Phụ phí xăng dầu (theo hãng vận chuyển)") + câu "phụ phí/fuel/VAT tính theo hãng khi xuất bill".
- Nhãn service trong response: `label: 'Express Delivery' | 'Standard Delivery'`.
- **Tuyệt đối không** trả `carrierCostVnd`, `marginVnd`, `markupPercent`, hay tên hãng.

### 2b. Công thức giá brand (Option A — fuel/VAT trên base đã markup)

Khác giá **nội bộ** (`computeOffer`: markup CHỈ trên base, fuel/VAT pass-through trên base gốc), giá **brand-facing** áp
fuel & VAT lên **base đã markup**:

```
markedBase  = round(baseVnd × (1 + markup/100))              // markup ≥ 30%; baseVnd = base FedEx quy VND
subtotal    = markedBase + surcharges                        // phụ phí địa chỉ (remote/residential/demand/countryFixed/perStep/peak…)
fuel        = fuelPercent × (markedBase + fuelableSurcharges) // fuel% theo TUẦN SHIP
vat         = vatPercent × (subtotal + fuel)                 // VAT ở cuối
chargedVnd  = subtotal + fuel + vat
```

- Tương đương chạy engine FedEx với dòng **base thay bằng `base×(1+markup)`** rồi giữ nguyên luật fuel/VAT/surcharge của engine.
  Impl gọn nhất: thêm tuỳ chọn `baseMarkupPct` vào engine `quote()` (inflate base sau lookup, trước fuel/VAT), hoặc dựng buildup
  thuần từ `breakdown`. **Chốt cách impl khi build** (lưu ý discount: brand KHÔNG hưởng volume discount FedEx).
- **Đơn brand (`source='mmp'`) lưu `chargedVnd` theo công thức này**, KHÔNG dùng `computeOffer`. Đơn nội bộ giữ nguyên `computeOffer`.
  *(Có thể hợp nhất 2 mô hình sau — ngoài phạm vi draft.)*
- Hàm thuần đề xuất: `computeBrandCharge(breakdownVnd, markupPercent) → { chargedVnd, lines }` (test kỹ; tổng `lines` == `chargedVnd`).

### 2c. Rate card brand đẩy sang MMP + luồng estimate → rebill

- **Rate card mỗi brand** (base × (1+markup), markup ≥ 30%) sinh bằng `buildRateCard` → **push sang MMP** để hiển thị bảng giá cơ bản.
  Cập nhật khi đổi markup/rate (webhook `ratecard.updated` SMS→MMP, hoặc MMP pull `GET /api/mmp/ship-ho/ratecard?brandSlug=`).
- **Estimate lúc tạo đơn (dự kiến):** MMP gọi API estimate → SMS check địa chỉ + phụ phí, ghép rate card quote + fuel (tuần ship) + VAT
  theo **dim & cân brand tự đo** → giá dự kiến. Đây là giá **tạm tính**.
- **Rebill sau khi có bill carrier (chốt):** khi carrier xuất bill, SMS cập nhật **cân thực + phụ phí thực (nếu bị charge thêm)** →
  **tính lại `chargedVnd`** bằng đúng công thức 2b trên số thực + rate card brand → **tạo bill** cho brand thanh toán (event `order.reconciled`
  + `statement.issued`). Chênh estimate↔bill được nêu rõ cho brand.

### 3. API estimate — `app/api/mmp/ship-ho/estimate/route.ts`

- `POST`, `runtime='nodejs'`, `dynamic='force-dynamic'`.
- Verify HMAC (đọc `rawBody` text trước khi parse). Thiếu secret → 500; sai chữ ký → 401.
- Parse body: `{ brandSlug: string, parcel: EstimateParcel }` (`parcel.service` optional, default `express`). Thiếu field bắt buộc (`brandSlug`, `parcel.country`, `parcel.weightKg`>0) → 400.
- Gọi `estimateForBrand`. Map lỗi → HTTP: `brand_not_approved`→403, `no_fedex`/`quote_failed`→422, `service_unavailable`→422, `bad_input`→400.
- Thành công → 200 `{ ok: true, estimate }`.

### 4. API nhận đơn — `app/api/mmp/ship-ho/orders/route.ts`

- `POST`, verify HMAC như trên.
- Body:
  ```ts
  {
    brandSlug: string;
    mmpRef: string;                 // id đơn phía MMP — idempotency
    recipient: { name?: string; phone?: string };
    address: {
      country: string; city?: string; province?: string; postcode?: string;
      address1?: string; address2?: string;
      houseNumber?: string; shortAddress?: string; mapsUrl?: string;  // country-specific
    };
    parcel: EstimateParcel;         // weight/dims/packaging/country
  }
  ```
- Validate: brand approve (như core); `mmpRef` bắt buộc; địa chỉ theo nước qua `validateAddressExtra(address.country, {...})`.
- Idempotency: nếu đã có `ship_ho_orders.mmp_ref = mmpRef` → trả đơn cũ `{ ok:true, idempotent:true, orderId, code }` (kèm mã SMS đã sinh).
- Tạo đơn:
  - **SMS sinh mã order mới** (`code`) — canonical, unique. **Tạm thời**: dãy số tuần tự (vd sequence/counter zero-pad, hoặc cột `order_seq` bigserial → format `SH{n}`), đảm bảo unique như ràng buộc hiện có. **Backfill lại** theo format chính thức khi khách gửi (thêm cột lưu seq gốc để re-map an toàn). MMP KHÔNG quyết mã; `mmpRef` chỉ để map + idempotency.
  - `source='mmp'`, `mmp_ref=mmpRef`, `service` (express), `partner_brand_slug=brandSlug`, các field địa chỉ + country-specific, parcel.
  - Snapshot giá **dự kiến** qua `estimateForBrand` (Option A) → lưu `chargedVnd` + breakdown + `quotedAt`, status `draft`. *(Giá tạm tính theo dim/cân khai báo; MEAN chốt carrier + rebill theo số thực khi có bill carrier — mục 2c.)*
- Trả `{ ok:true, orderId, code, estimate }` — `code` là mã SMS mới sinh để MMP lưu map.

### 4b. Đồng bộ sự kiện MMP ⇄ SMS (thông tin xuyên suốt)

Mục tiêu: brand luôn biết **đơn đang ở đâu, phải trả bao nhiêu, có cần làm gì**. SMS là nguồn sự thật; MMP hiển thị.
Vận chuyển qua webhook ký **HMAC** (convention `X-MEAN-Signature`/`X-MEAN-Timestamp`), hàng đợi + cron retry
như `order-outbound`/`retry-mmp-orders`. Idempotent theo `mmpRef` + `event` + `occurredAt`. **Mọi payload gửi brand
đều trung tính** (không tên hãng; service = "Express/Standard Delivery").

Bổ sung backfill: MMP có thể gọi `GET /api/mmp/ship-ho/orders?updatedSince=<ts>` để đồng bộ bù khi webhook miss.

Envelope chung: `{ event, mmpRef, code, occurredAt, data }`.

#### A. Tạo & tiếp nhận đơn
| Hướng | Event | Kích hoạt | `data` chính (brand-facing) |
|---|---|---|---|
| MMP→SMS | `order.created` | Brand tạo đơn | recipient, address, parcel, service → SMS trả `code` + estimate |
| MMP→SMS | `order.updated` | Brand sửa khi còn `draft` | field thay đổi (chặn sau khi đã xử lý) |
| MMP→SMS | `order.cancel_requested` | Brand xin huỷ khi chưa ship | lý do |
| SMS→MMP | `order.received` | SMS nhận + gán mã | `code`, estimate snapshot |
| SMS→MMP | `order.accepted` | MEAN nhận xử lý | eta xử lý (nếu có) |
| SMS→MMP | `order.needs_info` | Địa chỉ/thiếu thông tin | field cần bổ sung (vd short-address SA) |
| SMS→MMP | `order.rejected` | MEAN không nhận | lý do (ngoài vùng, sai địa chỉ) |
| SMS→MMP | `order.cancelled` | Huỷ được chấp nhận | — |

#### B. Giá & báo giá
| Hướng | Event | Kích hoạt | `data` |
|---|---|---|---|
| SMS→MMP | `order.priced` | MEAN chốt line + giá cuối | `chargedVnd` cuối, lines (tách phụ phí), chênh lệch vs estimate + lý do |
| MMP→SMS | `order.price_accepted` | Brand đồng ý giá (nếu lệch > ngưỡng) | — |

#### C. Vận chuyển & tracking (cập nhật liên tục)
| Hướng | Event | Kích hoạt | `data` |
|---|---|---|---|
| SMS→MMP | `shipment.booked` | Đã tạo vận đơn | `trackingNumber`, service ("Express Delivery"), dự kiến giao |
| SMS→MMP | `shipment.picked_up` | Lấy hàng | thời điểm |
| SMS→MMP | `shipment.in_transit` | Mốc quét chặng | vị trí/mô tả trung tính, thời điểm |
| SMS→MMP | `shipment.customs` | Đang thông quan | trạng thái, hành động cần (nếu có) |
| SMS→MMP | `shipment.exception` | Delay/giao lỗi/kẹt | loại lỗi + hành động brand cần làm |
| SMS→MMP | `shipment.out_for_delivery` | Đang giao | — |
| SMS→MMP | `shipment.delivered` | Đã giao | thời điểm, POD (nếu có) |
| SMS→MMP | `shipment.returned` | Hoàn hàng (RTO) | lý do |

#### D. Đối soát & công nợ (tài chính)
| Hướng | Event | Kích hoạt | `data` |
|---|---|---|---|
| SMS→MMP | `order.reconciled` | Cước thực về, chốt giá cuối | `chargedVnd` cuối (nếu điều chỉnh), trạng thái đối soát |
| SMS→MMP | `statement.issued` | Phát hành bảng kê kỳ | kỳ, danh sách đơn, tổng phải trả, hạn thanh toán |
| SMS→MMP | `statement.paid` | Ghi nhận thanh toán | số tiền, còn lại (công nợ) |
| SMS→MMP | `statement.overdue` | Quá hạn | số tiền quá hạn, số ngày |

#### E. Độ tin cậy hệ thống
- `sync.heartbeat` định kỳ (optional) + endpoint backfill `updatedSince` để MMP tự bù khi mất webhook.
- Mọi event lưu outbox (bảng `mmp_ship_ho_events` hoặc tái dùng outbound hiện có) + retry tới khi MMP ack.

*(Danh sách trên là bản brainstorm đầy đủ vòng đời; khi build sẽ chốt tập tối thiểu cho Phase 3 — thường:
`order.received/accepted/priced`, `shipment.booked/delivered/exception`, `statement.issued/paid` — rồi mở rộng.)*

### 5. Surface cho MEAN

- Danh sách ship hộ (`f/ship-ho`) thêm cột/nhãn "Nguồn" (internal/mmp) + filter `source='mmp'` để MEAN thấy đơn brand gửi cần xử lý. (Trang chi tiết hiện có đủ để chọn carrier/confirm/ship.)

## Đơn vị & ranh giới

- `estimate.ts` (I/O mỏng, gọi core thuần `computeBrandCharge` + adapter) — nguồn sự thật giá brand-facing; test bằng account/partner giả hoặc integration nhẹ.
- 2 route API mỏng: chỉ HMAC + validate + gọi `estimateForBrand`/intake. Không nhét logic giá vào route.
- Tái dùng: `pickBaseVnd`, `quoteShipHoOrder`/engine, `validateAddressExtra`, `buildRateCard`. Giá brand dùng `computeBrandCharge` (Option A) — KHÔNG `computeOffer` (đó là giá nội bộ). Nhãn phụ phí brand-facing map trung tính riêng (không tái dùng `SURCHARGE_LABELS` vì có chữ "FedEx").

## Bảo mật

- HMAC bắt buộc trên cả 2 route; đọc `rawBody` trước parse (byte-identical).
- Approve-check server-side theo `brandSlug` — client không thể tự nâng quyền.
- Không lộ dữ liệu nội bộ (carrierCost/margin/markup) trong mọi response.
- `mmp_ref` unique chống tạo trùng khi MMP retry.

## Test (khi build)

- `estimateForBrand`: brand chưa approve → `brand_not_approved`; không FedEx → `no_fedex`; quote fail → `quote_failed`; happy path → tổng `lines` == `chargedVnd`, không có field nội bộ.
- Route estimate/orders: thiếu HMAC → 401; body thiếu → 400; brand chưa approve → 403; idempotent theo `mmp_ref`.
- Address country-specific: đơn SA thiếu short-address/maps → 400 (qua `validateAddressExtra`).

## Đã chốt (từ Q&A)

1. **Định danh trung tính:** brand chỉ thấy **"Express Delivery" / "Standard Delivery"** + nhãn phụ phí trung tính; không lộ tên hãng.
2. **Estimate:** 1 quote duy nhất, FedEx làm chuẩn (nội bộ); Express build ngay, Standard sau.
3. **Mã đơn:** SMS sinh — **tạm dùng dãy số tuần tự**, backfill theo format chính thức sau.
4. **Webhook:** cần SMS⇄MMP đồng bộ liên tục — catalog sự kiện đầy đủ ở mục 4b.

## Câu hỏi mở (chốt khi build)

1. Map service **Express/Standard** → account/line FedEx nào trong SMS (cột `service` trên carrier account, hay 2 account riêng) — để `estimateForBrand` chọn đúng.
2. Format mã đơn chính thức (khách gửi sau) → backfill dãy số tạm.
3. Endpoint/secret webhook phía MMP + tập sự kiện tối thiểu chốt cho Phase 3 (gợi ý ở 4b).
4. Ngưỡng lệch giá estimate↔giá cuối cần brand `price_accepted` (nếu áp dụng).

## Gợi ý phân đợt build (khi bắt tay)

- **Phase 1:** DB (approve + source + mmp_ref + service) + core `estimateForBrand` (Express) + API estimate.
- **Phase 2:** API nhận đơn (SMS sinh mã, idempotency) + surface `source='mmp'` cho MEAN.
- **Phase 3:** Webhook SMS→MMP (trạng thái/tracking) tái dùng outbound + cron retry.
- **Sau:** Service line Standard; API đọc thanh toán/công nợ.
