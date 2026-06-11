# Spec: FedEx US import handling → when_billed + fuel-on-demand credit

**Ngày:** 2026-06-11
**Module:** Carrier rates engine + Đối soát phí ship
**Specs nền:** [addon_fixed Direct Signature](./2026-06-11-addon-services-direct-signature-design.md), [FedEx signature nước miễn](./2026-06-11-fedex-signature-country-exclusion-design.md)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-11)

Engine đang áp phí **"Phí xử lý hàng nhập US" (country_fixed)** cho MỌI đơn US
(37.400đ năm 2025 → 68.300đ từ 2026). Nhưng đo trên bill: **284 đơn FedEx US,
chỉ 12 (4%) thực sự bị FedEx thu** phí này (giá còn nhảy 68.300/78.000). Engine
cộng dư → 272 đơn US lệch (dòng `elevatedRisk: engine 68.300 / billed 0`). Đây
là blocker thật của các đơn như #MBLVD28665, KHÔNG phải Direct Signature
(signature đã xử lý đúng cho 282/315 đơn).

Phí này không đoán được theo đơn — **giống hệt Direct Signature**. Quyết định:
mô hình nó **`when_billed`** (không tự cộng vào quote; chỉ kiểm khi bill có).

**Tinh chỉnh kỹ thuật:** dùng cột `apply_mode` sẵn có **trên chính kind
`country_fixed`** (KHÔNG chuyển sang `addon_fixed` — vì `addonReference` đang
dùng chung cho dòng signature, nhét import handling vào sẽ lẫn ánh xạ). Dòng
billed của import handling là cột `import_handling`/`elevated_risk`, đối soát
qua component `elevatedRisk` — giữ nguyên ánh xạ đó.

Kèm theo (operator đã duyệt): mở rộng phần "credit fuel-trên-signature" để gộp
cả fuel-trên-demand khi demand khớp (FedEx có khi fuel cả demand+signature).

## 1. Engine (`features/carrier-rates/engine/quote.ts`, `load.ts`)

- `country_fixed` áp `apply_mode` (giống addon):
  - Dòng `apply_mode` `always`/null (hiện tại) → vào `countryFixed` của quote
    như cũ (country_codes + exclusions vẫn áp).
  - Dòng `apply_mode='when_billed'` → KHÔNG vào quote; gộp vào trường mới
    `countryFixedReference` (cùng filter country_codes + exclusions + ngày),
    chỉ làm giá tham chiếu cho đối soát.
- `rowContribution` case `country_fixed`: trả 0 khi `apply_mode='when_billed'`
  (không lọt fuelable/vatable subtotal).
- `QuoteBreakdown` thêm `countryFixedReference: number` (mặc định 0).
- `load.ts`: `applyMode` đã map sẵn cho mọi row — không cần thêm.

## 2. Đối soát (`reconcile.ts`, `reconcile-diagnose.ts`)

### 2.1 elevatedRisk component (import handling pass-through)
`DiagnoseInput.engine` thêm `countryFixedReference?: number`. Nhánh
`elevatedRisk` (~dòng 338-344):
- `erEngine > 0` (auto-apply như cũ, vd DHL ER) → giữ nguyên logic hiện tại.
- `erEngine === 0 && erBilled > 0`:
  - `countryFixedReference > 0 && erBilled === countryFixedReference` → cause
    **PHI_TUY_CHON** (pass-through hợp lệ, FedEx thu đúng bảng) — không
    actionable; không còn báo "engine không tính ER".
  - `countryFixedReference > 0 && erBilled !== reference` → **KHONG_KHOP**,
    verdict dominant mới: `"Phí xử lý hàng nhập sai bảng giá: bill X ≠ Y —
    đối chiếu carrier"` (severity config). Bắt được đơn 78.000 lạ.
  - `countryFixedReference === 0` (carrier chưa khai) → giữ KHONG_KHOP legacy.
- `reconcile.ts`: engine map thêm `countryFixedReference: q.breakdown.countryFixedReference`.

### 2.2 Fuel credit gộp demand (mục #2)
Nhánh fuel `explainedBySig` (~dòng 270-273) hiện chỉ credit fuel×signature.
Mở rộng: fuel delta được coi "phái sinh" (PHAI_SINH, không actionable) khi nó
khớp fuel% × (signature pass-through **+ demand nếu demand khớp**). Giữ CẢ
nhánh chỉ-signature (FedEx khi không fuel demand) lẫn nhánh signature+demand
(khi có) — FedEx không nhất quán nên phải nhận cả hai. Demand "khớp" =
`r(n0(b.demand) - e.demand) === 0`.

## 3. Data (`scripts/migrate-fedex-import-handling-when-billed.ts`, dry-run/--apply)

Chuyển 2 dòng FedEx US import handling sang `apply_mode='when_billed'`
(GIỮ kind `country_fixed`, country_codes ['US'], value/ngày nguyên):

| value | starts_at | ends_at |
|---|---|---|
| 37.400 | 2025-01-01 | 2026-01-01 |
| 68.300 | 2026-01-01 | NULL |

Idempotent (match account FedEx + kind country_fixed + country_codes ⊇ US +
note ILIKE '%import handling%'), trong transaction, assert rowCount=2. DHL
country_fixed (Elevated Risk) KHÔNG đụng (apply_mode giữ 'always').

## 4. UI

`SurchargeEditDialog`: select "Chế độ áp dụng" (always/when_billed) hiện cho
kind `country_fixed` (hiện chỉ addon_fixed). `surcharges-actions` create/update
gate `applyMode` mở cho cả `country_fixed`. Trang surcharges: dòng country_fixed
hiện badge chế độ như addon.

## 5. Kiểm thử (TDD)

- Engine: (a) country_fixed when_billed → không vào total/fuel, hiện ở
  `countryFixedReference`; (b) always vẫn vào quote như cũ; (c) gate ngày.
- Diagnose: (a) bill import handling 68.300 + engine 0 + reference 68.300 →
  PHI_TUY_CHON; (b) bill 78.000 ≠ reference → KHONG_KHOP + verdict sai bảng giá;
  (c) DHL ER auto-apply giữ nguyên hành vi (regression); (d) fuel
  signature+demand khớp → PHAI_SINH (đơn kiểu #MBLVD28665).
- Fleet sau --apply: ~272 đơn US hết bị cộng dư 68.300 → matched FedEx TĂNG,
  tổng delta GIẢM; 12 đơn có import handling vẫn nhận pass-through (giá 68.300)
  hoặc flag (giá 78.000); DHL không đổi. In rõ trước/sau.
