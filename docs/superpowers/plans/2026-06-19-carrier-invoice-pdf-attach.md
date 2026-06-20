# Đính PDF hoá đơn carrier vào tracking/đơn (Mảng B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi upload PDF hoá đơn carrier, tự đính vào đúng bill (theo số HĐ) và hiển thị/cảnh báo ở cấp tracking/đơn — không nhập tay, không mất file nguồn CSV/XLSX.

**Architecture:** Thêm cột `pdf_*` riêng trên `carrier_bills` (không clobber `fileKey` nguồn). Gộp PDF vào luồng upload thống nhất `CarrierInvoiceDialog`/`importCarrierInvoices` (mảng A): spreadsheet xử lý trước → PDF khớp số HĐ sau → set `pdf_*`. Hiện link PDF bắc cầu `shipmentId → bill line → bill.pdfFileKey`, và badge "thiếu PDF" trên bảng bills.

**Tech Stack:** Next.js (App Router, server actions, route handlers), Drizzle ORM (migration tay `.sql` + journal), Vitest, R2 (`putObject`/`getSignedDownloadUrl`), `extractPdfText`/`compressPdf`/`matchInvoiceNumbers` (sẵn có).

## Global Constraints

- Migration **hand-authored**: thêm file `.sql` + entry trong `db/migrations/meta/_journal.json`; **KHÔNG** chạy `db:migrate` cục bộ (DATABASE_URL = PRODUCTION — chỉ apply khi deploy Railway). Không tạo snapshot json (các migration gần đây không có).
- PDF lưu ở cột **`pdf_*` riêng**; **KHÔNG đụng `fileKey`** (giữ nguyên CSV/XLSX nguồn).
- **Không ô nhập tay** nào; PDF khớp bill theo số hoá đơn đọc từ nội dung (`matchInvoiceNumbers`) — không theo tên file.
- Per-file error isolation trong batch (1 file lỗi không chặn file khác).
- Idempotent: re-attach PDF → ghi đè `pdf_*` (last-wins).
- Quyền: `canAddInvoice` cho import/attach; `view_carrier_rates` cho route tải.
- Tái dùng `extractPdfText`, `compressPdf`, `matchInvoiceNumbers`, `getSignedDownloadUrl` — không viết lại.
- Mọi thay đổi bill phải `revalidatePath` cả `/f/carrier-rates/[id]/bills` lẫn `/f/carrier-rates/[id]` (hằng `REV` sẵn trong page).

---

## Task 1: Nền — schema + migration + sửa attach + route tải PDF

**Files:**
- Create: `db/migrations/0069_carrier-bill-pdf.sql`
- Modify: `db/migrations/meta/_journal.json` (thêm entry idx 69)
- Modify: `db/schema.ts` (carrierBills: thêm 4 cột pdf)
- Modify: `features/carrier-rates/ap/bills-actions.ts` (`attachInvoicePdfsToBills` → set `pdf_*`; `BillRow`/`listBills` → `hasPdf`)
- Create: `app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/pdf/route.ts`

**Interfaces — Produces:**
- `carrierBills` columns: `pdfFileKey: text`, `pdfFilename: text`, `pdfContentType: text`, `pdfByteSize: integer` (đều nullable).
- `BillRow` thêm `hasPdf: boolean`.
- Route `GET /f/carrier-rates/[id]/bills/[billId]/pdf` → redirect 307 tới signed URL của `pdfFileKey`, 404 nếu null.

- [ ] **Step 1: Migration SQL** — tạo `db/migrations/0069_carrier-bill-pdf.sql`:
```sql
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_file_key" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_filename" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_content_type" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_byte_size" integer;
```

- [ ] **Step 2: Journal entry** — trong `db/migrations/meta/_journal.json`, thêm vào CUỐI mảng `entries` (sau entry idx 68), nhớ thêm dấu phẩy sau entry 68:
```json
    {
      "idx": 69,
      "version": "7",
      "when": 1782391200000,
      "tag": "0069_carrier-bill-pdf",
      "breakpoints": true
    }
```

