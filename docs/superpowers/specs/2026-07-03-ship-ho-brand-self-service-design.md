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
- API **estimate** giá cho 1 kiện theo bảng giá của brand (giá thu + tách phụ phí).
- API **nhận đơn** brand tạo → tạo đơn ship hộ ở SMS (source='mmp') cho MEAN xử lý & ship.
- Core dùng chung để estimate + intake tính giá nhất quán.

**Ngoài phạm vi (nêu để làm sau):**
- UI phía MMP (do team MMP xây dựng, gọi API dưới đây).
- API đọc **đối soát / thanh toán / công nợ** cho brand (tái dùng statement/AR — đợt sau).
- Tự động chọn carrier / auto-confirm đơn (giữ luồng MEAN duyệt thủ công).

## Quyết định

| Nội dung | Chốt |
|---|---|
| Nơi đặt function | API trong SMS (`app/api/mmp/ship-ho/*`), MMP gọi. UI ở MMP. |
| Auth | HMAC như `order-confirmations` (secret dùng chung `MMP_WEBHOOK_SECRET`), replay-protection sẵn có. |
| Định danh brand | `brandSlug` trong body — validate + approve-check server-side (không tin client). |
| Cổng approve | Cột `self_service_enabled boolean default false` trên `ship_ho_partners`. Kalisa = true. |
| Cơ sở giá estimate | **FedEx** (đúng cơ sở rate card brand). Không quote được tuyến → trả lỗi rõ. |
| Giá hiển thị brand | Giá thu (chargedVnd) + **tách phụ phí** (base offer, fuel, phụ phí, VAT). Ẩn carrierCost/margin/markup. |
| Luồng đơn brand | Vào `ship_ho_orders` với `source='mmp'`, status `draft` → MEAN chọn carrier/confirm/ship (luồng hiện có). Không thêm status enum mới. |
| Idempotency | `mmp_ref` unique — resubmit trả đơn cũ. |

## Kiến trúc

```
Brand ── UI ──►  MMP Portal  ──HMAC──►  SMS API (repo này)  ──►  ship_ho_orders / rate card
                                         estimate + intake        (MEAN xử lý, ship)
```

### 1. DB (migration)

- `ship_ho_partners`: `+ self_service_enabled boolean NOT NULL DEFAULT false`.
- `ship_ho_orders`:
  - `+ source text NOT NULL DEFAULT 'internal'` ('internal' | 'mmp').
  - `+ mmp_ref text` với unique index (partial, chỉ khi not null) để idempotency.
- Cập nhật `db/schema.ts` tương ứng. Set `self_service_enabled = true` cho Kalisa (data op một lần).

### 2. Core dùng chung — `features/ship-ho/estimate.ts`

```ts
export interface EstimateParcel {
  country: string; city?: string; postcode?: string;
  weightKg: number;
  dimLengthCm?: number; dimWidthCm?: number; dimHeightCm?: number;
  packagingType?: 'bag' | 'box' | null;
}
export interface EstimateLine { label: string; amountVnd: number }
export interface BrandEstimate {
  chargedVnd: number;
  currency: 'VND';
  lines: EstimateLine[];   // base offer, fuel, từng phụ phí, VAT — cộng lại = chargedVnd
  notes: string[];         // "Phụ phí/fuel/VAT theo FedEx khi xuất bill" + surcharge kinds
}
export type EstimateResult =
  | { ok: true; estimate: BrandEstimate }
  | { ok: false; error: string; code: 'brand_not_approved' | 'no_fedex' | 'quote_failed' | 'bad_input' };

/** I/O: nạp partner (approve+markup), quote FedEx, computeOffer, dựng breakdown minh bạch cho brand. */
export async function estimateForBrand(brandSlug: string, parcel: EstimateParcel): Promise<EstimateResult>;
```

Logic:
- Nạp partner theo `brandSlug`; nếu không có / `status!='active'` / `!self_service_enabled` → `brand_not_approved`.
- Chọn account FedEx enabled (như rate card); không có → `no_fedex`.
- `quoteShipHoOrder(...)` cho parcel → nếu fail → `quote_failed`.
- `computeOffer(carrierCostVnd, baseVnd, markup)` → `chargedVnd`.
- `lines`: từ `breakdown` (đã quy VND): `base offer = round(baseVnd×(1+markup/100))`, `fuel`, `phụ phí` (remote/residential/demand/countryFixed/perStep/peak gộp hoặc tách), `VAT`. Tổng `lines` = `chargedVnd` (kiểm bất biến trong test).
- `notes`: tái dùng nhãn surcharge (từ `offer-ratecard-logic` `SURCHARGE_LABELS`) + câu "phụ phí/fuel/VAT do FedEx tính khi xuất bill".
- **Tuyệt đối không** trả `carrierCostVnd`, `marginVnd`, `markupPercent`.

