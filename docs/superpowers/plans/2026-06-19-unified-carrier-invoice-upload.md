# Gộp upload hoá đơn carrier (Mảng A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Một nút duy nhất: kéo CSV (DHL) / XLSX (FedEx) → server-side parse → preview chỉ-đọc → Lưu + đối soát; nhiều file → batch. Bỏ hết ô nhập tay.

**Architecture:** Lớp điều phối server-side mới (`invoice-upload.ts`) route theo carrier+đuôi → tái dùng `parseDhlInvoiceCsv` / `previewFboBill` / `applyFboBill` / `createBill` / `reconcileDhlBill`, chuẩn hoá về `InvoicePreview`/`InvoiceImportResult`. Một dialog client `CarrierInvoiceDialog` thay `AddBillDialog`+`ImportFboDialog`.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle, Vitest.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-06-19-unified-carrier-invoice-upload-design.md`.
- **Không ô nhập tay** — dialog mới KHÔNG có `<input>` editable cho mã HĐ/số tiền/kỳ/ngày/ghi chú.
- **Parse server-side cả 2 carrier** (client chỉ upload file).
- Route: `dhl`+`.csv`→DHL; `fedex`+`.xlsx|.xls`→FBO; khác → `unsupported` (ok:false message, KHÔNG form tay).
- 1 file → preview chỉ-đọc → Lưu; nhiều file → batch + bảng kết quả.
- Idempotent: trùng `billNumber` → skip (`message:'Đã tồn tại — bỏ qua'`).
- Tái dùng `parseDhlInvoiceCsv`, `dhlShipmentToBillLine`, `createBill`, `reconcileDhlBill`, `previewFboBill`, `applyFboBill` — KHÔNG viết lại parser.
- Commands: `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files>`, `npm run build`. Commit body kết thúc `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure
- `features/carrier-rates/ap/invoice-upload.ts` (create) — `detectInvoiceFormat` (pure), `toInvoicePreview` (pure), `previewOneInvoice`/`importOneInvoice`/`importCarrierInvoices` (server orchestration), types `InvoicePreview`/`InvoiceImportResult`/`InvoiceCtx`.
- `features/carrier-rates/ap/invoice-upload.test.ts` (create) — test phần thuần.
- `components/carrier-rates/CarrierInvoiceDialog.tsx` (create) — dialog gộp.
- `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx` (modify) — thay 2 dialog bằng 1; thêm 2 action closure mỏng.
- (Xoá dùng) `AddBillDialog`/`ImportFboDialog` khỏi page (giữ file, chỉ bỏ import/dùng).

---

## Task 1: Pure helpers `detectInvoiceFormat` + `toInvoicePreview`

**Files:** Create `features/carrier-rates/ap/invoice-upload.ts` + `.test.ts`.

**Interfaces — Produces:**
```ts
export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'unsupported';
export function detectInvoiceFormat(carrierKey: string | null, filename: string): InvoiceFormat;
export interface InvoicePreview {
  carrier: 'fedex' | 'dhl'; billNumber: string | null; amount: number | null; currency: string;
  periodStart: string | null; periodEnd: string | null; issueDate: string | null; dueDate: string | null;
  lineCount: number; warnings: string[];
}
export function toInvoicePreview(src:
  | { kind: 'dhl'; p: { billNumber: string; amountInclVat: number; periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currency: string; shipments: unknown[] }; accountCurrency: string }
  | { kind: 'fbo'; b: { billNumber: string | null; periodStart: string | null; periodEnd: string | null; amount: number; lineCount: number }; accountCurrency: string }
): InvoicePreview;
```
> **Types thật (đã verify):** `FboBillSummary = { billNumber, periodStart, periodEnd, amount, lineCount }` — KHÔNG có `issueDate`/`dueDate` → với FedEx, `issueDate`/`dueDate` trong preview = `null`. `DhlInvoicePrefill` có `shipments`, `amountInclVat`, `issueDate`, `dueDate`, `currency`.