- [ ] **Step 3: Schema** — trong `db/schema.ts`, trong `carrierBills = pgTable('carrier_bills', {...})`, ngay sau `byteSize: integer('byte_size'),` thêm:
```ts
  /** PDF hoá đơn carrier — cột RIÊNG, không ghi đè fileKey (file nguồn CSV/XLSX). */
  pdfFileKey: text('pdf_file_key'),
  pdfFilename: text('pdf_filename'),
  pdfContentType: text('pdf_content_type'),
  pdfByteSize: integer('pdf_byte_size'),
```

- [ ] **Step 4: Sửa attach** — trong `features/carrier-rates/ap/bills-actions.ts`, trong `attachInvoicePdfsToBills`, đổi khối `db.update(...).set({ fileKey, filename, contentType, byteSize })` thành (CHỈ đổi `.set`, giữ nguyên `fileKey` local var name vì đó là R2 key vừa tạo):
```ts
    for (const inv of invoices) {
      await db.update(schema.carrierBills)
        .set({ pdfFileKey: fileKey, pdfFilename: f.filename, pdfContentType: ct, pdfByteSize: stored.length })
        .where(eq(schema.carrierBills.id, byNumber.get(inv)!));
      attached.push({ invoice: inv, filename: f.filename });
    }
```

- [ ] **Step 5: BillRow.hasPdf** — trong cùng file, thêm `hasPdf: boolean;` vào interface `BillRow` (ngay sau `hasFile: boolean;`), và trong `listBills` map thêm `hasPdf: !!b.pdfFileKey,` (ngay sau `hasFile: !!b.fileKey,`).

- [ ] **Step 6: Route tải PDF** — tạo `app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/pdf/route.ts` (mirror route `/file` hiện có, đọc `pdfFileKey`):
```ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/** Stream a carrier bill's attached invoice PDF from object storage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; billId: string }> }) {
  const { billId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new NextResponse('Forbidden', { status: 403 });

  const [bill] = await db
    .select({ key: schema.carrierBills.pdfFileKey })
    .from(schema.carrierBills)
    .where(eq(schema.carrierBills.id, billId))
    .limit(1);
  if (!bill?.key) return new NextResponse('No invoice PDF', { status: 404 });

  const url = await getSignedDownloadUrl(bill.key, 300);
  return NextResponse.redirect(url, 307);
}
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit` (sạch) + `npx eslint features/carrier-rates/ap/bills-actions.ts "app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/pdf/route.ts" db/schema.ts` (sạch). KHÔNG chạy `db:migrate` (prod).

- [ ] **Step 8: Commit**
```bash
git add db/migrations/0069_carrier-bill-pdf.sql db/migrations/meta/_journal.json db/schema.ts features/carrier-rates/ap/bills-actions.ts "app/(dashboard)/f/carrier-rates/[id]/bills/[billId]/pdf/route.ts"
git commit -m "feat(carrier-ap): cột PDF riêng cho bill + route tải PDF (không clobber file nguồn)"
```

---

## Task 2: Server — nhận PDF trong luồng upload thống nhất

**Files:**
- Modify: `features/carrier-rates/ap/invoice-upload.ts`
- Modify: `features/carrier-rates/ap/invoice-upload.test.ts`

**Interfaces — Consumes:** `extractPdfText` (`@/features/carrier-rates/import/pdf-text`), `matchInvoiceNumbers` (`./match-invoice-pdf`), `compressPdf` (`@/lib/pdf/compress`), `putObject` (`@/lib/storage/s3`), `db`/`schema` (`@/db/client`), `randomUUID` (`crypto`).
- Produces:
  - `InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'invoice_pdf' | 'unsupported'`
  - `InvoicePreview` thêm field `format: InvoiceFormat`
  - `splitByPhase(files, carrierKey): { spreadsheets: T[]; pdfs: T[]; unsupported: T[] }` (thuần)
  - `importCarrierInvoices` xử lý PDF (đính vào bill khớp số HĐ, set `pdf_*`)
  - `previewOneInvoice` xử lý PDF (preview chỉ-đọc, liệt kê bill sẽ đính)

