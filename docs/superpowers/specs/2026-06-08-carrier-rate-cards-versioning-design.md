# Carrier Rate Cards — base-rate versioning theo thời gian hiệu lực

- **Ngày:** 2026-06-08
- **Tác giả:** lmtiep + ECC
- **Trạng thái:** Design — chờ review trước khi writing-plans
- **Module:** `features/carrier-rates/` + `features/shipments/reconcile.ts`
- **Phụ thuộc:** Carrier Rates (spec 2026-05-25), Shopify Orders (spec 2026-05-28) — đã merged.

## 1. Bối cảnh & vấn đề

Hệ thống đối soát chi phí ship (`reconcileShipments`) so chi phí carrier billing thực
(`shipment_charges`, 2.204 kiện trong DB) với ước tính engine (`quote()`). Mục tiêu nghiệp
vụ: phát hiện carrier tính sai để đòi lại tiền (trung bình 30–50tr/tháng).

Bảng giá gốc của DHL và FedEx **đổi theo năm**. Mỗi hợp đồng có một **bảng giá (rate card)
với thời gian hiệu lực**: năm ngoái dùng một bảng, năm nay dùng bảng khác. Audit một đơn
ship năm 2025 **phải** dùng base rate 2025; đơn 2026 dùng base 2026.

### Lỗ hổng hiện tại

- `carrier_surcharges` **đã** có effective dating (`startsAt`/`endsAt`) và engine gate theo
  `effectiveDate` trong `quote()` → fuel/demand/VAT đã version theo thời gian được.
- **Base matrix thì CHƯA.** `carrier_rate_cells` chỉ có `costAmount` + `updatedAt`, unique
  trên `(zone, tier, package_type)`. Upload bảng giá năm mới sẽ **ghi đè** cells cũ → mất
  base 2025.
- `reconcile.ts` chọn snapshot **chỉ theo `carrier_key`** (1 account fedex + 1 dhl đang
  enabled), không biết ngày ship khi chọn base. → đơn 2025 bị tính bằng giá 2026.

## 2. Mục tiêu

1. Base rate có **thời gian hiệu lực**; nhiều bảng giá theo thời gian cho mỗi carrier account.
2. Reconcile chọn đúng base card theo **ngày ship** của từng kiện.
3. **Không đụng vào engine core** `quote.ts` (phần toán đã verify với invoice).
4. Migration **không mất** dữ liệu cells hiện có.
5. Thiết kế mở: thêm năm (2024…) về sau không cần đổi schema.

## 3. Ngoài phạm vi

- Versioning zones / weight tiers / discount % — **giống nhau giữa 2025 và 2026**, giữ chung.
- Versioning fuel / demand / VAT bằng cơ chế mới — **đã** date-gate qua `startsAt`/`endsAt`.
- UI dựng lịch sử bảng giá nâng cao (so sánh diff giữa các card) — làm sau nếu cần.

## 4. Mô hình dữ liệu

### 4.1 Bảng mới `carrier_rate_cards`

```
carrier_rate_cards
  id               uuid pk
  carrierAccountId uuid fk → carrier_accounts (onDelete cascade), notNull
  label            text  notNull          -- "FedEx IPE 2025", "DHL WW Export 2026"
  effectiveFrom    date  notNull          -- bao gồm
  effectiveTo      date  null             -- bao gồm; NULL = card hiện hành (mở)
  createdBy        text  fk → user
  createdAt        timestamptz default now
```

- **Không cho 2 card cùng account chồng lấn window** — kiểm bằng app-logic khi tạo/sửa card
  (query overlap trước khi insert). Mỗi account có tối đa **một** card mở (`effectiveTo IS NULL`).
- Ranh giới **bao gồm cả 2 đầu**: card cũ `effectiveTo = 2026-01-04`, card mới
  `effectiveFrom = 2026-01-05`. Đơn ship **đến hết 04/01/2026** dùng card cũ.

### 4.2 Sửa `carrier_rate_cells`

- Thêm `rateCardId uuid fk → carrier_rate_cards (onDelete cascade) notNull`.
- **Đổi unique index** từ `(carrierZoneId, carrierWeightTierId, packageType)` sang
  `(rateCardId, carrierZoneId, carrierWeightTierId, packageType)`.
- `carrier_zones`, `carrier_weight_tiers`, `carrier_surcharges` **không đổi** — card 2025 và
  2026 dùng chung zones/tiers/surcharges, chỉ khác bộ cells.

### 4.3 Migration (không mất data)

