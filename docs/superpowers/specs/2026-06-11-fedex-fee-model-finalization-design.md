# Spec: FedEx fee model hoàn chỉnh — signature auto-apply, import fee, fuel trên demand+signature

**Ngày:** 2026-06-11
**Module:** Carrier rates engine + Đối soát phí ship
**Specs nền:** [addon Direct Signature](./2026-06-11-addon-services-direct-signature-design.md), [signature nước miễn](./2026-06-11-fedex-signature-country-exclusion-design.md), [import handling when_billed](./2026-06-11-fedex-import-handling-when-billed-design.md)

## 0. Rule chốt từ operator (2026-06-11) + bằng chứng dữ liệu

1. **VAT luôn 8%** ở mọi nước (đo: GB/DHL/mọi nước ≠ US đều ra phí ẩn = 0).
2. **Phí nhập khẩu Mỹ = phí CỐ ĐỊNH**: 37.400đ (2025) / 68.300đ (2026), áp
   cho đơn FedEx US. Bị **gộp vào cột VAT** trên bill (254/284 đơn US có
   68.300đ ẩn trong VAT; chỉ 12 đơn nằm đúng cột importHandling). DHL không có.
3. **Direct Signature auto-apply** theo rule: miễn 13 nước (SA,QA,IL,IQ,OM,KZ,
   JO,MC,LU,CY,CZ,PE,AO); 88.000đ (01/06–31/12/2025); 92.700đ (trước 01/06/2025
   và từ 01/01/2026). Đơn không-miễn mà bill không thu → để báo lệch (operator
   rà — phương án A).
4. **FedEx tính fuel SAU signature+demand**: fuel base = net base + remote +
   demand + signature. Import fee KHÔNG được fuel. Đo: 1347/1362 đơn FedEx khớp
   `fuel% × (base+remote+demand+sig)`; chỉ 6 đơn lệch (FedEx không nhất quán —
   để báo lệch).

## 1. Data (script `scripts/migrate-fedex-fee-model.ts`, dry-run/--apply, transaction)

Account FedEx `'FedEx Vietnam — International Priority (IP) 2026'`:
1. **3 dòng Direct Signature** (addon_fixed): `apply_mode` → `always`,
   `fuelable` → `true`. (Đảo từ when_billed.)
2. **2 dòng US import handling** (country_fixed): `apply_mode` → `always`.
   `fuelable` giữ `false` (không fuel). (Đảo từ when_billed.)
3. **Các dòng Demand** (demand_per_kg): `fuelable` → `true`.

DHL KHÔNG đụng. Idempotent, assert số dòng đổi.

## 2. Engine — KHÔNG đổi code

Engine đã hỗ trợ sẵn `apply_mode='always'` (vào quote) + override `fuelable`
per-row cho mọi kind. Sau data change:
- Signature always + fuelable → engine cộng vào quote, đưa vào fuel base.
- Import fee always + fuelable=false → cộng vào quote, NGOÀI fuel base.
- Demand fuelable → vào fuel base.
→ Engine quote FedEx US = base + fuel(base+remote+demand+sig) + demand + sig +
import fee, rồi 8% VAT — khớp cấu trúc bill. Chỉ cần verify, không sửa.

## 3. Đối soát (`reconcile-diagnose.ts`)

### 3.1 Bóc phí nhập bị gộp trong cột VAT
Vì phí nhập nằm lẫn trong cột VAT của bill, cần tách để component khớp đúng.
Với VAT 8% phẳng (rule §0.1):
- `billedTrueVat = round(b.total × vatPercent / (100 + vatPercent))` —
  VAT thật 8% trên toàn bộ (vì total = subtotal × 1.08).
- `billedImportBundled = vatColumn − billedTrueVat` — phần dư = phí nhập ẩn.
- Chỉ bóc khi engine CÓ phí nhập (`e.countryFixed > 0`) và phần dư đáng kể
  (> 1.000đ); ngược lại để nguyên (đơn thường: phần dư ≈ 0).
- Component **vat**: so `billedTrueVat` vs `e.vat`.
- Component **elevatedRisk**: so `(b.elevatedRisk + b.importHandling +
  billedImportBundled)` vs `e.countryFixed`.
- Bất biến Σcomponents = totalDelta giữ nguyên (billedTrueVat +
  billedImportBundled = vatColumn).
→ Đơn US đủ (signature có, import fee có) khớp tuyệt đối 0đ.

### 3.2 Verdict signature engine-thu-bill-không-có
Signature giờ `always` (vào `addons`). Đơn không-miễn mà bill không thu:
`sigDelta < 0` (engine > billed), KHONG_KHOP. Thêm verdict dominant-signature:
`"Hệ thống tính phí ký nhận nhưng hóa đơn không thu — kiểm tra (đơn lẽ ra phải
có ký nhận?)"`, severity config. (Verdict nước-miễn + sai-bảng-giá hiện có giữ
nguyên, đặt trước nhánh này.)

### 3.3 Giữ nguyên
Logic nước miễn (`addonExcludedForCountry`), import-handling sai-bảng-giá
(`countryFixedReference`), fuel credit cũ — vẫn để (dormant cho FedEx signature
nhưng không hại; DHL/khác vẫn dùng).

## 4. Kiểm thử (TDD)

- Engine (verify, không sửa): đơn FedEx US mẫu → quote có signature trong fuel
  base, import fee ngoài fuel base, VAT 8% trên tất cả; khớp billed.
- Diagnose: (a) US đủ signature+import-fee → totalDelta 0 (bóc VAT đúng);
  (b) US không có signature trên bill → verdict "engine thu ký nhận, bill không";
  (c) đơn thường (non-US, VAT đúng 8%) → bóc VAT không đổi gì (regression);
  (d) DHL ER giữ nguyên.

## 5. Verify fleet sau --apply (quyết định)

Baseline trước. Kỳ vọng: **FedEx delta0 TĂNG mạnh** (đơn US đủ giờ khớp 0đ);
~97 đơn US không có signature + ~22 đơn không có import fee trên bill → báo lệch
(phương án A, để rà); ~6 đơn demand-fuel lệch; non-US/DHL không regress. In rõ
trước/sau + danh sách đơn flag để báo operator. Nếu non-US regress bất ngờ →
xem lại phạm vi fuelable demand.