### 3. API estimate — `app/api/mmp/ship-ho/estimate/route.ts`

- `POST`, `runtime='nodejs'`, `dynamic='force-dynamic'`.
- Verify HMAC (đọc `rawBody` text trước khi parse). Thiếu secret → 500; sai chữ ký → 401.
- Parse body: `{ brandSlug: string, parcel: EstimateParcel }`. Thiếu field bắt buộc (`brandSlug`, `parcel.country`, `parcel.weightKg`>0) → 400.
- Gọi `estimateForBrand`. Map lỗi → HTTP: `brand_not_approved`→403, `no_fedex`/`quote_failed`→422, `bad_input`→400.
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
- Idempotency: nếu đã có `ship_ho_orders.mmp_ref = mmpRef` → trả đơn cũ `{ ok:true, idempotent:true, orderId, code }`.
- Tạo đơn:
  - `code`: sinh theo convention (vd `KLS` prefix theo brand + số; hoặc nhận `code` từ MMP nếu có). *(Chốt khi build: dùng `mmpRef` hoặc sinh mã riêng — mã phải unique như ràng buộc hiện có.)*
  - `source='mmp'`, `mmp_ref=mmpRef`, `partner_brand_slug=brandSlug`, các field địa chỉ + country-specific, parcel.
  - Snapshot giá qua `estimateForBrand` (hoặc quote+computeOffer) → `carrierCostVnd/markupPercent/chargedVnd/quoteBreakdown/quotedAt` như requote, status `draft`. *(Đơn brand tạo vẫn để MEAN chốt carrier cuối; giá là estimate tại thời điểm tạo.)*
- Trả `{ ok:true, orderId, code, estimate }`.

### 5. Surface cho MEAN

- Danh sách ship hộ (`f/ship-ho`) thêm cột/nhãn "Nguồn" (internal/mmp) + filter `source='mmp'` để MEAN thấy đơn brand gửi cần xử lý. (Trang chi tiết hiện có đủ để chọn carrier/confirm/ship.)

## Đơn vị & ranh giới

- `estimate.ts` (I/O mỏng, gọi core thuần `computeOffer` + adapter) — nguồn sự thật giá brand-facing; test bằng account/partner giả hoặc integration nhẹ.
- 2 route API mỏng: chỉ HMAC + validate + gọi `estimateForBrand`/intake. Không nhét logic giá vào route.
- Tái dùng: `computeOffer`, `pickBaseVnd`, `quoteShipHoOrder`, `validateAddressExtra`, `SURCHARGE_LABELS`.

## Bảo mật

- HMAC bắt buộc trên cả 2 route; đọc `rawBody` trước parse (byte-identical).
- Approve-check server-side theo `brandSlug` — client không thể tự nâng quyền.
- Không lộ dữ liệu nội bộ (carrierCost/margin/markup) trong mọi response.
- `mmp_ref` unique chống tạo trùng khi MMP retry.

## Test (khi build)

- `estimateForBrand`: brand chưa approve → `brand_not_approved`; không FedEx → `no_fedex`; quote fail → `quote_failed`; happy path → tổng `lines` == `chargedVnd`, không có field nội bộ.
- Route estimate/orders: thiếu HMAC → 401; body thiếu → 400; brand chưa approve → 403; idempotent theo `mmp_ref`.
- Address country-specific: đơn SA thiếu short-address/maps → 400 (qua `validateAddressExtra`).

## Câu hỏi mở (chốt khi build)

1. Quy tắc sinh `code` cho đơn brand (nhận từ MMP hay SMS sinh) — cần unique.
2. Estimate: chỉ FedEx, hay sau này mở nhiều carrier? (Draft: FedEx.)
3. Có cần webhook SMS→MMP báo trạng thái đơn (đã ship/tracking) cho brand xem không? (Nhiều khả năng cần ở đợt read-API.)
