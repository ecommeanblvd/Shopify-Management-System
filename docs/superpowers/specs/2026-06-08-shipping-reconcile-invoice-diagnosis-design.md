# Spec: Chẩn đoán đối soát invoice — giải thích từng đồng

**Ngày:** 2026-06-08
**Module liên quan:** Đối soát phí ship (`/f/shipping-reconcile`)
**Spec nền:** [2026-06-08-shipping-reconcile-module-design.md](./2026-06-08-shipping-reconcile-module-design.md)

## 1. Mục tiêu

Với mỗi đơn lệch giữa hóa đơn carrier (billed) và giá hệ thống (engine), công cụ phải
**giải thích từng đồng lệch** và truy ra nguyên nhân cụ thể. Nguyên tắc nghiệp vụ:
nếu engine được cho đúng input (đúng cân, đúng zone, đúng cấu hình remote, đúng chiết
khấu) thì phải tái tạo hóa đơn **khớp tuyệt đối tới từng đồng**.

**KHÔNG có ngưỡng dung sai.** Không có khái niệm "lệch nhỏ bỏ qua". Tổng lệch chỉ được
coi là hợp lệ khi = **đúng 0đ**; mọi giá trị khác phải được phân rã hết về nguyên nhân.

## 2. Nguyên lý truy ngược cân nặng

Billed base trên hóa đơn (cột AJ, vd `5.598.900`) là **giá list trước chiết khấu** —
cùng hệ quy chiếu với bảng giá engine (`zone.rateByTierUpper`). Vì base là **bậc thang**
theo cân (`upperKg` → giá list), ta đảo ngược:

1. `T_engine` = bậc engine đã dùng (suy từ chargeable weight hệ thống).
2. Tìm `T_billed` = bậc có giá list **bằng đúng** `billedBase` (so khớp tuyệt đối, không xấp xỉ).
3. Phân loại (theo lựa chọn "cả hai, tùy bằng chứng"):
   - Tìm thấy `T_billed` và `T_billed.upperKg > T_engine.upperKg` → **`SAI_CÂN`**:
     carrier tính ở mức cân nặng hơn. Báo khoảng cân carrier đã dùng
     `(prevTierUpper, T_billed.upperKg]` và lệch số bậc.
   - Tìm thấy `T_billed` và `== T_engine` → base khớp (delta base = 0).
   - **Không** bậc nào có giá list == `billedBase` → **`LỆCH_RATE_CARD`**
     (bảng giá hệ thống khác hóa đơn, hoặc carrier dùng giá ngoài bảng).
   - Ưu tiên giải thích bằng cân trước; chỉ rơi về `LỆCH_RATE_CARD` khi không bậc nào khớp.

Chargeable weight hệ thống = `max(cân thực, cân quy đổi thể tích = L×W×H/divisor)`,
FedEx làm tròn lên bậc 0.5 kg (xem `quote.ts`). Phần này engine đã tính; diagnosis chỉ
đọc lại `engineChargeableWeightKg` và bậc đã khớp.

## 3. Đẳng thức đối soát (reconciliation identity)

Diagnosis phân rã tổng lệch theo **từng line item của hóa đơn**:

```
totalDelta = billedTotal − engineTotal
componentDelta[k] = billed[k] − engine[k]   với k ∈ {base, discount, fuel, remote,
                                                     demand, signature, vat, gogreen,
                                                     elevatedRisk}
residual = totalDelta − Σ componentDelta[k]
```

**Bất biến (test bắt buộc):** `Σ componentDelta[k] + residual === totalDelta` đúng tới từng đồng,
với mọi đơn. `residual` (do làm tròn hóa đơn / khoản không theo dõi) được hiện thành **một
dòng riêng** có tag `LÀM_TRÒN`, **không** giấu vào dung sai. Nhờ vậy đẳng thức luôn đúng
*by construction*.

- `billed[k]` = giá trị cột tương ứng trong `shipment_charges` (null → 0 trong phép trừ,
  nhưng ghi nhận "carrier không tính khoản này").