- [ ] **Step 1: Failing test** — thêm vào `features/carrier-rates/ap/invoice-upload.test.ts`:
```ts
import { detectInvoiceFormat, toInvoicePreview, fboPreviewFrom, splitByPhase } from './invoice-upload';

describe('detectInvoiceFormat — PDF', () => {
  it('.pdf (mọi carrier) → invoice_pdf', () => {
    expect(detectInvoiceFormat('fedex', 'PART_1.PDF')).toBe('invoice_pdf');
    expect(detectInvoiceFormat('dhl', 'hoadon.pdf')).toBe('invoice_pdf');
    expect(detectInvoiceFormat(null, 'x.pdf')).toBe('invoice_pdf');
  });
});

describe('InvoicePreview.format', () => {
  it('DHL preview gắn format dhl_csv', () => {
    const pv = toInvoicePreview({ kind: 'dhl', accountCurrency: 'VND', p: {
      billNumber: 'HANR1', amountInclVat: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-05',
      issueDate: '2026-01-06', dueDate: '2026-02-05', currency: 'VND', shipments: [{}] } });
    expect(pv.format).toBe('dhl_csv');
  });
  it('FBO preview gắn format fbo_xlsx', () => {
    const pv = fboPreviewFrom([{ billNumber: 'FB9', periodStart: null, periodEnd: null, amount: 1, lineCount: 1 }], 'VND');
    expect(pv.format).toBe('fbo_xlsx');
  });
});

describe('splitByPhase', () => {
  const f = (filename: string) => ({ filename });
  it('tách spreadsheet / pdf / unsupported theo carrier', () => {
    const r = splitByPhase([f('a.csv'), f('b.pdf'), f('c.xlsx'), f('d.txt')], 'dhl');
    expect(r.spreadsheets.map((x) => x.filename)).toEqual(['a.csv']);   // dhl: chỉ .csv là spreadsheet
    expect(r.pdfs.map((x) => x.filename)).toEqual(['b.pdf']);
    expect(r.unsupported.map((x) => x.filename)).toEqual(['c.xlsx', 'd.txt']); // .xlsx không hợp lệ cho dhl
  });
  it('fedex: .xlsx là spreadsheet, .csv unsupported', () => {
    const r = splitByPhase([f('a.csv'), f('b.xlsx'), f('c.pdf')], 'fedex');
    expect(r.spreadsheets.map((x) => x.filename)).toEqual(['b.xlsx']);
    expect(r.pdfs.map((x) => x.filename)).toEqual(['c.pdf']);
    expect(r.unsupported.map((x) => x.filename)).toEqual(['a.csv']);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/carrier-rates/ap/invoice-upload.test.ts`.

- [ ] **Step 3: detect + format type** — trong `features/carrier-rates/ap/invoice-upload.ts`:
  - Đổi `export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'unsupported';` → `export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'invoice_pdf' | 'unsupported';`
  - Trong `detectInvoiceFormat`, TRƯỚC dòng `return 'unsupported'` cuối, thêm: `if (ext === '.pdf') return 'invoice_pdf';`
  - Trong `interface InvoicePreview`, thêm field `format: InvoiceFormat;`.
  - Trong `toInvoicePreview`: nhánh DHL trả thêm `format: 'dhl_csv'`; nhánh FBO trả thêm `format: 'fbo_xlsx'`.
  - Trong `fboPreviewFrom`: object trả về (cả nhánh 1-bill qua `toInvoicePreview` đã có format; nhánh nhiều-bill) thêm `format: 'fbo_xlsx'`.

- [ ] **Step 4: splitByPhase** — thêm hàm thuần vào `invoice-upload.ts`:
```ts
/** Tách danh sách file theo PHA xử lý dựa trên carrier + đuôi: spreadsheet
 *  (dhl_csv/fbo_xlsx) xử lý TRƯỚC để bill tồn tại, pdf (invoice_pdf) SAU, còn
 *  lại unsupported. Thuần — không I/O. */
export function splitByPhase<T extends { filename: string }>(files: T[], carrierKey: string | null): { spreadsheets: T[]; pdfs: T[]; unsupported: T[] } {
  const spreadsheets: T[] = [], pdfs: T[] = [], unsupported: T[] = [];
  for (const f of files) {
    const fmt = detectInvoiceFormat(carrierKey, f.filename);
    if (fmt === 'dhl_csv' || fmt === 'fbo_xlsx') spreadsheets.push(f);
    else if (fmt === 'invoice_pdf') pdfs.push(f);
    else unsupported.push(f);
  }
  return { spreadsheets, pdfs, unsupported };
}
```

- [ ] **Step 5: Run → PASS** `npx vitest run features/carrier-rates/ap/invoice-upload.test.ts`.

