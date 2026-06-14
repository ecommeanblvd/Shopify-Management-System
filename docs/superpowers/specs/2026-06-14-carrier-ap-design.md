# Carrier AP (quản trị công nợ đối tác vận chuyển) — Design

**Goal:** Trong module carrier-rate, theo dõi công nợ thực với FedEx/DHL: upload hoá đơn carrier (statement theo kỳ), upload bằng chứng thanh toán (partial), và summary công nợ còn nợ / quá hạn theo từng đối tác.

**Decisions (chốt với user 2026-06-14):**
- 1 bill = **hoá đơn theo kỳ (statement)** gộp nhiều lô — không link từng đơn.
- **AP độc lập, có so kỳ**: bill là chứng từ AP riêng; hiển thị thêm Σ chi phí hệ thống ghi nhận trong kỳ để so lệch, nhưng không bắt khớp.
- **Partial payment + due date**: 1 bill nhiều lần trả, mỗi lần có file bằng chứng; trạng thái chưa/một phần/đủ; cảnh báo quá hạn theo due_date.

## Data model (2 bảng mới)

### `carrier_bills`
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid pk | |
| carrier_account_id | uuid → carrier_accounts | cascade |
| bill_number | text | mã hoá đơn carrier (nullable) |
| period_start, period_end | date | kỳ statement |
| issue_date | date | ngày xuất hoá đơn (nullable) |
| due_date | date | hạn thanh toán (nullable) → cảnh báo quá hạn |
| amount | numeric(14,2) | tổng carrier thu |
| currency | text | theo account.costCurrency (VND) |
| file_key, filename, content_type, byte_size | | hoá đơn gốc trên R2 (nullable file) |
| note | text | |
| created_by | text → user | |
| created_at | timestamp | |

### `carrier_bill_payments`
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid pk | |
| bill_id | uuid → carrier_bills | cascade |
| paid_at | date | ngày thanh toán |
| amount | numeric(14,2) | số đã trả |
| method | text | hình thức (nullable) |
| proof_file_key, proof_filename, proof_content_type, proof_byte_size | | bằng chứng thanh toán R2 (nullable) |
| note | text | |
| created_by | text → user | |
| created_at | timestamp | |

DDL áp qua SQL idempotent (migrations đã drift).

## Logic thuần (TDD): `features/carrier-rates/ap/ap-summary.ts`
`summariseAp(bills, paymentsByBill, today)`:
- mỗi bill: `paid = Σ payments`, `outstanding = amount − paid`, `status ∈ {unpaid, partial, paid}` (paid khi outstanding ≤ 0.5đ), `overdue = due_date != null && due_date < today && outstanding > 0`.
- roll-up account: `totalBilled, totalPaid, totalOutstanding, overdueCount, overdueAmount`.
Pure, không I/O. Test: unpaid/partial/paid, overdue, rounding epsilon, roll-up.

## Query: `features/carrier-rates/ap/period-compare.ts`
`systemTotalForPeriod(accountId, start, end)` = Σ `shipment_charges.total_amount` cho shipment cùng account, `label_created_at ∈ [start, end]`. Trả `{ systemTotal, shipmentCount }` để UI so với `bill.amount`.

## Server actions: `features/carrier-rates/ap/bills-actions.ts`
- `createBill(input, file?)` — upload file R2 (key `carrier-bills/{acc}/{uuid}`) + insert.
- `listBills(accountId)` + `getPaymentsByBill(accountId)` → cho summariseAp.
- `addPayment(billId, input, proof?)` — upload proof R2 (`carrier-bill-payments/{bill}/{uuid}`) + insert.
- `deleteBill(id)`, `deletePayment(id)`.
Quyền: `manage_carrier_rates` để ghi.

## Download routes (signed URL, mirror remote-evidence/rate-card)
- `…/bills/[billId]/file/route.ts` — hoá đơn gốc.
- `…/bills/payments/[paymentId]/proof/route.ts` — bằng chứng thanh toán.

## UI: `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx` + components
- **Cards**: Đã bill · Đã thanh toán · **Còn nợ** · Quá hạn (count + tiền).
- **Bảng bills** (`BillsBoard.tsx`): mã, kỳ, issue/due, amount, đã trả, còn nợ, badge trạng thái + quá hạn, Δ so-kỳ (amount − systemTotal), nút xem hoá đơn gốc, nút + thanh toán, expand xem payments (mỗi cái nút xem bằng chứng + xoá).
- **Form upload bill** + **AddPaymentDialog** (số tiền + ngày + file).
- Permission gate như remote-postcodes.

## Files
- `db/schema.ts` (+2 bảng)
- `features/carrier-rates/ap/ap-summary.ts` + `.test.ts`
- `features/carrier-rates/ap/bills-actions.ts`
- `features/carrier-rates/ap/period-compare.ts`
- `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx`
- `app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/file/route.ts`
- `app/(dashboard)/f/carrier-rates/[id]/bills/payments/[paymentId]/proof/route.ts`
- `components/carrier-rates/BillsBoard.tsx`, `AddPaymentDialog.tsx`

## Out of scope (v1, YAGNI)
- Roll-up đa-carrier toàn hệ thống (chỉ per-account; hub hiện outstanding sau).
- OCR hoá đơn (nhập tay tổng tiền + đính file).
- Đa tiền tệ / FX trong AP (dùng currency của account).