- [ ] **Step 1: Write failing test** `features/carrier-rates/ap/invoice-upload.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectInvoiceFormat, toInvoicePreview } from './invoice-upload';

describe('detectInvoiceFormat', () => {
  it('dhl + .csv → dhl_csv', () => { expect(detectInvoiceFormat('dhl', 'HANR1.csv')).toBe('dhl_csv'); });
  it('fedex + .xlsx/.xls → fbo_xlsx', () => {
    expect(detectInvoiceFormat('fedex', 'FedEx_x.XLSX')).toBe('fbo_xlsx');
    expect(detectInvoiceFormat('fedex', 'a.xls')).toBe('fbo_xlsx');
  });
  it('sai đuôi theo carrier → unsupported', () => {
    expect(detectInvoiceFormat('dhl', 'a.xlsx')).toBe('unsupported');   // DHL chỉ CSV
    expect(detectInvoiceFormat('fedex', 'a.csv')).toBe('unsupported');  // FedEx chỉ XLSX
    expect(detectInvoiceFormat('dhl', 'a.pdf')).toBe('unsupported');
    expect(detectInvoiceFormat(null, 'a.csv')).toBe('unsupported');
  });
});
describe('toInvoicePreview', () => {
  it('chuẩn hoá DHL; warning khi currency lệch account', () => {
    const pv = toInvoicePreview({ kind: 'dhl', accountCurrency: 'VND', p: {
      billNumber: 'HANR1', amountInclVat: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-05',
      issueDate: '2026-01-06', dueDate: '2026-02-05', currency: 'USD', shipments: [{}, {}] } });
    expect(pv).toMatchObject({ carrier: 'dhl', billNumber: 'HANR1', amount: 1000, lineCount: 2, dueDate: '2026-02-05' });
    expect(pv.warnings.some((w) => /currency|VND|USD/i.test(w))).toBe(true);
  });
  it('chuẩn hoá FBO (FedEx); issue/due = null (FboBillSummary không có)', () => {
    const pv = toInvoicePreview({ kind: 'fbo', accountCurrency: 'VND', b: {
      billNumber: 'FB9', periodStart: '2026-01-01', periodEnd: '2026-01-09', amount: 50000, lineCount: 7 } });
    expect(pv).toMatchObject({ carrier: 'fedex', billNumber: 'FB9', amount: 50000, lineCount: 7, currency: 'VND', warnings: [] });
    expect(pv.issueDate).toBeNull(); expect(pv.dueDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/carrier-rates/ap/invoice-upload.test.ts`.

- [ ] **Step 3: Implement (pure phần)** `features/carrier-rates/ap/invoice-upload.ts`:
```ts
export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'unsupported';

/** Nhận dạng định dạng theo carrier + đuôi file. DHL=CSV, FedEx=XLSX/XLS. */
export function detectInvoiceFormat(carrierKey: string | null, filename: string): InvoiceFormat {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (carrierKey === 'dhl' && ext === '.csv') return 'dhl_csv';
  if (carrierKey === 'fedex' && (ext === '.xlsx' || ext === '.xls')) return 'fbo_xlsx';
  return 'unsupported';
}

export interface InvoicePreview {
  carrier: 'fedex' | 'dhl'; billNumber: string | null; amount: number | null; currency: string;
  periodStart: string | null; periodEnd: string | null; issueDate: string | null; dueDate: string | null;
  lineCount: number; warnings: string[];
}

export function toInvoicePreview(src:
  | { kind: 'dhl'; p: { billNumber: string; amountInclVat: number; periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currency: string; shipments: unknown[] }; accountCurrency: string }
  | { kind: 'fbo'; b: { billNumber: string | null; periodStart: string | null; periodEnd: string | null; amount: number; lineCount: number }; accountCurrency: string },
): InvoicePreview {
  if (src.kind === 'dhl') {
    const { p, accountCurrency } = src;
    const warnings: string[] = [];
    if (p.currency && p.currency !== accountCurrency) warnings.push(`File là ${p.currency} nhưng tài khoản là ${accountCurrency} — kiểm tra lại số tiền.`);
    return {
      carrier: 'dhl', billNumber: p.billNumber || null, amount: p.amountInclVat || null, currency: accountCurrency,
      periodStart: p.periodStart || null, periodEnd: p.periodEnd || null, issueDate: p.issueDate || null, dueDate: p.dueDate || null,
      lineCount: p.shipments.length, warnings,
    };
  }
  const { b, accountCurrency } = src;
  return {
    carrier: 'fedex', billNumber: b.billNumber, amount: b.amount || null, currency: accountCurrency,
    periodStart: b.periodStart, periodEnd: b.periodEnd, issueDate: null, dueDate: null,
    lineCount: b.lineCount, warnings: [],
  };
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit && npx eslint features/carrier-rates/ap/invoice-upload.ts features/carrier-rates/ap/invoice-upload.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/carrier-rates/ap/invoice-upload.ts features/carrier-rates/ap/invoice-upload.test.ts
git commit -m "feat(carrier-ap): detectInvoiceFormat + toInvoicePreview (chuẩn hoá DHL/FBO)"
```