- [ ] **Step 6: PDF trong importCarrierInvoices** — refactor để xử lý 2 pha. Thay thân vòng lặp hiện tại bằng: trước tiên `const { spreadsheets, pdfs, unsupported } = splitByPhase(files, ctx.carrierKey);` rồi xử lý `spreadsheets` (giữ NGUYÊN logic dhl_csv/fbo_xlsx hiện có), `unsupported` (push message "không đúng định dạng"), rồi `pdfs`. Thêm các import ở đầu file:
```ts
import { extractPdfText } from '@/features/carrier-rates/import/pdf-text';
import { matchInvoiceNumbers } from './match-invoice-pdf';
import { compressPdf } from '@/lib/pdf/compress';
import { putObject } from '@/lib/storage/s3';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
```
PDF branch (mỗi file trong `pdfs`, có try/catch per-file): build map số HĐ → billId của account (gồm bill vừa tạo trong pha spreadsheet — query lại từ DB theo `ctx.carrierAccountId`), khớp, set `pdf_*`:
```ts
// map billNumber -> billId cho account (đọc lại sau khi pha spreadsheet đã tạo bill)
const billRows = await db.select({ id: schema.carrierBills.id, billNumber: schema.carrierBills.billNumber })
  .from(schema.carrierBills).where(eq(schema.carrierBills.carrierAccountId, ctx.carrierAccountId));
const byNumber = new Map<string, string>();
for (const b of billRows) if (b.billNumber) byNumber.set(b.billNumber, b.id);
const known = new Set(byNumber.keys());
for (const f of pdfs) {
  const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
  try {
    let text: string;
    try { text = await extractPdfText(f.bytes); }
    catch { out.push({ ...base, message: 'Không đọc được PDF' }); continue; }
    const invoices = matchInvoiceNumbers(text, known);
    if (invoices.length === 0) { out.push({ ...base, message: 'Không khớp bill nào — import CSV/XLSX trước' }); continue; }
    const ct = f.contentType || 'application/pdf';
    const stored = await compressPdf(f.bytes);
    const fileKey = `carrier-bills/${ctx.carrierAccountId}/pdf-${randomUUID()}.pdf`;
    await putObject(fileKey, stored, ct);
    for (const inv of invoices) {
      await db.update(schema.carrierBills)
        .set({ pdfFileKey: fileKey, pdfFilename: f.filename, pdfContentType: ct, pdfByteSize: stored.length })
        .where(eq(schema.carrierBills.id, byNumber.get(inv)!));
    }
    out.push({ filename: f.filename, ok: true, billNumber: invoices.length === 1 ? invoices[0] : `${invoices.length} bill`, amount: null, matched: null, freight: null, message: `Đính PDF vào ${invoices.length} bill` });
  } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý PDF' }); }
}
```
> Lưu ý: giữ `out` và `seen` đúng phạm vi như bản hiện tại; chỉ đảm bảo spreadsheet chạy trước pdfs. Nếu code hiện tại lặp `for (const f of files)`, đổi thành lặp `spreadsheets` (cùng thân cũ), push unsupported, rồi đoạn pdfs ở trên.

- [ ] **Step 7: PDF trong previewOneInvoice** — thêm nhánh trước khi trả unsupported:
```ts
if (fmt === 'invoice_pdf') {
  let text: string;
  try { text = await extractPdfText(file.bytes); }
  catch { return { ok: false as const, message: 'Không đọc được PDF' }; }
  const billRows = await db.select({ billNumber: schema.carrierBills.billNumber })
    .from(schema.carrierBills).where(eq(schema.carrierBills.carrierAccountId, ctx.carrierAccountId));
  const known = new Set(billRows.map((b) => b.billNumber).filter((n): n is string => !!n));
  const invoices = matchInvoiceNumbers(text, known);
  const carrier = (ctx.carrierKey === 'fedex' ? 'fedex' : 'dhl') as 'fedex' | 'dhl';
  return { ok: true as const, preview: {
    carrier, format: 'invoice_pdf' as const, billNumber: null, amount: null, currency: ctx.currency,
    periodStart: null, periodEnd: null, issueDate: null, dueDate: null, lineCount: invoices.length,
    warnings: invoices.length ? [`PDF sẽ đính vào ${invoices.length} bill: ${invoices.join(', ')}`] : ['Không khớp bill nào — import CSV/XLSX trước'],
  } };
}
```