1. Tạo bảng `carrier_rate_cards`.
2. Với **mỗi** `carrier_account` đang có cells: tạo 1 card "current"
   (`effectiveFrom` = mốc quá khứ an toàn vd `2020-01-01`, `effectiveTo` = NULL).
3. Thêm cột `rateCardId` (tạm nullable) → `UPDATE` gán toàn bộ cells hiện tại về card
   "current" của account tương ứng (join qua `carrier_zones.carrier_account_id`).
4. Set `rateCardId` NOT NULL, drop unique index cũ, tạo unique index mới.

## 5. Engine — chỉ sửa `load.ts`

`loadAccountSnapshot(carrierAccountId, effectiveDate?: Date)`:

- Chọn rate_card của account có `effectiveFrom <= effectiveDate <= COALESCE(effectiveTo, ∞)`.
  Mặc định `effectiveDate = hôm nay` → card mở.
- Nếu không có card phủ ngày đó → snapshot trả về **không có cells** (engine sẽ trả
  `no_rate` như hiện tại); reconcile đánh dấu lý do `no_rate_card`.
- Chỉ nạp cells `WHERE rate_card_id = <card đã chọn>`.
- **`quote.ts` không đổi** — vẫn nhận một snapshot với một bộ rate.

## 6. Reconcile — chọn base card theo ngày ship

`reconcile.ts` hiện pre-load 1 snapshot/carrier rồi tái dùng. Đổi:

- Pre-load **mọi rate_card** của các account fedex/dhl enabled (kèm window) → một
  snapshot per `rateCardId` (chỉ nạp 1 lần mỗi card).
- Trong vòng lặp, với mỗi shipment: lấy `shipDate = labelCreatedAt ?? processedAtShopify`,
  chọn card của carrier tương ứng có window phủ `shipDate`, dùng snapshot của card đó.
- `effectiveDate` truyền vào `quote()` **giữ nguyên** (vẫn gate surcharges).
- Shipment không có card nào phủ ngày → lý do `no_rate_card` trong `ReconcileRow`.

## 7. Importer + UI

- Trang account carrier-rates thêm mục **"Rate cards"**: liệt kê card (label + window +
  trạng thái mở/đóng), nút tạo card mới (label + `effectiveFrom` + `effectiveTo`).
- Import matrix (CSV/xlsx) hiện trỏ account → đổi sang **trỏ `rateCardId`**: chọn card đích
  trước khi upload.
- Calculator + Recalculate&Push: dùng card hiện hành (`effectiveTo IS NULL`, hoặc phủ hôm nay).

## 8. Surcharge verification (data task — không schema)

Như user xác nhận: demand/remote/VAT là chính sách carrier + nhà nước theo năm.

- Rà các dòng `carrier_surcharges` của FedEx và DHL: đảm bảo dòng thuộc giai đoạn 2025 có
  `endsAt` ≤ cutover của carrier đó, dòng 2026 có `startsAt` > cutover.
- **VAT 2025 = 2026 (8%)** → không tách, giữ nguyên.
- Nếu phát hiện demand/remote lệch năm chưa được date-gate → thêm/sửa dòng với window đúng.
- Việc này là bước kiểm-tra-và-sửa-data trong plan, không cần thay đổi schema.

## 9. Testing

- `quote.test.ts` — **giữ nguyên** (engine core không đổi); chạy lại để xác nhận không hồi quy.
- `load` test mới: cùng account, 2 card (2025/2026) chồng zones/tiers; gọi với 2
  `effectiveDate` khác nhau → nạp đúng bộ cells.
- `reconcile` test mới: 1 shipment ship 2025 + 1 shipment ship 2026 (cùng carrier) → mỗi cái
  dùng đúng base; kiểm `no_rate_card` khi ship ngoài mọi window.
- Migration: chạy `db:migrate` trên bản sao DB → xác nhận mọi cells cũ map về card "current",
  reconcile ra kết quả **không đổi** so với trước migration (vì card current phủ mọi ngày).

## 10. Rủi ro & quyết định đã chốt

- **Cutover theo từng carrier** — mỗi card tự đặt window; FedEx và DHL độc lập.
- **Ranh giới bao gồm cả ngày cutover** ở card cũ.
- **Entity `carrier_rate_cards`** thay vì nhồi ngày vào từng cell — một dòng định nghĩa
  window, cells hang off; importer/UI sạch hơn.
- Rủi ro chính: reconcile refactor pre-load (1/carrier → 1/card). Giảm thiểu bằng test
  before/after migration cho ra số liệu trùng khớp khi chỉ có 1 card.
