# Spec: GoGreen DHL — bước nhảy có ngưỡng phẳng (stepFloor) 2 giai đoạn

**Ngày:** 2026-06-12
**Module:** carrier-rates engine (`features/carrier-rates/engine`) + config
**Specs nền:** carrier-rates engine (per_step_fixed / GoGreen)

## 0. Bối cảnh & quyết định (operator, 2026-06-12)

DHL GoGreen Plus tính theo `per_step_fixed` (1.900đ/0.5kg). Có **2 giai đoạn**:

- **Từ 29/9/2025 (MỚI):** `ceil(chargeableKg / 0.5) × 1.900` cho MỌI cân
  (0.5→1.900, 1.0→3.800, 1.5→5.700, 2.0→7.600…).
- **Trước 29/9/2025 (CŨ):** 0→1.5kg **phẳng 1.900đ**; **từ 2kg** mới nhảy bước
  (2.0→7.600 = bước 4, 2.5→9.500…). Tức dưới 2kg = 1 bước phẳng.

Config hiện tại áp quy tắc MỚI cho cả 2025–2026 → engine TÍNH SAI GoGreen cho pack
DHL 0.5–1.5kg ship **trước 29/9/2025** (charge bước thay vì phẳng).

Quyết định: thêm tham số **`stepFloorKg`** cho dòng surcharge — **cân < stepFloorKg
→ tính 1 bước phẳng (value); cân ≥ stepFloorKg → `ceil(cân/stepKg) × value`**.
- CŨ: `stepFloorKg = 2.0`. MỚI: `stepFloorKg = null` (luôn nhảy).

## 1. Schema (`db/schema.ts` + migration)

- `carrierSurcharges` thêm cột `stepFloorKg: numeric('step_floor_kg', { precision: 10, scale: 3 })`
  (nullable). NULL = không có ngưỡng phẳng (luôn nhảy bước — hành vi hiện tại).
- Migration `scripts/migrate-surcharge-step-floor.ts`:
  `ALTER TABLE carrier_surcharges ADD COLUMN IF NOT EXISTS step_floor_kg numeric(10,3)`.

## 2. Engine (`features/carrier-rates/engine/quote.ts` + `load.ts`)

- `SurchargeSnap` thêm `stepFloorKg?: number | null` (cạnh `stepKg`).
- `load.ts` map: `stepFloorKg: s.stepFloorKg !== null ? Number(s.stepFloorKg) : null`.
- `perStep` (quote.ts ~660): đổi reduce thành:
  ```ts
  .reduce((sum, s) => {
    const steps = (s.stepFloorKg != null && chargeableWeightKg < s.stepFloorKg)
      ? 1
      : Math.ceil(chargeableWeightKg / s.stepKg!);
    return sum + steps * s.value;
  }, 0);
  ```
  (chargeableWeightKg đã làm tròn lên 0.5kg — giữ nguyên.)

## 3. Config — tách dòng 2025 (`scripts/migrate-dhl-gogreen-stepfloor-2025.ts`)

DHL có 2 dòng GoGreen per_step_fixed: 2025-01-01→2026-01-01 và 2026-01-01→open.
- **Tách dòng 2025** (2025-01-01→2026-01-01) thành 2 dòng:
  - `2025-01-01 → 2025-09-29`: stepFloorKg = **2.0** (CŨ).
  - `2025-09-29 → 2026-01-01`: stepFloorKg = **null** (MỚI).
- Dòng `2026-01-01 → open`: giữ nguyên (MỚI, stepFloorKg null).
- Idempotent: nếu đã có dòng ends 2025-09-29 với stepFloor 2.0 → bỏ qua.
- Giá trị/stepKg/fuelable/vatable/apply_mode giữ y dòng gốc (1.900, 0.5, không fuel,
  vatable mặc định, always).

## 4. Kiểm thử (TDD — engine)

Trong `features/carrier-rates/engine/quote.test.ts` (hoặc file test perStep), thêm:
- **stepFloorKg=2.0 (CŨ):** chargeable 0.5→1.900, 1.0→1.900, 1.5→1.900, 2.0→7.600,
  2.5→9.500.
- **stepFloorKg=null (MỚI):** 0.5→1.900, 1.0→3.800, 1.5→5.700, 2.0→7.600.
- Dòng không có stepFloorKg (cũ trong DB) hành xử như null (luôn nhảy) — không vỡ
  test hiện hành.
(Test gọi `quote(snap,...)` với snapshot surcharge per_step_fixed; hoặc test thuần
phần perStep nếu tách được — ưu tiên qua `quote` cho đúng chargeable rounding.)

## 5. Áp dữ liệu & verify (sau code)

- Migration cột + config split (dry-run → apply).
- Quote thử pack DHL trước 29/9 (vd 1.0kg → GoGreen 1.900) và sau 29/9 (1.0kg →
  3.800) để xác nhận engine áp đúng theo ngày.
- Đối soát lại: GoGreen component của pack DHL 06–09/2025 (0.5–1.5kg) khớp hơn.

## 6. Ngoài phạm vi

- Không đổi cơ chế các surcharge khác.
- Không UI cho stepFloorKg (chỉ qua script — như các config khác).
- Không động fuel/ER/base.
- stepFloorKg chỉ có nghĩa với `per_step_fixed` (kind khác bỏ qua).