- [ ] **Step 8: Verify** — `npx vitest run features/carrier-rates/ap/invoice-upload.test.ts` (pass) + `npx tsc --noEmit` (sạch) + `npx eslint features/carrier-rates/ap/invoice-upload.ts features/carrier-rates/ap/invoice-upload.test.ts` (sạch).

- [ ] **Step 9: Commit**
```bash
git add features/carrier-rates/ap/invoice-upload.ts features/carrier-rates/ap/invoice-upload.test.ts
git commit -m "feat(carrier-ap): luồng upload nhận PDF — đính bill theo số HĐ (spreadsheet trước, PDF sau)"
```

---

## Task 3: Dialog — render PDF + bỏ AttachInvoicePdfDialog

**Files:**
- Modify: `components/carrier-rates/CarrierInvoiceDialog.tsx`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx`
- Delete: `components/carrier-rates/AttachInvoicePdfDialog.tsx` (nếu không còn nơi dùng)

**Interfaces — Consumes:** `InvoicePreview.format` (Task 2). Dialog props không đổi (`carrierKey`, `currency`, `previewAction`, `importAction`).

- [ ] **Step 1: accept .pdf** — trong `CarrierInvoiceDialog.tsx`, đảm bảo input file có `accept=".csv,.xlsx,.xls,.pdf"` (grep `accept=` trong file; nếu thiếu `.pdf` thì thêm). Cập nhật helper text nhắc "DHL CSV / FedEx XLSX / PDF hoá đơn".

- [ ] **Step 2: Render preview PDF** — trong khối render preview 1-file (khi `preview.ok`), phân nhánh theo `preview.format`: nếu `=== 'invoice_pdf'` hiện block PDF (icon + dòng "PDF hoá đơn" + các `warnings` — đã chứa danh sách bill sẽ đính); ngược lại giữ block spreadsheet hiện có (billNumber/amount/period/lineCount). Ví dụ chèn đầu khối preview:
```tsx
{preview.format === 'invoice_pdf' ? (
  <div className="space-y-1 text-sm">
    <div className="font-medium">PDF hoá đơn</div>
    {preview.warnings.map((w, i) => (
      <p key={i} className="text-muted-foreground">{w}</p>
    ))}
  </div>
) : (
  /* khối spreadsheet hiện có giữ nguyên */
)}
```
Nút "Lưu" vẫn gọi `importAction([file])` như cũ (không đổi).

- [ ] **Step 3: Bỏ AttachInvoicePdfDialog khỏi page** — trong `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx`: xoá dòng `{isFedex && <AttachInvoicePdfDialog attachAction={attachPdfsAction} />}`, xoá import `AttachInvoicePdfDialog`. Giữ `attachPdfsAction`? → KIỂM TRA: nếu sau khi xoá dialog mà `attachPdfsAction` không còn ai dùng và `attachInvoicePdfsToBills` cũng không nơi khác gọi, xoá luôn `attachPdfsAction` closure để eslint sạch. (PDF giờ đi qua `importInvoicesAction`.) Grep `attachPdfsAction` và `attachInvoicePdfsToBills` để xác nhận trước khi xoá.

- [ ] **Step 4: Xoá file dialog cũ** — `grep -rn "AttachInvoicePdfDialog" --include=*.ts --include=*.tsx .`; nếu chỉ còn định nghĩa của chính nó → `git rm components/carrier-rates/AttachInvoicePdfDialog.tsx`. Nếu còn nơi khác dùng → KHÔNG xoá, báo lại.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (sạch) + `npx eslint components/carrier-rates/CarrierInvoiceDialog.tsx "app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx"` (sạch) + `npm run build` (thành công — bắt mọi tham chiếu treo do xoá file).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(carrier-ap): CarrierInvoiceDialog render PDF + bỏ nút Đính PDF riêng"
```

---

## Task 4: Bảng bills — badge "thiếu PDF" + link tải PDF

**Files:**
- Modify: `components/carrier-rates/BillsBoard.tsx`
- Modify: `components/carrier-rates/InvoiceDetailModal.tsx`

**Interfaces — Consumes:** `BillRow.hasPdf` (Task 1). Bill object trong board/modal đã mang `hasPdf` (cùng nguồn `listBills`).

