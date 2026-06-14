# Carrier account page — AP-first redesign

**Goal:** Làm trang `/f/carrier-rates/[id]` lấy công nợ (AP) làm trung tâm: summary công nợ + bảng invoice lên đầu; toàn bộ setup (FX/weight/phase/notes + 6 công cụ) gọn vào nút (!). Mỗi invoice click ra modal chi tiết từng shipment; icon documents mở file gốc.

**Decisions (chốt 2026-06-14):**
- Chi tiết per-shipment trong modal → **từ parse file bill** (làm sau khi có format). Iteration này dựng cấu trúc + modal shell đọc `carrier_bill_lines` (rỗng đến khi parser chạy).
- Setup: **metadata + cả 6 card công cụ** vào (!).
- Summary công nợ: **per-account** (trên trang từng carrier).
- Gộp AP vào trang account; `/bills` redirect về hub.

## Schema mới: `carrier_bill_lines`
Một dòng = một shipment trong hoá đơn (parser ghi sau).
`id, bill_id (→carrier_bills, cascade), tracking_number, order_number, weight_kg numeric, base numeric, discount numeric, fuel numeric, remote numeric, demand numeric, signature numeric, vat numeric, other numeric, total numeric, note, created_at`. Index theo `bill_id`. Áp DDL idempotent.

## Server
- `bills-actions.ts`: thêm `listBillLines(billId) → BillLineRow[]`.
- Giữ nguyên createBill/addPayment/list…; period-compare giữ nguyên.

## UI
### Hub page `app/(dashboard)/f/carrier-rates/[id]/page.tsx` (viết lại layout)
- **Header**: tên + badge + nút **(!) "Cấu hình & công cụ"** mở `CarrierSetupSheet`.
- **AP summary cards** (reuse summariseAp): Đã bill · Đã thanh toán · Còn nợ · Quá hạn + dòng tham chiếu all-time.
- **Section "Billing / Invoices"**: form upload (thu gọn) + `BillsBoard`.

### `components/carrier-rates/CarrierSetupSheet.tsx` (mới, client, dùng `ui/sheet`)
Trigger = nút (!). Nội dung: FX rate + updated + weight unit + phase + ghi chú; danh sách link 6 công cụ (Rate workspace, Weight tiers, Surcharges, Remote postcodes, Calculator, Recalculate&push); form Enable/Delete (nếu canManage).

### `components/carrier-rates/BillsBoard.tsx` (sửa)
- Mỗi dòng invoice: **click dòng → mở `InvoiceDetailModal`** (thay vì expand payments inline).
- Giữ icon documents → mở `/bills/[billId]/file`. Giữ AddPaymentDialog + payments (đưa vào trong modal chi tiết).

### `components/carrier-rates/InvoiceDetailModal.tsx` (mới, client, `ui/dialog` + `ui/table`)
- Tab/section 1 — **Chi tiết shipment**: bảng đọc `carrier_bill_lines` (cột tracking · order · kg · base · discount · fuel · remote · … · total). Rỗng → "Chi tiết từng đơn sẽ hiện khi parse file hoá đơn."
- Tab/section 2 — **Thanh toán**: list payments + AddPaymentDialog + nút xem bằng chứng.
- Header modal: mã invoice, kỳ, amount, còn nợ, status, nút mở file gốc.

### `/bills/page.tsx` → `redirect` về `/f/carrier-rates/[id]`. Giữ route `…/bills/[billId]/file` và `…/bills/payments/[paymentId]/proof`.

## Out of scope (iteration này)
- Parser bóc base/discount/phụ phí từng đơn từ PDF/Excel → ghi `carrier_bill_lines` (làm khi có file mẫu).
- Dashboard tổng đa-carrier.

## Verify
- `next build` ✓ (đã có tiền lệ pg/client — kiểm build thật).
- summariseAp test cũ vẫn xanh; tsc/eslint sạch.
