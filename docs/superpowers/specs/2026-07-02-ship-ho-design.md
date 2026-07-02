# Module "Quản lí đơn ship hộ" (partner proxy shipping) — Design

> MEAN BLVD dùng hợp đồng carrier của mình (FedEx/DHL/Aramex) để **ship hộ** cho các
> brand đối tác ngoài. Đơn KHÔNG vào platform/Shopify. Quản trị riêng, tách hoàn toàn
> khỏi flow tính giá ship cho khách lẻ hiện tại.

**Ngày:** 2026-07-02
**Trạng thái:** đã duyệt thiết kế (A–F), chờ review spec → plan Phase 1.
**Nhánh:** `feat/ship-ho`

## 1. Bối cảnh & vấn đề

Hệ thống hiện tính giá ship **trực tiếp cho khách lẻ** qua platform MEAN BLVD (đơn Shopify →
`carrier-rates/engine/quote.ts` → giá checkout; sau đó đối soát billed vs estimate ở
`features/shipments`).

Nay cần một dịch vụ mới: **ship hộ cho brand đối tác ngoài**. Brand gửi kiện, MEAN BLVD ship
bằng hợp đồng carrier của mình rồi thu tiền brand (cước thực + markup). Các đơn này KHÔNG đi
qua Shopify — hiện nhận diện qua prefix **`DISCN`** và **bị skip hoàn toàn** khỏi import
(`features/shipments/store-prefix.ts` → `kind: 'partner_ship'`), tức chưa được quản trị ở đâu.

Mục tiêu: quản trị trọn vòng đời đơn ship hộ — nhập đơn → tính giá thu partner → theo dõi giao
→ đối soát cước carrier + xuất bảng kê thu tiền + báo cáo lãi thực — **cô lập** khỏi dữ liệu
khách lẻ để không ảnh hưởng flow & reconcile hiện tại.

## 2. Quyết định đã chốt (qua brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Full lifecycle (nhập → giá → tracking → đối soát/bill), chia 3 phase |
| Nguồn đơn | **Nhập tay (form)** + **Import Excel/CSV theo lô** (không qua Lark/Shopify) |
| Mô hình giá | **Engine carrier (cước thật) + markup% riêng theo partner** |
| Thu tiền/đối soát | **Bảng kê theo kỳ + công nợ (AR)**, **đối soát cước carrier**, **báo cáo margin** |
| Tracking | **Nhập tracking tay + auto-track** (tái dùng lib DHL/FedEx), KHÔNG tự tạo label |
| Đối tác | **Tái dùng `mmpBrands`** + bảng config ship hộ gắn theo brand |

## 3. Ranh giới module & tái dùng

Module mới **`features/ship-ho/`** + routes **`app/(dashboard)/f/ship-ho/`**. Dữ liệu **cô lập
hoàn toàn** khỏi `shopifyOrders` / `shipments` → không đụng flow khách lẻ + reconcile hiện tại.

Tái dùng (KHÔNG viết lại):

| Tái dùng | Dùng để |
|---|---|
| `features/carrier-rates/engine/quote.ts` + `engine/load.ts` | Tính cước carrier thật (base + fuel + surcharge + VAT) |
| `lib/dhl/track.ts`, `lib/fedex/track.ts` | Auto-track trạng thái giao |
| `mmpBrands` (+ bảng config mới) | Định danh đối tác ship hộ |
| Parser carrier charge theo `trackingNumber` (flow `features/shipments`) | Đối soát cước thực cho đơn ship hộ |

## 4. Data model (bảng mới, migration `0083+`, hand-authored)

### 4.1 `ship_ho_partners` — bật dịch vụ ship hộ cho 1 brand
- `id` uuid PK
- `brandSlug` text — FK `mmp_brands.slug`, **unique** (1 config / brand)
- `markupPercent` numeric — markup thu partner trên cước carrier thực
- `billingCycle` enum `ship_ho_billing_cycle` ('weekly' | 'monthly')
- `billingCurrency` text default 'VND'
- `status` enum `ship_ho_partner_status` ('active' | 'inactive')
- `note` text nullable
- `createdAt` timestamp default now