> Nếu `BillsBoard`/`InvoiceDetailModal` nhận bill qua type riêng (không phải `BillRow`), thêm `hasPdf: boolean` vào type đó và đảm bảo nơi tạo prop truyền `b.hasPdf`. Grep `hasFile` trong 2 file để thấy chính xác nơi cần mirror.

- [ ] **Step 1: BillsBoard — badge + link PDF** — trong `components/carrier-rates/BillsBoard.tsx`, ngay sau khối `{b.hasFile && (<a href={.../file} ...><FileText/></a>)}` thêm:
```tsx
{b.hasPdf ? (
  <a
    href={`/f/carrier-rates/${accountId}/bills/${b.id}/pdf`}
    target="_blank" rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()}
    className="text-muted-foreground hover:text-foreground" title="Mở PDF hoá đơn"
  >
    <FileText className="size-4" />
  </a>
) : (
  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Chưa đính PDF hoá đơn">⚠ chưa có PDF</span>
)}
```
(Dùng icon khác file gốc cho dễ phân biệt nếu muốn — `FileText` đã import sẵn; nếu thêm icon mới nhớ import từ `lucide-react`.)

- [ ] **Step 2: Đếm thiếu PDF** — trong `BillsBoard.tsx`, nơi render header/tổng (grep `hoá đơn` hoặc nơi đếm bills), thêm hiển thị số bill thiếu PDF:
```tsx
{(() => { const miss = bills.filter((b) => !b.hasPdf).length; return miss > 0 ? (
  <span className="text-amber-600 dark:text-amber-400"> · {miss} bill chưa có PDF</span>
) : null; })()}
```
(Đặt cạnh dòng tổng số bill. `bills` là prop danh sách hiện có trong component — dùng đúng tên biến danh sách bill của file.)

- [ ] **Step 3: InvoiceDetailModal — link PDF** — trong `components/carrier-rates/InvoiceDetailModal.tsx`, cạnh khối `{bill.hasFile && (<a href={.../file}>…</a>)}` thêm link PDF tương tự (href `.../bills/${bill.id}/pdf`, title "Mở PDF hoá đơn") khi `bill.hasPdf`, và badge "⚠ chưa có PDF" khi không.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (sạch) + `npx eslint components/carrier-rates/BillsBoard.tsx components/carrier-rates/InvoiceDetailModal.tsx` (sạch).

- [ ] **Step 5: Commit**
```bash
git add components/carrier-rates/BillsBoard.tsx components/carrier-rates/InvoiceDetailModal.tsx
git commit -m "feat(carrier-ap): bảng bills hiện link PDF + cảnh báo bill chưa có PDF"
```

---

## Task 5: Đối soát — link PDF theo tracking (bắc cầu shipment→bill)

**Files:**
- Modify: `app/(dashboard)/f/carrier-rates/.../reconcile` page (trang đối soát — grep để xác định) HOẶC `features/shipments/reconcile-view.ts`
- Modify: `components/shipping-reconcile/ReconcileTable.tsx`
- Test: `features/shipments/reconcile-pdf-link.test.ts` (nếu tách hàm thuần)

**Interfaces — Consumes:** `carrierBills.pdfFileKey`, `carrierBillLines.shipmentId` (Task 1 / schema sẵn).
- Produces: map `pdfBillIdByShipment: Record<string, string>` truyền xuống `ReconcileTable`; mỗi row có `shipmentId` → tra map → link `/f/carrier-rates/<accountId>/bills/<pdfBillId>/pdf`.

> **Cách làm (tránh đụng engine cache nặng):** tính map ở TẦNG TRANG đối soát trên tập `pageRows` (đã phân trang server, ~100 dòng), KHÔNG nhét vào engine compute đã cache. Query: lấy `carrier_bill_lines` có `shipmentId IN (pageRows.shipmentId)` JOIN `carrier_bills` có `pdfFileKey != null` → map shipmentId → billId. Cần biết `accountId` để dựng href (reconcile có thể đa carrier account — billId đủ để route, nhưng route cần `[id]` = carrierAccountId; lấy từ `carrier_bills.carrierAccountId`). Vậy map giá trị là `{ accountId, billId }`.

