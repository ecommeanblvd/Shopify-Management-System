# Đính PDF hoá đơn carrier vào tracking/đơn (Mảng B) — Design

**Date:** 2026-06-19
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Yêu cầu gốc: khi upload **PDF hoá đơn carrier**, PDF phải tự gắn vào đúng **tracking và đơn hàng**, nhân sự không nhập gì. Hiện trạng:
- PDF được đính ở **cấp bill** qua `attachInvoicePdfsToBills` (nút riêng `AttachInvoicePdfDialog`), khớp theo **số hoá đơn** đọc trong nội dung PDF (`matchInvoiceNumbers`). 1 PDF có thể gom nhiều hoá đơn → đính vào mọi bill khớp.
- **Lỗi thật:** attach hiện **ghi đè `carrier_bills.fileKey`** bằng PDF → **mất file nguồn CSV/XLSX** mà mảng A lưu ở đó (cả DHL lẫn FedEx đều để spreadsheet gốc trong `fileKey`).
- Liên kết tracking/đơn → bill **đã tồn tại bắc cầu**: `carrier_bill_lines.shipmentId` + `trackingNumber` + `orderNumber` trỏ về bill. Nhưng PDF **không hiển thị** được khi xem 1 tracking/đơn, và không có cảnh báo bill nào **thiếu PDF**.

## Quyết định đã chốt (scope, 3 việc — KHÔNG tách PDF nhiều trang)
1. **Hiện link tải PDF** ở cấp tracking/đơn (bắc cầu qua bill).
2. **Cảnh báo bill thiếu PDF** sau import.
3. **Kéo PDF thẳng vào `CarrierInvoiceDialog`** (mảng A) — tự nhận PDF, khớp số hoá đơn, đính vào bill; bỏ nút `AttachInvoicePdfDialog` riêng.

## Approach
**Cột PDF riêng trên `carrier_bills`** — KHÔNG đụng `fileKey` (giữ nguyên CSV/XLSX gốc). Nền cho cả 3 việc. Lựa chọn thay thế bị loại: *(a)* tiếp tục clobber `fileKey` → mất file nguồn đối soát; *(b)* bảng PDF many-to-many riêng → over-engineer (1 PDF↔nhiều bill đã xử lý được bằng cách nhiều bill trỏ chung `pdfFileKey`).

## Kiến trúc theo 3 việc

### Việc 1 — Migration + sửa attach (nền)
- **Migration tay** (`db/migrations/`): thêm 4 cột nullable vào `carrier_bills`:
  `pdf_file_key text`, `pdf_filename text`, `pdf_content_type text`, `pdf_byte_size integer`.
  Cập nhật `db/schema.ts` (`pdfFileKey`, `pdfFilename`, `pdfContentType`, `pdfByteSize`).
- **`attachInvoicePdfsToBills`** (`features/carrier-rates/ap/bills-actions.ts`): đổi `.set({ fileKey, filename, contentType, byteSize })` → `.set({ pdfFileKey, pdfFilename, pdfContentType, pdfByteSize })`. KHÔNG đụng `fileKey`. Giữ nguyên logic nén/lưu R2 (1 PDF → 1 object, nhiều bill trỏ chung), key đổi prefix rõ (`carrier-bills/<acc>/pdf-<uuid>.pdf` giữ nguyên).
- **Route tải PDF mới:** `app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/pdf/route.ts` — mirror route `/file` hiện có nhưng đọc `pdfFileKey`; quyền `view_carrier_rates`; `getSignedDownloadUrl(key, 300)` → redirect 307. 404 khi `pdfFileKey` null.

### Việc 2 — Kéo PDF vào `CarrierInvoiceDialog` (gộp, bỏ `AttachInvoicePdfDialog`)
- **`detectInvoiceFormat`** (`features/carrier-rates/ap/invoice-upload.ts`): thêm nhánh `'.pdf'` → `'invoice_pdf'` **bất kể carrier** (PDF khớp theo số hoá đơn, carrier-agnostic). Type `InvoiceFormat` thêm `'invoice_pdf'`.
- **`importCarrierInvoices`**: xử lý theo **2 pha** — spreadsheet (dhl_csv/fbo_xlsx) **trước**, PDF **sau**, để bill tồn tại rồi PDF mới khớp. PDF branch: `extractPdfText(bytes)` + `matchInvoiceNumbers(text, knownBillNumbers)`; với mỗi bill khớp set `pdf_*` (tái dùng `attachInvoicePdfsToBills` hoặc logic tương đương trong cùng action). `existingBillNumbers` + các bill vừa tạo trong batch đều tính là "đã biết".
  - Kết quả `InvoiceImportResult` cho PDF: `ok:true`, `billNumber` = danh sách số khớp (vd `"đính 2 bill"` hoặc số đơn lẻ), `message` mô tả; `matched`/`freight` = null. Không khớp bill nào → `ok:false`, `message:'Không khớp bill nào — import CSV/XLSX trước'`. Đọc lỗi → `ok:false`, `message:'Không đọc được PDF'`.
