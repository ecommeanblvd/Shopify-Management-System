# Order detail → bảng P&L "Revenue mình tạo ra" + cân đối margin

**Ngày:** 2026-06-17
**Trạng thái:** Đã duyệt thiết kế, chờ review spec → plan

## 1. Mục tiêu

Thiết kế lại panel chi tiết order (modal khi click 1 đơn) thành **bảng so sánh thu–chi từng đơn**, với 2 mục đích:

1. **Revenue thực sự mình tạo ra** = GMV (khách trả) − mọi chi phí pass-through (giá vốn SP, ship trả carrier, transaction fee, discount, refund). Những khoản pass-through KHÔNG phải giá trị mình làm ra → trừ hết mới ra Revenue.
2. **Cân đối margin theo từng cặp** để chống set-up margin lỗ:
   - **SP:** giá bán vs giá vốn.
   - **Ship:** phí ship thu khách vs phí ship carrier (DHL/FedEx) thực charge.
   Mỗi cặp có cờ ✓ đủ / ⚠ lỗ.

Panel là **read-only** (xem); nút "Sửa" chỉ chỉnh giá vốn dòng + cân nặng (như hiện tại). Billing không sửa tay.

## 2. Công thức

Tính bằng **cost currency của store (VND)**; GMV/giá bán quy từ order currency (USD) qua FX của store (`fxCostPerOrderCurrency`). Hiển thị VND chính, USD tham chiếu.

```
Thu thuần   = Giá bán SP + Ship khách trả − Discount − Refund/return
Tổng chi    = Giá vốn SP + Ship carrier (billed||engine) + Transaction fee
Revenue     = Thu thuần − Tổng chi
Revenue %   = Revenue / GMV         (GMV = Giá bán + Ship khách trả)
```

Cân đối margin (độc lập với Revenue, chỉ để soi set-up):

```
Margin SP    = Giá bán SP − Giá vốn SP          ; % = / Giá bán SP   ; LỖ nếu < 0
Margin Ship  = Ship khách trả − Ship carrier     ; % = / Ship khách trả; LỖ nếu < 0
```

Ship carrier dùng **billed thực tế** nếu có; chưa có hoá đơn → **engine estimate**, gắn nhãn "tạm tính".

## 3. Nguồn dữ liệu mỗi khoản (đã có sẵn trừ transaction fee)

| Khoản | Nguồn |
|---|---|
| Giá bán SP (subtotal) | `OrderDetail.lines` (Σ unitPrice×qty) — đã có |
| Ship khách trả | `OrderDetail.shipping.shippingRevenue` — đã có |
| Discount | order metrics `discount` — đã có |
| Refund/return | `shopify_order_refunds` / metrics `refundedAmount` — đã có |
| Giá vốn SP | `sku_costs` (override theo dòng) — đã có (`OrderDetail.lines[].defaultCostPerUnit` + `costOverride`) |
| Ship carrier billed | `shipment_charges.totalAmount` qua shipments→order — đã có (vừa thêm) |
| Ship carrier engine | `resolveShippingEstimate` — đã có (`OrderDetail.shipping.engineCostVnd`) |
| **Transaction fee** | **CHƯA CÓ — cần sync từ Shopify (mục 4)** |

## 4. Transaction fee — sync số thực từ Shopify (sub-component)

Quyết định: lấy số **thực** từ Shopify (không ước tính %).

- **Nguồn Shopify:** `order.transactions[].fees` (hoặc `paymentGatewayNames` + `transaction.amountSet`/`fee`) qua Admin GraphQL. Gộp fee các transaction "sale"/"capture" của đơn → tổng phí gateway (đơn vị: order currency).
- **Lưu trữ:** thêm cột `shopify_orders.transaction_fee` (numeric, order currency) + `transaction_fee_currency`. (Đơn giản nhất; nếu cần chi tiết từng transaction sau này mới tách bảng.)
- **Nạp:**
  - Sync mới: bổ sung field vào query order sync để mỗi đơn mới có fee.
  - Đơn cũ: **script backfill** gọi Shopify lấy fee theo lô (giống pattern backfill khác trong `scripts/`).
