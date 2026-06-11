# Spec: So sánh giá ship trong chi tiết đơn (Rev · Engine · Billed + biên)

**Ngày:** 2026-06-11
**Module:** Orders (`/f/orders/[storeId]`) — chi tiết đơn (OrdersTable modal)
**Specs nền:** carrier-rates engine (quote), shipping estimate (resolve-shipping-estimate / batch-shipping-estimator)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-11)

Engine giá ship đã tự tính khi order về (pin đúng carrier khách trả, theo ngày
order). Chi tiết đơn hiện chỉ hiện **MỘT** số ship (nguồn "thắng" theo ưu tiên
override > invoice > engine), và **cố ý ẩn** Rev ship (doanh thu khách). Operator
muốn thấy **cả 3 cạnh nhau + biên lãi/lỗ**.

Quyết định:
1. Hiện **3 số**: Rev ship (khách trả) · Engine (ước tính) · Billed (hóa đơn khớp).
2. **Quy về VND** (tiền vận hành) dùng `fxCostPerOrderCurrency` của đơn.
3. **Biên = Rev − cost**, cost = **Billed nếu có, không thì Engine**.
4. Thiếu FX (đơn ngoại tệ chưa set tỉ giá) → hiện Rev tiền gốc, KHÔNG tính biên,
   nút "Đặt tỉ giá" (tái dùng `CostFxButton`).

## 1. Dữ liệu (`features/shopify-orders/order-actions.ts`)

`getOrderDetail` hiện tính `defaultBreakdown`/`defaultSource` (1 nguồn thắng).
Mở rộng `OrderShippingDetail` để LUÔN có cả 3:
- `shippingRevenue` (số, tiền đơn) — đã có.
- `engineCostVnd: number | null` — gọi engine estimate **vô điều kiện** (kể cả
  khi đã khớp invoice). Lấy `carrierCostDisplay`/`rawAmount` (VND). null nếu
  engine không định giá được (thiếu nước/cân/zone — như `defaultSource='unknown'`).
- `billedCostVnd: number | null` — actual_cost từ `shipping_invoices` khớp
  tracking (đã query sẵn ở getOrderDetail). null nếu chưa có hóa đơn.
- FX để UI quy đổi: `orderCurrency` (=order.currency), `costCurrency`
  (=order.costCurrency, kỳ vọng 'VND'), `fxCostPerOrderCurrency: number | null`.

Giữ nguyên `defaultBreakdown`/`defaultSource`/override — block breakdown cũ vẫn
hiển thị dưới dòng Engine.

## 2. Logic quy đổi + biên (`features/shopify-orders/ship-comparison.ts`, pure, TDD)

Helper thuần `computeShipComparison(input) → ShipComparison`:
```
input: { shippingRevenue, orderCurrency, costCurrency, fxCostPerOrderCurrency,
         engineCostVnd, billedCostVnd }
```
- `revVnd`: nếu `orderCurrency === costCurrency` (cả hai VND) → `shippingRevenue`;
  else nếu `fxCostPerOrderCurrency != null` → `shippingRevenue × fx`; else `null`
  (thiếu FX — không quy đổi được).
- `costVnd`: theo đúng ưu tiên cost hệ thống đang dùng (`defaultSource`):
  `overrideVnd ?? billedCostVnd ?? engineCostVnd`; `costBasis`:
  'override' | 'billed' | 'engine' | null. (Operator chốt: billed-nếu-có-không-thì-engine;
  override khi đã set là cost hệ thống thực sự gán nên đứng trên.)
- `overrideVnd`: `shippingCostOverride` ghi đè cost carrier (cùng đơn vị cost =
  VND) → dùng thẳng, không quy đổi. (Plan xác nhận đơn vị override; nếu là tiền
  đơn thì quy như Rev.)
- `marginVnd`: `revVnd != null && costVnd != null ? revVnd − costVnd : null`.
- `marginPct`: `revVnd ? marginVnd / revVnd × 100 : null` (hiện kèm, theo Rev).
- `needsFx`: true khi `orderCurrency !== costCurrency && fxCostPerOrderCurrency == null`.
Trả về đủ các số (revVnd, engineCostVnd, billedCostVnd, costVnd, costBasis,
marginVnd, marginPct, needsFx) cho UI render thẳng.

## 3. UI (`components/shopify-orders/OrdersTable.tsx`, mục "Shipping cost")

Thay đoạn hiện chỉ render 1 nguồn bằng **bảng so sánh** (đều VND, fmt vi-VN):
| Dòng | Giá trị |
|---|---|
| Rev ship (khách trả) | `revVnd` (kèm `shippingRevenue` + orderCurrency gốc trong ngoặc khi ≠ VND) |
| Hệ thống tính (engine) | `engineCostVnd` — giữ `<ShippingCostBreakdown>` mở rộng được bên dưới; "—" nếu null + diagnostic cũ |
| Billed thực tế | `billedCostVnd` hoặc "Chưa có hóa đơn" |
| **Biên ship** (vs billed/engine) | `marginVnd` (xanh ≥0 / đỏ <0) + `marginPct`; ghi rõ basis |

- `needsFx` → thay dòng biên bằng dòng nhắc + `<CostFxButton>`; Rev hiện tiền gốc.
- Override còn hiệu lực: nếu `shippingCostOverride` set, hiện thêm dòng "Override"
  và biên tính theo override (override là cost thực operator chốt) — giữ ưu tiên
  override > billed > engine cho **cost dùng tính biên** (cập nhật §2: costVnd =
  overrideVnd ?? billedCostVnd ?? engineCostVnd; override cũng quy về VND như Rev
  nếu override ở tiền đơn — override lưu ở order currency theo schema).

## 4. Kiểm thử (TDD)

- `ship-comparison.ts`: (a) đơn VND (revVnd=shippingRevenue, biên đúng);
  (b) đơn USD có FX (rev×fx, biên VND); (c) thiếu FX → needsFx, marginVnd null;
  (d) ưu tiên cost: override > billed > engine; (e) chưa có billed → dùng engine,
  basis 'engine'; (f) marginPct theo Rev, null khi rev 0.
- UI: không unit test (đọc JSX); tsc + eslint sạch; suite hiện hành xanh.

## 5. Ngoài phạm vi
- Không đổi cách engine định giá / khớp invoice / override.
- Không làm báo cáo tổng hợp biên ship toàn store (chỉ per-đơn trong modal).
- Không thêm cột biên ship vào bảng danh sách đơn (có thể sau).