### 4.2 `ship_ho_orders` — đơn ship hộ
- Định danh: `id` uuid PK, `code` text (mã đơn, vd DISCN…), `partnerBrandSlug` text FK `mmp_brands.slug`
- Người nhận: `recipientName, recipientCompany, recipientPhone, country, city, province, postcode, address1, address2`
- Kiện: `weightKg numeric, dimLengthCm, dimWidthCm, dimHeightCm numeric nullable, packagingType` enum ('bag'|'box') nullable
- Carrier: `carrierKey text, carrierAccountId` uuid FK `carrier_accounts.id`
- **Giá (snapshot bất biến)**: `carrierCostVnd numeric, markupPercent numeric, chargedVnd numeric, quoteBreakdown jsonb, quotedAt timestamp nullable`
- Tracking: `trackingNumber text nullable, deliveryStatus text nullable, deliveredAt timestamp nullable, lastTrackedAt timestamp nullable`
- Đối soát: `actualCarrierCostVnd numeric nullable, reconcileStatus text nullable, deltaVnd numeric nullable, marginVnd numeric nullable`
- Bill: `statementId` uuid FK `ship_ho_statements.id` nullable
- `status` enum `ship_ho_order_status` ('draft'|'quoted'|'shipped'|'delivered'|'billed'|'settled') default 'draft'
- `createdAt timestamp default now, createdBy text nullable`

### 4.3 `ship_ho_statements` — bảng kê kỳ
- `id` uuid PK, `partnerBrandSlug` text FK
- `periodStart date, periodEnd date`
- `orderCount int, totalChargedVnd numeric`
- `status` enum `ship_ho_statement_status` ('draft'|'issued'|'paid') default 'draft'
- `issuedAt timestamp nullable, paidAt timestamp nullable`
- `fileKey text nullable` (xlsx export trên S3)
- `createdAt timestamp default now`

## 5. Luồng tính giá (P1)

```
Tạo/quote đơn:
  loadCarrierSnapshot(carrierAccountId)                              // engine/load.ts
  quote(snap, { weightKg, dims, destCountry, effectiveDate })        // engine/quote.ts
     → carrierCostVnd + breakdown (base/fuel/surcharge/VAT itemized)
  markup = ship_ho_partners.markupPercent
  chargedVnd = applyMarkup(carrierCostVnd, markup)                   // round VND, clamp ≥ 0
  LƯU SNAPSHOT: carrierCostVnd, markupPercent, chargedVnd, quoteBreakdown(jsonb), quotedAt
```

- **Snapshot bất biến**: giá đã quote KHÔNG đổi khi rate card/fuel thay đổi sau đó (cần cho bảng
  kê & tranh chấp).
- **Re-quote thủ công**: sửa cân/kích thước/carrier → nút "Tính lại giá" ghi đè snapshot mới +
  reset `status` về 'quoted'.
- UI: `cước gốc → markup% → giá thu`; sau đối soát thêm `cước thực → margin`.
- Đơn vị thuần test được: `applyMarkup(carrierCostVnd, markupPercent): number` (làm tròn VND theo
  `currencyDecimals('VND')=0`, clamp ≥ 0). Adapter engine tách riêng để mock.

## 6. Vòng đời & chia phase

**States:** `draft` → `quoted` → `shipped` (có tracking) → `delivered` (auto-track) →
`billed` (vào statement) → `settled` (partner đã trả).

Full lifecycle chia **3 phase — mỗi phase ra phần mềm chạy được, mỗi phase 1 plan riêng**:

| Phase | Nội dung | Deliverable |
|---|---|---|
| **P1 — MVP core** | `ship_ho_partners` config + tạo đơn tay (form) + tích hợp engine quote + list/detail UI | Tạo được đơn ship hộ & biết giá thu partner |
| **P2 — Import & tracking** | Import Excel lô (route DISCN từ LOG-Export) + nhập trackingNumber + auto-track delivery (cron, tái dùng lib DHL/FedEx) | Nhập hàng loạt + theo dõi giao |
| **P3 — Bill & đối soát** | Statement theo kỳ + công nợ (AR) + đối soát cước carrier (match theo tracking) + báo cáo margin | Thu tiền partner + biết lãi thực |

Thứ tự build: **P1 → P2 → P3**, mỗi phase review/merge trước khi sang phase sau.

## 7. Đối soát cước & bill partner (P3)