- **`InvoicePreview` thêm `format: InvoiceFormat`** (`'dhl_csv'|'fbo_xlsx'|'invoice_pdf'`) để dialog biết render dạng PDF (danh sách bill sẽ đính) khác dạng spreadsheet (bill header). `carrier` giữ type `'fedex'|'dhl'` = carrier của account (PDF carrier-agnostic nhưng vẫn thuộc account đang xem).
- **`previewOneInvoice`** cho 1 file PDF: đọc bill hiện có (I/O server-side hợp lệ), `extractPdfText` + `matchInvoiceNumbers` → preview chỉ-đọc `{ format:'invoice_pdf', carrier: ctx.carrierKey, billNumber:null, amount:null, lineCount: số bill sẽ đính, warnings:['PDF sẽ đính vào N bill: <số HĐ>'] }`. Không khớp → vẫn `ok:true` nhưng `lineCount:0` + warning "Không khớp bill nào — import CSV/XLSX trước". Đọc lỗi → `{ ok:false, message:'Không đọc được PDF' }`.
- **`CarrierInvoiceDialog`**: `accept` đã gồm `.pdf` (sẵn). Hiển thị preview PDF (đọc-only) + kết quả batch như các file khác. Bỏ `AttachInvoicePdfDialog` khỏi trang bills; xoá file `AttachInvoicePdfDialog.tsx` nếu không còn nơi dùng.
- **Trang bills**: `previewInvoiceAction`/`importInvoicesAction` không đổi chữ ký (đã nhận mọi file qua field `file`/`files`); chỉ cần action xử lý thêm `.pdf`.

### Việc 3 — Hiện link PDF + cảnh báo thiếu PDF
- **Bắc cầu reconcile**: trong pipeline reconcile-view, mỗi row thêm `pdfBillId: string | null` (id bill có `pdfFileKey != null` mà line khớp `shipmentId`/tracking của row). Panel chi tiết tracking: nếu `pdfBillId` → nút "Hoá đơn PDF" link `/f/carrier-rates/<accountId>/bills/<pdfBillId>/pdf` (mở tab mới). KHÔNG có → không hiện nút.
- **Cảnh báo thiếu PDF (trang bills)**: bảng bills đánh dấu bill có `pdfFileKey = null` (badge "⚠ chưa có PDF"); header/summary đếm "N bill chưa đính PDF". Logic đếm tách hàm thuần test được nếu gọn (`countBillsMissingPdf(bills)`); nếu chỉ là `.filter(b => !b.pdfFileKey).length` thì inline.

## Data flow
Upload (PDF lẫn spreadsheet) → `importCarrierInvoices` (spreadsheet tạo bill → PDF khớp số HĐ → set `pdf_*`) → bill có cả `fileKey` (nguồn) + `pdfFileKey` (PDF). Xem tracking ở đối soát → bắc cầu `shipmentId`→line→bill→`pdfFileKey` → link `/pdf`. Trang bills → badge thiếu PDF theo `pdfFileKey null`.

## Error handling
- PDF không đọc được → kết quả `ok:false`, message; không chặn file khác (per-file isolation như mảng A).
- PDF không khớp bill nào → `ok:false`, gợi ý import spreadsheet trước.
- Re-attach PDF cùng bill → ghi đè `pdf_*` (last-wins), idempotent về dữ liệu.
- Route `/pdf` khi chưa có PDF → 404 "No invoice PDF".
- Quyền: `canAddInvoice` cho import/attach; `view_carrier_rates` cho route tải.

## Test
- `detectInvoiceFormat`: `.pdf` (mọi carrier) → `'invoice_pdf'`; giữ nguyên các case dhl_csv/fbo_xlsx/unsupported.
- `countBillsMissingPdf` (nếu tách): bill có/không `pdfFileKey`.
- Pha xử lý spreadsheet-trước-PDF-sau: test thuần thứ tự nếu tách được; còn lại attach/bridge/route là I/O → verify build + smoke.
- `matchInvoiceNumbers` đã có test sẵn — không đổi.

## Ngoài phạm vi
- Tách PDF nhiều trang theo từng tracking (đã bỏ).
- Mảng C: đối soát PDF↔XLSX (số tiền/phí/ngày) — spec riêng.
- Không đổi `matchInvoiceNumbers`/`extractPdfText`/`compressPdf` nội dung.