- **P&L:** quy fee về VND qua store FX khi trừ.
- **Thiếu fee** (chưa sync / gateway không trả fee): hiện "—" và loại khỏi Tổng chi, gắn nhãn "chưa có phí GD".

> Đây là phần nặng nhất; plan sẽ tách bước rõ: (a) schema+migration, (b) field vào sync, (c) backfill script, (d) đưa vào P&L.

## 5. UI layout (Phương án B — đã chọn)

Panel (read-only) theo thứ tự từ trên xuống:

1. **Header:** Order # · ngày xử lý · ngày đi hàng (đã có).
2. **CÂN ĐỐI MARGIN** — 2 thẻ cạnh nhau:
   - SP: bán / vốn / **Margin SP** (xanh ✓ hoặc đỏ ⚠ + %). Thiếu giá vốn → "thiếu giá vốn", không tính.
   - Ship: thu / carrier / **Margin Ship** (xanh/đỏ + %). Nhãn billed/engine·tạm tính. Lỗ → dòng cảnh báo "set-up phí ship chưa đủ cover".
3. **P&L hai cột:** THU (giá bán + ship − discount − refund) | CHI (giá vốn + ship + txn fee), mỗi cột có dòng tổng.
4. **Banner REVENUE:** số VND lớn + % / GMV, xanh nếu ≥0 / đỏ nếu <0.
5. **Drill-down** (mở rộng): line items chi tiết (SKU · bán · vốn), ship breakdown (engine vs billed + từng phụ phí), transaction fee detail.
6. **Footer:** nút "Sửa" → hiện ô nhập giá vốn dòng + cân nặng + note (giữ logic Edit hiện tại).

Giữ FX button (đặt tỉ giá) khi store chưa có FX để quy USD→VND.

## 6. Edge cases

- **Thiếu giá vốn** (skuCostCoverage < 100%): Margin SP + Tổng chi báo "thiếu giá vốn", Revenue đánh dấu chưa đủ dữ liệu.
- **Chưa có billed ship:** dùng engine (tạm tính) cho cả Margin Ship lẫn Tổng chi; nhãn rõ.
- **Đơn nhiều pack:** ship billed = Σ shipment_charges của đơn (đã xử lý ở order-actions).
- **Refund toàn phần:** Thu thuần giảm theo refund; Revenue có thể âm.
- **Đơn khác currency / chưa set FX:** chưa quy được → hiện cảnh báo "đặt tỉ giá", các số cost vẫn xem được ở VND.

## 7. Files ảnh hưởng (dự kiến — plan chốt chi tiết)

- `db/schema.ts` + migration: `shopify_orders.transaction_fee` (+ currency).
- `features/shopify-orders/sync/*`: thêm fee vào query + upsert.
- `scripts/backfill-transaction-fees.ts`: backfill đơn cũ.
- `features/shopify-orders/order-actions.ts`: `getOrderDetail` trả thêm `transactionFee`, `marginSP`, `marginShip`, các số P&L (hoặc tính ở component từ field có sẵn).
- `features/shopify-orders/pnl.ts` (mới, thuần): hàm tính P&L + 2 margin từ input → dễ test.
- `components/shopify-orders/OrdersTable.tsx` (hoặc tách `OrderPnlPanel.tsx`): render panel B. **Tách component** vì OrdersTable đang lớn.

## 8. Testing

- `pnl.ts` (thuần): unit test công thức Revenue, Margin SP/Ship, cờ lỗ, edge (thiếu vốn, refund, engine-fallback, FX null).
- Backfill/sync: test parser fee từ payload mẫu.

## 9. Out of scope (v1)

- Phí đóng gói/handling, phí PayPal riêng, thuế — không đưa vào (đã chốt đúng 5 khoản trừ).
- Tổng hợp P&L mức dashboard/kỳ (chỉ làm panel từng đơn).
- Sửa tay billing/transaction fee (auto từ nguồn).