### 7.1 Đối soát cước carrier
```
Import carrier charge (CSV/Excel, đã parse theo trackingNumber — flow hiện có)
  match trackingNumber → ship_ho_orders:
    khớp   → actualCarrierCostVnd = cước thực
             deltaVnd  = actualCarrierCostVnd − carrierCostVnd(ước tính engine)
             marginVnd = chargedVnd − actualCarrierCostVnd
             reconcileStatus = 'reconciled'
    ko khớp → bucket "chưa khớp tracking" (chờ ops), KHÔNG ghi đè
```
- `deltaVnd`: engine ước tính lệch bao nhiêu so với cước thực (chất lượng engine).
- `marginVnd`: lãi thực từ đơn = giá thu − cước carrier thực (khác `deltaVnd`).

### 7.2 Bảng kê kỳ + công nợ
```
generateStatement(partnerBrandSlug, periodStart, periodEnd):
  gom ship_ho_orders của partner: quotedAt ∈ [start,end], status ∈ {shipped,delivered},
      statementId IS NULL
  tạo ship_ho_statements { orderCount, totalChargedVnd, status:'draft' }
  gán statementId cho từng đơn (khoá khỏi kỳ khác) + set order.status='billed'
  export xlsx (mã đơn · người nhận · cân · carrier · giá thu) → fileKey
  status: draft → issued (đã gửi partner) → paid (đã thu) → order.status='settled'
```
- Đơn vị thuần: `buildStatement(orders, period): { orderCount, totalChargedVnd, lines[] }`.
- Công nợ (AR) = Σ statement `issued` chưa `paid`, xem theo partner.

## 8. Test & xử lý lỗi

### 8.1 Test (TDD, tách thuần / I-O như module hiện có)
- **Thuần**: `applyMarkup`, `buildStatement`, `reconcileShipHo` (delta/margin), parse DISCN từ Excel,
  adapter engine (map input đơn → `QuoteInput`).
- **I/O orchestrator mỏng**: quote đơn, generate statement, auto-track — mock DB/engine/carrier.

### 8.2 Xử lý lỗi (không chặn ops)
- Quote fail (thiếu zone/rate/carrier account) → đơn giữ `draft` + cảnh báo rõ, KHÔNG tạo giá sai.
- Auto-track lỗi/timeout → giữ trạng thái cũ, cron retry (giống DHL hiện tại).
- Import lô: dòng lỗi → bucket "cần review"; dòng tốt vẫn vào (giống importer hiện tại).
- Đối soát không match tracking → bucket riêng, KHÔNG ghi đè.
- Xoá đơn đã vào statement `issued`/`paid` → **chặn** (giữ toàn vẹn công nợ).

## 9. Phân rã file (P1 — MVP core)

```
db/schema.ts                                    (+ 3 bảng + 4 enum ship_ho_*)
db/migrations/0083_ship-ho.sql                  (hand-authored + journal entry)

features/ship-ho/
  markup.ts            + markup.test.ts          applyMarkup (thuần)
  quote-adapter.ts     + quote-adapter.test.ts   map ship_ho_order → QuoteInput; gọi engine
  partners-actions.ts                            CRUD ship_ho_partners (server)
  orders-actions.ts                              tạo/sửa/quote/re-quote đơn (server)
  queries.ts                                     list + detail read

app/(dashboard)/f/ship-ho/
  page.tsx                                       list đơn + filter theo partner/status
  new/page.tsx                                   form tạo đơn tay
  [id]/page.tsx                                  detail: người nhận · kiện · giá (breakdown)
  partners/page.tsx                              cấu hình partner (markup, kỳ bill)
```

P2/P3 phân rã file trong plan riêng của từng phase.

## 10. Self-review notes

- Cô lập dữ liệu: mọi bảng `ship_ho_*` độc lập; chỉ FK ra ngoài tới `mmp_brands.slug` và
  `carrier_accounts.id` (read-only) → không đổi hành vi flow khách lẻ.
- Snapshot giá (`carrierCostVnd/markupPercent/chargedVnd/quoteBreakdown`) đảm bảo bất biến khi
  rate đổi — điều kiện tiên quyết cho bảng kê & tranh chấp.
- `deltaVnd` (engine vs cước thực) ≠ `marginVnd` (giá thu vs cước thực) — 2 số khác nhau, đã tách rõ.
- Tên enum/field P1 (§4, §9) khớp luồng §5–§7. `applyMarkup`/`buildStatement`/`reconcileShipHo`
  xuất hiện nhất quán giữa §5/§7/§8.
- YAGNI: KHÔNG tự tạo label (dùng tracking tay), KHÔNG API carrier tạo đơn, KHÔNG multi-currency
  phức tạp (thu VND; engine tự lo FX cost→VND) ở giai đoạn này.