---

## Task 2: Server orchestration `previewOneInvoice` / `importCarrierInvoices`

**Files:** Modify `features/carrier-rates/ap/invoice-upload.ts`.

**Interfaces — Consumes:** `detectInvoiceFormat`, `toInvoicePreview` (T1); `parseDhlInvoiceCsv`, `dhlShipmentToBillLine` (`./dhl-invoice-csv`); `createBill` (`./bills-actions`); `reconcileDhlBill` (`./dhl-reconcile-actions`); `previewFboBill`, `applyFboBill` (`./fbo-import-actions`).
> **Verified types:** `previewFboBill(bytes): Promise<FboPreview>` với `FboPreview.bills: FboBillSummary[]` (mỗi summary có `lineCount`). `applyFboBill(input: ApplyFboInput): Promise<FboApplyResult>` (extends FboPreview: `.bills`, `.matchedAwb`, `.totalAwb`). `reconcileDhlBill(billId): Promise<{ freightLines, matched, unmatched[] }>`. `createBill(CreateBillInput): Promise<{id}>` (CreateBillInput: carrierAccountId, billNumber?, periodStart, periodEnd, issueDate?, dueDate?, amount, currency, note?, userId, file?, lines?). `parseDhlInvoiceCsv` THUẦN (gọi server-side ok).
- Produces:
  ```ts
  export interface InvoiceCtx { carrierKey: string | null; carrierAccountId: string; currency: string; userId: string }
  export interface InvoiceImportResult { filename: string; ok: boolean; billNumber: string | null; amount: number | null; matched: number | null; freight: number | null; message: string | null }
  export async function previewOneInvoice(ctx: InvoiceCtx, file: { bytes: Uint8Array; filename: string; contentType: string }): Promise<{ ok: true; preview: InvoicePreview } | { ok: false; message: string }>
  export async function importCarrierInvoices(ctx: InvoiceCtx, files: { bytes: Uint8Array; filename: string; contentType: string }[], existingBillNumbers: Set<string>): Promise<InvoiceImportResult[]>
  ```