- [ ] **Step 1: Tìm trang đối soát + cách truyền pageRows** — `grep -rln "ReconcileTable" app/` để tìm page; đọc nơi tạo `pageRows`/`safePage` (từ mảng #189). Xác định `shipmentId` có trong row (`ReconcileViewRow.shipmentId` — có).

- [ ] **Step 2: Hàm query map (server)** — tạo trong `features/shipments/reconcile-view.ts` (hoặc cùng module page):
```ts
import { inArray, isNotNull, and } from 'drizzle-orm';
/** shipmentId -> bill có PDF (để hiện link PDF theo tracking ở đối soát). */
export async function pdfBillByShipment(shipmentIds: string[]): Promise<Record<string, { accountId: string; billId: string }>> {
  if (shipmentIds.length === 0) return {};
  const rows = await db
    .select({ shipmentId: schema.carrierBillLines.shipmentId, billId: schema.carrierBills.id, accountId: schema.carrierBills.carrierAccountId })
    .from(schema.carrierBillLines)
    .innerJoin(schema.carrierBills, eq(schema.carrierBillLines.billId, schema.carrierBills.id))
    .where(and(inArray(schema.carrierBillLines.shipmentId, shipmentIds), isNotNull(schema.carrierBills.pdfFileKey)));
  const out: Record<string, { accountId: string; billId: string }> = {};
  for (const r of rows) if (r.shipmentId) out[r.shipmentId] = { accountId: r.accountId, billId: r.billId };
  return out;
}
```
(Bảo đảm `db`, `schema`, `eq` đã import trong file.)

- [ ] **Step 3: Page truyền map** — trong trang đối soát, sau khi có `pageRows`: `const pdfMap = await pdfBillByShipment(pageRows.map((r) => r.shipmentId));` rồi truyền prop `pdfMap={pdfMap}` xuống `ReconcileTable`.

- [ ] **Step 4: ReconcileTable nhận + hiện link** — thêm prop `pdfMap: Record<string, { accountId: string; billId: string }>` (mặc định `{}`). Trong panel chi tiết (expand) của 1 row, nơi hiện thông tin tracking, thêm:
```tsx
{pdfMap[row.shipmentId] && (
  <a
    href={`/f/carrier-rates/${pdfMap[row.shipmentId].accountId}/bills/${pdfMap[row.shipmentId].billId}/pdf`}
    target="_blank" rel="noopener noreferrer"
    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
  >
    Hoá đơn PDF
  </a>
)}
```
(`row` = biến row trong vòng render panel; dùng đúng tên biến của file.)

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (sạch) + `npx eslint <các file đã sửa>` (sạch) + `npm run build` (thành công).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(reconcile): hiện link PDF hoá đơn theo tracking (bắc cầu shipment→bill)"
```

---

## Task 6: Verify toàn nhánh + PR

- [ ] **Step 1:** `npx tsc --noEmit` (sạch).
- [ ] **Step 2:** `npx vitest run` (toàn bộ pass — báo số).
- [ ] **Step 3:** `npm run build` (thành công).
- [ ] **Step 4:** Final whole-branch review (subagent-driven sẽ tự chạy).
- [ ] **Step 5:** Push + tạo PR base `main`, body có Summary + Test Plan (gồm: kéo PDF + CSV/XLSX cùng lúc → bill có cả file nguồn lẫn PDF; tracking ở đối soát hiện nút "Hoá đơn PDF"; bill thiếu PDF có badge cảnh báo; migration 0069 apply khi deploy).

---

## Self-review notes
- Spec Việc 1 (cột PDF + attach + route) → Task 1. Việc 2 (PDF vào dialog) → Task 2 (server) + Task 3 (UI). Việc 3 (link + cảnh báo) → Task 4 (bills badge) + Task 5 (reconcile link). Verify+PR → Task 6.
- Type nhất quán: `InvoiceFormat` thêm `'invoice_pdf'` (Task 2) — dùng ở `splitByPhase`/`previewOneInvoice`/dialog. `InvoicePreview.format` (Task 2) — dùng ở Task 3 render. `BillRow.hasPdf` (Task 1) — dùng ở Task 4. `pdfFileKey` (Task 1) — dùng ở Task 1 route, Task 2 set, Task 5 query.
- Migration KHÔNG chạy cục bộ (prod) — chỉ tạo file; apply khi deploy.
