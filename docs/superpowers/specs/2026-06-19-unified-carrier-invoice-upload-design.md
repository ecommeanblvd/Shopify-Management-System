# Gộp upload hoá đơn carrier — auto-parse, không nhập tay (Mảng A) — Design

**Date:** 2026-06-19
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Hiện có **2 nút riêng** trên trang bills carrier:
- "Thêm hoá đơn" (`AddBillDialog`) — auto-fill **chỉ DHL CSV** (parse client-side); file khác (XLSX/PDF) → **form nhập tay**.
- "Import FBO" (`ImportFboDialog`) — FedEx XLSX (parse server-side).

→ Người dùng dễ kéo nhầm nút, và nút DHL còn bắt **nhập tay** khi gặp file lạ. Nhân sự có thể điền sai. Yêu cầu: **source of truth = file carrier**, người dùng **chỉ kéo file**, không điền gì; cả FedEx lẫn DHL **một luồng giống nhau**.

(PDF & đối soát PDF↔XLSX là mảng B/C — ngoài phạm vi spec này.)

## Quyết định đã chốt
- **Một nút duy nhất** "Thêm hoá đơn carrier"; bỏ nút "Import FBO" riêng.
- **Không ô nhập tay nào** — bỏ hết `<input>` mã HĐ/số tiền/kỳ/ngày/ghi chú.
- **1 file → preview chỉ-đọc → bấm Lưu**; **nhiều file → import hàng loạt** (mở cho cả FedEx, không chỉ DHL).
- Parse **server-side cho cả 2** (client KHÔNG truyền giá trị → đúng "source of truth = file").

## Kiến trúc

### Server actions thống nhất (trang bills) — detect theo `account.carrierKey` + đuôi file
```ts
// Preview 1 file (chỉ đọc, không ghi DB).
previewCarrierInvoice(file) -> InvoicePreview
// Import 1 hoặc nhiều file (ghi bill + đối soát). Dùng cho cả "Lưu" (1 file) lẫn batch.
importCarrierInvoices(files) -> InvoiceImportResult[]
```
- **Route theo carrier:**
  - `dhl` + `.csv` → `parseDhlInvoiceCsv(text)` → bill header + `shipments` → `createBill` + `reconcileDhlBill`.
  - `fedex` + `.xlsx`/`.xls` → `previewFboBill(bytes)` / `applyFboBill(...)` (FBO).
  - Sai định dạng → kết quả `{ ok:false, message:'Không đúng định dạng hoá đơn <carrier>' }`. KHÔNG form nhập tay.
- **Idempotent:** trùng `billNumber` → bỏ qua (`message:'Đã tồn tại'`) — như batch DHL hiện tại; FedEx upsert theo (account, billNumber) sẵn có.
- **InvoicePreview** (chuẩn hoá chung 2 carrier, chỉ đọc):
  ```ts
  interface InvoicePreview {
    carrier: 'fedex' | 'dhl'; billNumber: string | null; amount: number | null; currency: string;
    periodStart: string | null; periodEnd: string | null; issueDate: string | null; dueDate: string | null;
    lineCount: number; warnings: string[];
  }
  ```
  Hàm thuần `toInvoicePreview(...)` map từ kết quả parse DHL **và** FboPreview về shape chung (test được).
- **InvoiceImportResult:** `{ filename, ok, billNumber, amount, matched, freight, message }` (gộp `BatchImportResult` + kết quả FBO).

> Tận dụng `createBill`, `reconcileDhlBill`, `previewFboBill`, `applyFboBill`, `parseDhlInvoiceCsv` sẵn có — KHÔNG viết lại parser nội dung. Chỉ thêm lớp **điều phối + chuẩn hoá** server-side.

### Dialog client — `CarrierInvoiceDialog` (thay `AddBillDialog` + `ImportFboDialog`)
- Props: `carrierKey`, `currency`, `previewAction`, `importAction`.
- Kéo/chọn file:
  - **1 file** → `previewAction(file)` → hiện **preview chỉ-đọc** (số HĐ/số tiền/kỳ/ngày/số dòng + warnings). Nút **"Lưu"** → `importAction([file])`.
  - **Nhiều file** → bỏ preview, hiện danh sách → nút **"Import hàng loạt"** → `importAction(files)` → bảng kết quả từng file (ok/skip/lỗi).
- **Không** render `<input>` editable nào. File lỗi → hiện message rõ, không có form tay.
- Tiến độ/`useTransition` khi đang xử lý.

### Trang bills
- Thay 2 dialog bằng 1 `CarrierInvoiceDialog` (mọi carrier). Xoá `ImportFboDialog` khỏi page.
- Giữ các luồng khác (payment, list bills, đính PDF) nguyên.

## Error handling
- Parse fail / sai carrier-format → result `ok:false` + message; KHÔNG fallback form tay.
- Currency lệch (file ≠ account) → warning trong preview (không chặn).
- Trùng billNumber → skip (idempotent).
- Quyền: `canAddInvoice` (như hiện tại) trên cả 2 action.

## Test
- `toInvoicePreview`: map đúng từ kết quả DHL parse + FboPreview → shape chung; field thiếu → null/warning.
- Route detect: dhl+.csv→DHL, fedex+.xlsx→FBO, sai đuôi/định dạng→ok:false message (test phần thuần tách khỏi I/O).
- (Action ghi DB + dialog là integration — verify build + smoke.)

## Ngoài phạm vi
- PDF attach (mảng B), đối soát PDF↔XLSX (mảng C).
- Không đổi parser nội dung DHL/FedEx.
- Không bỏ tính năng tạo bill thủ công cho carrier khác (hiện chỉ DHL/FedEx có parser; carrier khác chưa hỗ trợ upload — ngoài phạm vi).