- [ ] **Step 1: Implement** — thêm vào `invoice-upload.ts`:
```ts
import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from './dhl-invoice-csv';
import { createBill } from './bills-actions';
import { reconcileDhlBill } from './dhl-reconcile-actions';
import { previewFboBill, applyFboBill } from './fbo-import-actions';

export interface InvoiceCtx { carrierKey: string | null; carrierAccountId: string; currency: string; userId: string }
export interface InvoiceImportResult { filename: string; ok: boolean; billNumber: string | null; amount: number | null; matched: number | null; freight: number | null; message: string | null }

const td = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export async function previewOneInvoice(ctx: InvoiceCtx, file: { bytes: Uint8Array; filename: string; contentType: string }) {
  const fmt = detectInvoiceFormat(ctx.carrierKey, file.filename);
  if (fmt === 'dhl_csv') {
    const p = parseDhlInvoiceCsv(td(file.bytes));
    if (!p || !p.billNumber) return { ok: false as const, message: 'Không đúng định dạng hoá đơn DHL.' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'dhl', p, accountCurrency: ctx.currency }) };
  }
  if (fmt === 'fbo_xlsx') {
    const fbo = await previewFboBill(file.bytes);
    const b = fbo.bills[0];
    if (!b) return { ok: false as const, message: 'Không đúng định dạng hoá đơn FedEx (FBO).' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'fbo', b, accountCurrency: ctx.currency }) };
  }
  return { ok: false as const, message: `File không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}.` };
}

export async function importCarrierInvoices(ctx: InvoiceCtx, files: { bytes: Uint8Array; filename: string; contentType: string }[], existingBillNumbers: Set<string>): Promise<InvoiceImportResult[]> {
  const out: InvoiceImportResult[] = [];
  const seen = new Set(existingBillNumbers);
  for (const f of files) {
    const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
    const fmt = detectInvoiceFormat(ctx.carrierKey, f.filename);
    try {
      if (fmt === 'dhl_csv') {
        const p = parseDhlInvoiceCsv(td(f.bytes));
        if (!p || !p.billNumber) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn DHL' }); continue; }
        if (seen.has(p.billNumber)) { out.push({ ...base, billNumber: p.billNumber, message: 'Đã tồn tại — bỏ qua' }); continue; }
        const lines = p.shipments.map(dhlShipmentToBillLine);
        const { id: billId } = await createBill({ carrierAccountId: ctx.carrierAccountId, billNumber: p.billNumber, periodStart: p.periodStart, periodEnd: p.periodEnd, issueDate: p.issueDate, dueDate: p.dueDate, amount: p.amountInclVat, currency: ctx.currency, note: p.note, userId: ctx.userId, file: { bytes: f.bytes, filename: f.filename, contentType: 'text/csv' }, lines });
        seen.add(p.billNumber);
        const r = lines.length ? await reconcileDhlBill(billId) : null;
        out.push({ filename: f.filename, ok: true, billNumber: p.billNumber, amount: p.amountInclVat, matched: r?.matched ?? null, freight: r?.freightLines ?? null, message: null });
      } else if (fmt === 'fbo_xlsx') {
        const res = await applyFboBill({ carrierAccountId: ctx.carrierAccountId, currency: ctx.currency, userId: ctx.userId, bytes: f.bytes, filename: f.filename, contentType: f.contentType });
        const b = res.bills[0];
        if (b?.billNumber) seen.add(b.billNumber);
        out.push({ filename: f.filename, ok: true, billNumber: b?.billNumber ?? null, amount: b?.amount ?? null, matched: res.matchedAwb, freight: res.totalAwb, message: null });
      } else {
        out.push({ ...base, message: `Không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}` });
      }
    } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý file' }); }
  }
  return out;
}
```
> Lưu ý implementer: kiểm chữ ký thật của `createBill`/`applyFboBill`/`previewFboBill`/`reconcileDhlBill` và field `res.bills`/`matchedAwb`/`totalAwb`/`lines` (FboApplyResult extends FboPreview). Sửa cho khớp; mục tiêu: DHL→createBill+reconcileDhlBill, FedEx→applyFboBill, trả `InvoiceImportResult`.

- [ ] **Step 2: Verify** `npx tsc --noEmit && npx eslint features/carrier-rates/ap/invoice-upload.ts` (no DB run).

- [ ] **Step 3: Commit**
```bash
git add features/carrier-rates/ap/invoice-upload.ts
git commit -m "feat(carrier-ap): điều phối preview/import hoá đơn server-side (DHL+FedEx)"
```

---

## Task 3: Dialog gộp `CarrierInvoiceDialog`

**Files:** Create `components/carrier-rates/CarrierInvoiceDialog.tsx`.

**Interfaces — Consumes:** `InvoicePreview`, `InvoiceImportResult` (type, T1/T2).
- Produces: `export function CarrierInvoiceDialog(props: { carrierKey: 'fedex'|'dhl'; currency: string; previewAction: (fd: FormData) => Promise<{ ok: true; preview: InvoicePreview } | { ok: false; message: string }>; importAction: (fd: FormData) => Promise<InvoiceImportResult[]> })`

- [ ] **Step 1: Implement** — dialog `'use client'`:
  - Nút trigger "Thêm hoá đơn carrier".
  - Vùng kéo-thả/`<input type=file multiple>` (accept `.csv,.xlsx,.xls`). Label: "Kéo file hoá đơn (DHL CSV / FedEx XLSX) — 1 hoặc nhiều".
  - State: `files: File[]`, `preview`, `previewErr`, `results`, `busy` (useTransition).
  - **1 file:** gọi `previewAction(fd[file])` → nếu `ok` hiện **preview chỉ-đọc** (carrier, billNumber, amount+currency, period, issueDate, dueDate, lineCount, warnings) + nút **"Lưu"** → `importAction(fd[file])` → đóng/hiện kết quả. Nếu `!ok` → hiện `message` (KHÔNG form tay).
  - **Nhiều file:** bỏ preview; hiện danh sách tên file + nút **"Import hàng loạt"** → `importAction(fd[files])` → bảng kết quả từng file (ok/skip/lỗi + billNumber/amount/matched).
  - **KHÔNG** có `<input>` editable cho field hoá đơn.
  - `router.refresh()` sau import thành công.
  - (Code đầy đủ: mô phỏng cấu trúc `ImportFboDialog`/`AddBillDialog` hiện có — preview block read-only, không field nhập.)

