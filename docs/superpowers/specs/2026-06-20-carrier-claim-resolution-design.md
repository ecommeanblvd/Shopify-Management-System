# Đóng vòng đời claim lỗi carrier — credit note & chấp nhận chênh lệch — Design

**Date:** 2026-06-20
**Status:** Approved (quyết định chốt), pending spec review

## Vấn đề
Module Đối soát phí ship hiện đánh dấu đơn lỗi carrier rồi đòi NCC: `carrier_error` → `disputing` (Đang đòi NCC, `deltaVndAtReview` = số đã đòi). **Chưa có bước kết thúc.** Cần flow tiếp:
- NCC **chấp nhận giảm trừ** → upload **credit note** (file NCC gửi) → tự khớp theo tracking → ghi số **đã thu hồi**, đóng đơn.
- NCC **từ chối** (bảo là lệch cân nặng giữa 2 bên, không phải lỗi) → **chấp nhận chênh lệch**, đóng đơn.
- NCC giảm trừ **một phần** → ghi thu hồi phần đó, **phần còn lại** chờ người dùng bấm "chấp nhận chênh lệch" riêng (tách 2 bước).

## Vòng đời (mở rộng từ `disputing`)
```
carrier_error → disputing (deltaVndAtReview = số đã đòi)
   │
   ├─ applyCreditNote(file): khớp tracking → set recoveredVnd
   │     • recoveredVnd ≥ |deltaVndAtReview|  → status 'credited' (thu hồi đủ, terminal)
   │     • recoveredVnd < |deltaVndAtReview|   → vẫn 'disputing' (thu hồi 1 phần; còn lại = |delta|−recovered)
   │
   └─ acceptDifference(shipmentId): status 'accepted' (terminal)
         (recoveredVnd giữ nguyên nếu đã credit 1 phần → report tách Σ thu hồi vs Σ chấp nhận)
```
2 trạng thái terminal mới: **`credited`** (đã thu hồi đủ) · **`accepted`** (chấp nhận chênh lệch, gồm cả sau khi thu hồi 1 phần).

## Kiến trúc

### 1. Schema — migration tay `0071_carrier-claim-resolution.sql`
- Mở rộng enum `reconcile_status`: thêm `'credited'`, `'accepted'`
  (`ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'credited';` + `'accepted'`, mỗi value 1 câu, tách bằng statement-breakpoint). PG12+ (Railway) chạy được trong file migration; chỉ lưu ý KHÔNG dùng value mới để ghi data trong **cùng** transaction đã thêm nó — ở đây migration chỉ thêm value + cột, không ghi data nên an toàn.
- `shipment_reconcile_status` thêm (nullable): `recovered_vnd numeric(16,2)`, `credit_note_number text`, `credit_note_file_key text`.
- Cập nhật `db/schema.ts`: `reconcileStatusEnum` thêm 2 value; cột `recoveredVnd`, `creditNoteNumber`, `creditNoteFileKey`.

### 2. Parser thuần — `features/shipments/credit-note-parse.ts` (mới)
```ts
export interface CreditNoteLine { tracking: string; creditVnd: number }
export interface CreditNoteParsed { creditNoteNumber: string | null; lines: CreditNoteLine[] }
export function parseCreditNote(text: string, carrier: 'fedex' | 'dhl'): CreditNoteParsed
```
- Layout từ **mẫu thật** DHL/FedEx (lấy khi build parser, như mảng C). `creditVnd` = số tiền giảm (dương = số NCC hoàn).
- File CSV/XLSX → đọc text; PDF → `extractPdfText` rồi parse. (Định dạng cụ thể chốt theo mẫu.)
- Line thiếu tracking/số → bỏ (an toàn, không tạo recovered sai).

### 3. Matcher thuần — `features/shipments/credit-note-match.ts` (mới)
```ts
export interface DisputingRow { shipmentId: string; tracking: string; claimedVnd: number; recoveredVnd: number }
export interface CreditMatchResult {
  matched: { shipmentId: string; tracking: string; creditVnd: number; newRecovered: number; fullyRecovered: boolean }[];
  unmatched: { tracking: string; creditVnd: number; reason: string }[];
}
export function matchCreditToDisputing(lines: CreditNoteLine[], disputing: DisputingRow[]): CreditMatchResult
```
- Khớp `line.tracking` ↔ `disputing.tracking`. `newRecovered = recoveredVnd + creditVnd`. `fullyRecovered = newRecovered ≥ claimedVnd` (claimedVnd = |deltaVndAtReview|).
- Tracking không thuộc đơn `disputing` nào → `unmatched` (lý do "không phải đơn đang đòi").