- `engine[k]` = giá trị tương ứng trong engine breakdown (`engineResidential` ↔ signature).
- `base`/`discount` tách riêng (dùng base **gross list**, không dùng net) để quy lệch chiết
  khấu về đúng dòng discount.

## 4. Phân loại nguyên nhân từng khoản (cause tags)

| Khoản | Quy tắc gắn tag |
|------|----------------|
| **base** | Theo §2: `SAI_CÂN` / `LỆCH_RATE_CARD` / khớp(0đ). |
| **discount** | `%CK_billed = −billedDiscount / billedBase`; khác `discountPercent` engine → `LỆCH_CHIẾT_KHẤU`. |
| **remote** | billed>0, engine=0 → `THIẾU_CẤU_HÌNH_REMOTE`. engine>0, billed=0 → `REMOTE_KHÔNG_KHỚP`. cả hai>0 khác nhau → `REMOTE_KHÔNG_KHỚP`. |
| **fuel** | `%fuel_billed = billedFuel / (fuelable_base_billed)`; khác `fuelPercent` engine → `LỆCH_%_FUEL`; nếu % bằng nhau nhưng tiền khác → `PHÁI_SINH` (hệ quả base sai). |
| **vat** | tương tự fuel theo `vatPercent`; thường `PHÁI_SINH`. |
| **demand / signature / gogreen / elevatedRisk** | khác 0 → flag `KHÔNG_KHỚP`; bằng → bỏ qua. |
| **residual** | `LÀM_TRÒN`. |

`fuelable_base_billed` = base + các phụ phí fuelable theo quy tắc engine (`isFuelable`,
xem `quote.ts`). Diagnosis nhận sẵn danh sách khoản fuelable từ lớp gọi.

## 5. Verdict tổng (ưu tiên giảm dần)

1. `totalDelta === 0` → **"KHỚP TUYỆT ĐỐI (0đ)"**.
2. Có component tag `SAI_CÂN` → **"Carrier tính ở mức cân cao hơn: Y kg (bậc ≤ …) vs hệ thống Z kg"**.
3. Có `THIẾU_CẤU_HÌNH_REMOTE` → **"Hệ thống thiếu cấu hình vùng xa cho nước này — cần bổ sung"**.
4. Có `LỆCH_RATE_CARD` → **"Bảng giá hệ thống khác hóa đơn — cần cập nhật rate card"**.
5. Có `LỆCH_CHIẾT_KHẤU` → **"Chiết khấu hợp đồng không khớp"**.
6. Chỉ còn `LÀM_TRÒN` → **"Chỉ lệch do làm tròn (Nđ)"**.

Verdict trả về cả `severity` (`match` | `weight` | `config` | `ratecard` | `discount` | `rounding`)
để panel tô màu.

## 6. Xử lý làm tròn (sống còn để đạt "tới từng đồng")

Fuel/VAT = base × % → ra số lẻ; carrier làm tròn. Engine phải tái tạo **đúng quy tắc làm
tròn từng bước**. Nếu sau khi giải thích hết các khoản vẫn còn dư, nó nằm trọn trong
`residual` (`LÀM_TRÒN`) và được hiện minh bạch. Đây là rủi ro triển khai lớn nhất: nếu quy
tắc làm tròn engine khác hóa đơn, `residual` sẽ phình ra — và chính công cụ này phơi bày để
ta sửa engine/rate card.

## 7. Kiến trúc (3 lớp, tách để test)

