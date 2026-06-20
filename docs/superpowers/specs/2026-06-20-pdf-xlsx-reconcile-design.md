# Đối soát PDF ↔ XLSX hoá đơn carrier (Mảng C) — Design

**Date:** 2026-06-20
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Sau mảng A (bill từ CSV/XLSX) + mảng B (đính PDF vào bill theo số HĐ), ta có cả **file nguồn** (XLSX/CSV → `carrier_bills.amount` + lines) lẫn **PDF hoá đơn chính thức** (`carrier_bills.pdf_file_key`) trên cùng 1 bill. Yêu cầu gốc: **đối soát PDF với XLSX** xem **số tiền và các ngày** có khớp không — phát hiện khi carrier gửi 2 file lệch nhau hoặc PDF đính nhầm bill.

**Mức đối soát (đã chốt): Tổng + ngày** (MVP chắc chắn). Không so từng khoản phí / từng AWB (PDF không liệt kê đủ, dễ vỡ).

## Layout PDF thật (đã lấy mẫu)

### FedEx — block "FREIGHT INVOICE SUMMARY" (1 block / hoá đơn, lặp lại nếu nhiều HĐ)
```
Invoice No.:                 734005869          ← khớp billNumber (9 số) bill FBO
Invoice Date:                28 Jul 2025         ← issueDate  (dd Mon yyyy)
Grand Total (VAT included)   132,509,041         ← total (dấu phẩy ngăn nghìn)
Your payment is due by 17 Aug 2025               ← dueDate  (dd Mon yyyy)
```

### DHL — header + dòng tổng (1 hoá đơn / PDF mẫu; nếu nhiều thì header lặp)
```
Invoice no.   HANR000269158        ← billNumber (HANR + số)
Date          13/05/2026            ← issueDate (dd/mm/yyyy)
Total VND     34,696,865            ← total (dấu phẩy ngăn nghìn)
(DHL KHÔNG in due date → dueDate = null)
```

> Cả 2 carrier đều có bản VAT invoice tiếng Việt với tổng dạng dấu chấm (`132.509.041` / `34.696.865`) trùng khớp — KHÔNG cần parse phần này; chỉ dùng block tiếng Anh ở trên cho gọn.

## Kiến trúc (4 đơn vị thuần + 1 schema + 1 capture + 1 UI)

### 1. Parser thuần — `features/carrier-rates/ap/pdf-invoice-totals.ts` (mới)
```ts
export interface PdfInvoiceTotals { total: number; issueDate: string | null; dueDate: string | null }
/** Map số hoá đơn → tổng/ngày đọc từ text PDF. Thiếu/không parse được → entry vắng. THUẦN. */
export function parsePdfInvoiceTotals(text: string, carrier: 'fedex' | 'dhl'): Record<string, PdfInvoiceTotals>
```
- **FedEx** (`parseFedexPdfTotals`): tách theo mỏ neo `Invoice No.:` trong block summary; mỗi block đọc `Invoice No\.:\s+(\d{6,})`, `Grand Total (VAT included)\s+([\d,]+)`, `Invoice Date:\s+(\d{1,2} \w{3} \d{4})`, `due by (\d{1,2} \w{3} \d{4})`. Ngày `dd Mon yyyy` → ISO (map tháng Anh).
  - **Gotcha:** PDF có cả `VAT Invoice No.: 1K25TFA-00006666` — value bắt đầu bằng chữ nên `\d{6,}` (sau `\s+`, không backtrack qua ký tự) **không** dính dòng này; chỉ khớp `Invoice No.: 734005869`. KHÔNG dùng `(\d+)` lỏng (sẽ bắt nhầm "1").
- **DHL** (`parseDhlPdfTotals`): tách theo `Invoice no.\s+(HANR\d+)`; mỗi block đọc `Total VND\s+([\d,]+)` và `Date\s+(\d{2}/\d{2}/\d{4})` (dd/mm/yyyy → ISO). `dueDate = null`.
- Số: bỏ `,` rồi `Number`. Ngày fail → null. Block thiếu total → bỏ entry (không đưa total=0).
- Test bằng **fixture text trích từ mẫu thật** (FedEx multi-block, DHL single).

### 2. Schema — migration `0070_carrier-bill-pdf-totals.sql`
Thêm vào `carrier_bills` (nullable): `pdf_amount numeric(14,2)`, `pdf_issue_date date`, `pdf_due_date date`. Cập nhật `db/schema.ts` (`pdfAmount`, `pdfIssueDate`, `pdfDueDate`). Migration **tay** + journal entry idx 70; KHÔNG chạy cục bộ (prod, apply khi deploy).