### 4. Server actions — `features/shipments/claim-resolution-actions.ts` (mới)
```ts
applyCreditNote(input: { file: UploadFile }) -> CreditApplyResult   // parse + match + ghi DB
acceptDifference(input: { shipmentId: string }) -> void             // status 'accepted'
```
- `applyCreditNote`: xác định carrier theo account của các đơn đang đòi (hoặc đọc trong file); `parseCreditNote` → `matchCreditToDisputing` trên các đơn `disputing` hiện có; với mỗi matched: lưu file 1 lần (R2), set `recoveredVnd=newRecovered`, `creditNoteNumber`, `creditNoteFileKey`, và `status='credited'` nếu `fullyRecovered` (else giữ `disputing`). Trả `{ matched, unmatched, creditNoteNumber }`. Idempotent theo creditNoteNumber + tracking (đính lại cùng CN → không cộng dồn recovered 2 lần: set tuyệt đối, không `+=` ngoài tính trong matcher dựa recoveredVnd hiện tại — đọc recovered hiện tại trước khi tính).
- `acceptDifference`: set `status='accepted'`, giữ `recoveredVnd`. Quyền: như các action duyệt hiện có (`requireUser` + quyền reconcile).

> **Idempotency note:** matcher tính `newRecovered` từ `recoveredVnd` hiện tại trong DB; nếu cùng credit note + tracking áp lại, cần tránh cộng đôi. Giải pháp: nếu `creditNoteNumber` của đơn đã = CN đang áp thì coi như đã áp (bỏ qua). Chi tiết ở plan.

### 5. UI — `ReconcileIssuesModal` (mục "Đang đòi NCC")
- Nút **"Upload credit note"** → dialog: kéo file → gọi `applyCreditNote` (preview-rồi-xác nhận hoặc áp thẳng + bảng kết quả matched/unmatched). Sau áp → `router.refresh`.
- Mỗi dòng đang đòi: cột **"Đã thu hồi / Còn lại"** (recovered / claimed−recovered) + nút **"Chấp nhận chênh lệch"** → `acceptDifference`.
- Tổng mục: **Σ đang đòi** (claimed của `disputing` còn lại), **Σ đã thu hồi** (`credited` + phần recovered), **Σ chấp nhận chênh lệch** (`accepted`: claimed−recovered).
- Badge trạng thái mới trong `ReconcileTable`: `credited` (xanh lá "Đã thu hồi"), `accepted` (xám "Chấp nhận chênh lệch").

### 6. Report + CSV — `carrier-error-report.ts` + `carrier-errors.csv`
- `CarrierErrorRow`: thêm `recoveredVnd: number | null`, `creditNoteNumber: string | null`; `state` thêm `'credited' | 'accepted'`.
- Query đọc thêm `recovered_vnd`, `credit_note_number`. `summariseCarrierErrors` gom theo state mới + Σ recovered/accepted.
- CSV export thêm cột Đã thu hồi, Số credit note, Trạng thái.

## Lọc / hiển thị
- `reconcile-filter.ts`: status filter thêm `'credited'`, `'accepted'`; `effStatus` map giữ nguyên (credited/accepted là status thật, terminal). `reconcileSummary` không đổi (các đơn này không còn pending).

## Error handling / edge
- File credit note không đọc được / sai định dạng → `unmatched` rỗng + message; không đổi DB.
- Tracking trong CN không thuộc đơn đang đòi → `unmatched` (báo để kiểm tay), không tự tạo trạng thái mới.
- `acceptDifference` trên đơn không `disputing` → no-op/báo lỗi nhẹ.
- Áp lại đúng credit note đã áp → idempotent (không cộng đôi recovered).
- Recovered > claimed (NCC hoàn dư) → vẫn `credited`, recovered giữ số thực (report hiển thị đúng; không kẹp).

## Test
- `parseCreditNote`: fixture mẫu thật DHL/FedEx → lines đúng tracking/creditVnd + creditNoteNumber; rác → lines rỗng.
- `matchCreditToDisputing`: khớp đủ → fullyRecovered; khớp 1 phần → fullyRecovered=false; tracking lạ → unmatched; recovered cộng dồn đúng.
- Action/UI: integration → verify build + smoke.

## Ngoài phạm vi
- Registry credit note riêng (danh sách mọi CN).
- Credit note cho đơn KHÔNG đang `disputing` (chỉ khớp `disputing`).
- Tự động email/khiếu nại NCC; chỉ ghi nhận kết quả.