| File | Vai trò |
|------|--------|
| `features/shipments/reconcile-diagnose.ts` | **Tạo mới.** Thuần, không DB. `diagnoseReconcileRow(input): ReconcileDiagnosis`. Toàn bộ logic §2–§5 nằm ở đây. |
| `features/shipments/reconcile-diagnose.test.ts` | **Tạo mới.** Unit test TDD: ca khớp 0đ, ca SAI_CÂN (fixture #MBLVD28314), ca THIẾU_CẤU_HÌNH_REMOTE, ca LỆCH_RATE_CARD, ca LỆCH_CHIẾT_KHẤU, và **bất biến đẳng thức** §3. |
| `features/shipments/reconcile.ts` | **Sửa.** Trong vòng lặp (đã có `snap`, zone, chargeable weight): build bảng giá zone `[{upperKg, rate}]`, gọi `diagnoseReconcileRow`, gắn `diagnosis` vào row. Cần `quote()` lộ `chargeableWeightKg`, tier khớp, `fuelPercent`/`discountPercent`/`vatPercent`, danh sách khoản fuelable. |
| `features/shipments/reconcile-view.ts` | **Sửa (nếu cần).** `ReconcileViewRow` kế thừa `diagnosis` từ `ReconcileRow` — không thêm logic. |
| `components/shipping-reconcile/ReconcileDetailPanel.tsx` | **Sửa.** Thêm banner verdict (màu theo `severity`), dòng truy ngược cân, và tag nguyên nhân cạnh mỗi dòng phí + dòng `LÀM_TRÒN`. |

Bảng giá zone nặng giữ ở server (trong `reconcile.ts`); **chỉ** object `diagnosis` (nhỏ) được
serialize xuống client.

## 8. Kiểu dữ liệu

```typescript
export type DiagnosisCause =
  | 'SAI_CAN' | 'THIEU_CAU_HINH_REMOTE' | 'REMOTE_KHONG_KHOP'
  | 'LECH_RATE_CARD' | 'LECH_CHIET_KHAU' | 'LECH_FUEL'
  | 'PHAI_SINH' | 'KHONG_KHOP' | 'LAM_TRON' | 'KHOP';

export type DiagnosisSeverity =
  | 'match' | 'weight' | 'config' | 'ratecard' | 'discount' | 'rounding';

export interface ComponentDelta {
  key: 'base' | 'discount' | 'fuel' | 'remote' | 'demand'
     | 'signature' | 'vat' | 'gogreen' | 'elevatedRisk' | 'residual';
  billed: number;          // 0 nếu carrier không tính
  engine: number;          // 0 nếu engine không tính
  delta: number;           // billed − engine (đồng)
  cause: DiagnosisCause;
}

export interface ReconcileDiagnosis {
  totalDelta: number;                       // = billedTotal − engineTotal
  components: ComponentDelta[];             // Σ delta === totalDelta (bất biến)
  /** Truy ngược cân (null nếu base khớp / không suy được). */
  impliedWeight: {
    tierUpperKg: number;                    // bậc carrier đã tính
    rangeKg: [number, number];              // (prevTierUpper, tierUpperKg]
    engineChargeableKg: number;             // cân hệ thống dùng
    deltaTiers: number;                     // số bậc lệch
  } | null;
  verdict: string;                          // câu tiếng Việt cho banner
  severity: DiagnosisSeverity;
}
```

## 9. Edge cases

- `engineTotal === null` (chưa quote được) → **không** chẩn đoán; `diagnosis = null`; panel giữ thông báo hiện tại.
- `billedBase` null → base delta dùng 0; tag base = `KHONG_KHOP` nếu engineBase>0.
- Billed base vượt bậc cao nhất / không bậc nào khớp → `LECH_RATE_CARD`, `impliedWeight = null`.
- `billedBase === 0` (không thể chia khi tính %CK) → bỏ qua bước %CK, discount so trực tiếp theo đồng.

## 10. Ngoài phạm vi (YAGNI)

- Tự động sửa rate card / tự khai remote area (chỉ **chẩn đoán**, không vá dữ liệu).
- Phân tích DIM-weight chi tiết (chỉ kết luận "carrier tính cân nặng hơn", không khẳng định do DIM hay cân thực).
- Xuất CSV cột chẩn đoán (có thể bổ sung sau; cột CSV hiện giữ nguyên).