### 3. Capture lúc upload — `importCarrierInvoices` nhánh PDF (đã có ở mảng B)
Sau khi `extractPdfText` + `matchInvoiceNumbers`: gọi `parsePdfInvoiceTotals(text, ctx.carrierKey)`. Khi update mỗi bill khớp (set `pdf_*` file ở mảng B), set thêm `pdfAmount/pdfIssueDate/pdfDueDate` từ entry tương ứng số HĐ (nếu có; không có → để null). Không có entry → chỉ đính file, total null → UI hiện "chưa đọc được tổng".

### 4. So sánh thuần — `features/carrier-rates/ap/compare-pdf-bill.ts` (mới)
```ts
export type PdfCmpStatus = 'match' | 'mismatch' | 'unknown';
export interface PdfBillCompare {
  amountStatus: PdfCmpStatus; amountDeltaVnd: number | null;
  issueDateStatus: PdfCmpStatus; dueDateStatus: PdfCmpStatus;
  overall: PdfCmpStatus;
}
export const PDF_MATCH_TOLERANCE_VND = 1000;
export function comparePdfToBill(
  bill: { amount: number; issueDate: string | null; dueDate: string | null },
  pdf: { pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null },
): PdfBillCompare
```
- amount: `pdfAmount` null → `unknown`, delta null; else delta = `amount − pdfAmount`, |delta| ≤ 1000 → `match` else `mismatch`.
- issueDate/dueDate: phía PDF null → `unknown`; bằng chuỗi ISO → `match`; khác → `mismatch`.
- overall: `unknown` nếu amountStatus `unknown`; `mismatch` nếu amountStatus `mismatch` HOẶC issueDate/dueDate `mismatch`; còn lại `match`.

### 5. UI bill-level — `BillsBoard` + `InvoiceDetailModal`
`BillRow` (`listBills`) thêm `pdfAmount: number|null`, `pdfIssueDate: string|null`, `pdfDueDate: string|null`. UI gọi `comparePdfToBill` rồi hiện badge **cạnh** khu vực "⚠ chưa có PDF" (mảng B):
- Chỉ hiện khi bill **có PDF** (`hasPdf`).
- 🟢 `PDF khớp` (overall match) · 🟡 `PDF lệch +X` (mismatch — tooltip ghi rõ `PDF <pdfAmount> vs XLSX <amount>` và/hoặc "ngày HĐ/đáo hạn lệch") · ⚪ `PDF chưa đọc được tổng` (unknown).
- Summary bills: đếm `N bill PDF lệch` (overall mismatch) khi > 0.

## Data flow
Upload PDF → `importCarrierInvoices` parse total/date → lưu `pdf_amount/pdf_issue_date/pdf_due_date`. Xem bill → `listBills` trả các field → UI `comparePdfToBill` → badge khớp/lệch/chưa-đọc.

## Error handling / edge
- Parse fail (layout lạ, scan ảnh) → entry vắng → `pdf_amount` null → badge `unknown` "chưa đọc được tổng". **Không bao giờ báo "lệch" sai.**
- 1 PDF nhiều hoá đơn → mỗi bill lấy entry theo đúng số HĐ; bill không có entry → unknown.
- Bill cũ đã đính PDF (trước mảng C) → `pdf_amount` null → unknown; re-upload PDF sẽ điền. (Backfill ngoài phạm vi.)
- Tolerance 1000 VND nuốt lệch làm tròn; số carrier vốn nguyên nên ít chạm.
- Quyền: dùng lại gate hiện có; không thêm action ghi mới ngoài capture trong import.

## Test
- `parsePdfInvoiceTotals` FedEx: fixture multi-block → map đúng `{734005869:{total:132509041, issueDate:'2025-07-28', dueDate:'2025-08-17'}, …}`.
- `parsePdfInvoiceTotals` DHL: fixture → `{HANR000269158:{total:34696865, issueDate:'2026-05-13', dueDate:null}}`.
- Parse fail/thiếu total → entry vắng (không total=0).
- `comparePdfToBill`: match (lệch ≤ tol), mismatch (amount lệch), mismatch (ngày lệch), unknown (pdfAmount null), DHL dueDate null → dueDateStatus unknown nhưng overall vẫn match nếu amount khớp.
- Capture + UI badge: integration → verify build + smoke.

## Ngoài phạm vi
- So từng khoản phí (fuel/VAT/demand) và từng AWB.
- Backfill bill cũ; đối soát mức tracking; sửa parser khi carrier đổi template (theo dõi sau).
- Mảng A/B đã xong (PR #190/#191) — C stack tiếp.