- [ ] **Step 2: Verify** `npx tsc --noEmit && npx eslint components/carrier-rates/CarrierInvoiceDialog.tsx` (sẽ cần action types từ page — Task 4 nối; nếu tsc báo do page chưa nối, gộp verify ở Task 4).

- [ ] **Step 3: Commit**
```bash
git add components/carrier-rates/CarrierInvoiceDialog.tsx
git commit -m "feat(carrier-ap): CarrierInvoiceDialog gộp (preview chỉ-đọc + batch, không nhập tay)"
```

---

## Task 4: Nối vào trang bills (thay 2 dialog bằng 1)

**Files:** Modify `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx`.

**Interfaces — Consumes:** `previewOneInvoice`, `importCarrierInvoices` (T2); `CarrierInvoiceDialog` (T3).

- [ ] **Step 1:** Thêm 2 action closure `'use server'` trong page (auth `canAddInvoice` + revalidate `REV`):
```ts
async function previewInvoiceAction(formData: FormData) {
  'use server';
  if (!canAddInvoice) throw new Error('forbidden');
  const file = await fileFromForm(formData, 'file');
  if (!file) throw new Error('Chưa chọn file.');
  return previewOneInvoice({ carrierKey: account.carrierKey, carrierAccountId: id, currency, userId: session!.user.id }, file);
}
async function importInvoicesAction(formData: FormData) {
  'use server';
  if (!canAddInvoice) throw new Error('forbidden');
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const ups = await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type || 'application/octet-stream' })));
  const existing = new Set((await listBills(id)).map((b) => b.billNumber).filter(Boolean) as string[]);
  const res = await importCarrierInvoices({ carrierKey: account.carrierKey, carrierAccountId: id, currency, userId: session!.user.id }, ups, existing);
  REV.forEach((p) => revalidatePath(p));
  return res;
}
```
- [ ] **Step 2:** Thay JSX 2 dialog (dòng ~200-202) bằng:
```tsx
<CarrierInvoiceDialog carrierKey={account.carrierKey as 'fedex'|'dhl'} currency={currency} previewAction={previewInvoiceAction} importAction={importInvoicesAction} />
```
Xoá import + dùng `AddBillDialog`, `ImportFboDialog` (và các action cũ `createBillAction`/`importBatchAction`/`previewFboAction`/`applyFboAction` nếu không còn dùng — dọn để eslint sạch).

- [ ] **Step 3: Verify** `npx tsc --noEmit && npx eslint "app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx" components/carrier-rates/CarrierInvoiceDialog.tsx && npx vitest run features/carrier-rates && npm run build` → clean/pass.

- [ ] **Step 4: Commit**
```bash
git add "app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx"
git commit -m "feat(carrier-ap): trang bills dùng 1 nút CarrierInvoiceDialog (bỏ Import FBO riêng)"
```

---

## Task 5: Verify toàn bộ + PR
- [ ] `npx tsc --noEmit && npx vitest run && npm run build` → pass/clean.
- [ ] Xác nhận: không còn `<input>` nhập tay hoá đơn; DHL CSV + FedEx XLSX đều auto-parse; nhiều file → batch.
- [ ] PR.

## Self-Review notes
- Spec coverage: detect+normalize (T1), orchestration preview/import (T2), dialog gộp không nhập tay (T3), nối page bỏ 2 nút (T4), verify (T5).
- Naming: `detectInvoiceFormat`/`toInvoicePreview`/`InvoicePreview`/`previewOneInvoice`/`importCarrierInvoices`/`InvoiceImportResult`/`CarrierInvoiceDialog` nhất quán.
- Rủi ro: chữ ký `createBill`/`applyFboBill`/`previewFboBill` — implementer phải verify field thật (FboApplyResult extends FboPreview: `bills`, `matchedAwb`, `totalAwb`; FboBillSummary có `lines`, `issueDate`, `dueDate`). Ghi rõ ở T2.
- Idempotent + không-nhập-tay là ràng buộc chính (Global Constraints).
