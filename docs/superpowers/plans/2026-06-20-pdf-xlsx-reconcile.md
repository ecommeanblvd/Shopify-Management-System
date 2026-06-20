# Đối soát PDF ↔ XLSX hoá đơn carrier (Mảng C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi đính PDF hoá đơn, đọc tổng tiền + ngày từ PDF, lưu lên bill, và hiện badge "PDF khớp / lệch / chưa đọc được" so với số liệu XLSX/CSV (bill.amount + ngày).

**Architecture:** 2 hàm thuần (parser PDF per-carrier + comparator), 3 cột mới trên `carrier_bills`, capture lúc upload trong `importCarrierInvoices` (nhánh PDF của mảng B), badge bill-level ở `BillsBoard`/`InvoiceDetailModal`.

**Tech Stack:** Next.js (server actions, RSC), Drizzle (migration tay + journal), Vitest, regex parse text `pdftotext -layout` (sẵn có ở mảng B).

## Global Constraints

- Mức đối soát: **Tổng + ngày** (KHÔNG so từng phí/AWB).
- Parser **thuần** (no I/O); parse fail/thiếu total → entry **vắng** (không emit `total: 0`); UI hiện `unknown` "chưa đọc được tổng" — **không bao giờ báo "lệch" sai**.
- FedEx `Invoice No.` dùng regex `\d{6,}` (tránh bắt nhầm `VAT Invoice No.: 1K25TFA-00006666`).
- So sánh **either-side null → `unknown`** (FBO bill có thể `issueDate` null) — date `unknown` KHÔNG chặn `overall: match`.
- Tolerance số tiền: `PDF_MATCH_TOLERANCE_VND = 1000`.
- Migration **tay** (`.sql` + journal entry); **KHÔNG** chạy `db:migrate` cục bộ (DATABASE_URL = PRODUCTION; apply khi deploy).
- Tái dùng `extractPdfText`, `matchInvoiceNumbers` (mảng B) — không viết lại.
- Mọi field tiền (numeric) đọc từ DB qua `Number(...)`.

---

## Task 1: Parser thuần `parsePdfInvoiceTotals`

**Files:**
- Create: `features/carrier-rates/ap/pdf-invoice-totals.ts`
- Test: `features/carrier-rates/ap/pdf-invoice-totals.test.ts`

**Interfaces — Produces:**
```ts
export interface PdfInvoiceTotals { total: number; issueDate: string | null; dueDate: string | null }
export function parsePdfInvoiceTotals(text: string, carrier: 'fedex' | 'dhl'): Record<string, PdfInvoiceTotals>
```

- [ ] **Step 1: Failing test** — `features/carrier-rates/ap/pdf-invoice-totals.test.ts` (fixture trích từ mẫu PDF thật):
```ts
import { describe, it, expect } from 'vitest';
import { parsePdfInvoiceTotals } from './pdf-invoice-totals';

const FEDEX = `
FREIGHT INVOICE SUMMARY
ANH NGUYEN                                                       Invoice No.:                 734005869
CÔNG TY CỔ PHẦN INESCO                                           Invoice Date:                28 Jul 2025
                                                                 VAT Invoice No.:             1K25TFA-00006666
International Services                          Total (VND)
Express Charges                                132,509,041
Grand Total (VAT included)                     132,509,041
Your payment is due by 17 Aug 2025
Ngày đến hạn thanh toán 17 Aug 2025
`;

const DHL = `
                                       Invoice no.                                     HANR000269158
                                       Date                                               13/05/2026
DATE                 ORG             HAWB NO          DEST          PIECE       WEIGHT
21/04/2026           SGN         2154097234            FYV               1       2.00            605,447
TOTAL FOR SHIPMENT                                  17      39.00          32,126,727       2,570,138    34,696,865
                                                   Total VND                              34,696,865
`;

describe('parsePdfInvoiceTotals — FedEx', () => {
  it('đọc Invoice No. (9 số, KHÔNG bắt VAT Invoice No.), Grand Total, ngày', () => {
    const r = parsePdfInvoiceTotals(FEDEX, 'fedex');
    expect(r['734005869']).toEqual({ total: 132509041, issueDate: '2025-07-28', dueDate: '2025-08-17' });
    expect(r['00006666']).toBeUndefined();
    expect(r['1']).toBeUndefined();
  });
});

describe('parsePdfInvoiceTotals — DHL', () => {
  it('đọc HANR, Total VND, Date (dd/mm/yyyy), dueDate null', () => {
    const r = parsePdfInvoiceTotals(DHL, 'dhl');
    expect(r['HANR000269158']).toEqual({ total: 34696865, issueDate: '2026-05-13', dueDate: null });
  });
});

describe('parsePdfInvoiceTotals — fail an toàn', () => {
  it('block thiếu total → entry vắng (không total:0)', () => {
    const r = parsePdfInvoiceTotals('Invoice No.:   999999999\nInvoice Date: 01 Jan 2025\n', 'fedex');
    expect(r['999999999']).toBeUndefined();
  });
  it('text rác → map rỗng', () => {
    expect(parsePdfInvoiceTotals('blah blah', 'fedex')).toEqual({});
    expect(parsePdfInvoiceTotals('blah blah', 'dhl')).toEqual({});
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/carrier-rates/ap/pdf-invoice-totals.test.ts`.

- [ ] **Step 3: Implement** — `features/carrier-rates/ap/pdf-invoice-totals.ts`:
```ts
/**
 * Đọc tổng tiền + ngày từ text PDF hoá đơn (pdftotext -layout) theo carrier.
 * Map số hoá đơn → {total, issueDate, dueDate}. Block thiếu total → BỎ (không
 * emit total:0). THUẦN — không I/O. Layout lấy từ mẫu thật FedEx/DHL.
 */
export interface PdfInvoiceTotals { total: number; issueDate: string | null; dueDate: string | null }

const EN_MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
const numFrom = (s: string): number => Number(s.replace(/,/g, ''));
/** "28 Jul 2025" → "2025-07-28" */
function enDateToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2}) (\w{3}) (\d{4})$/);
  if (!m) return null;
  const mm = EN_MONTHS[m[2]];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null;
}
/** "13/05/2026" → "2026-05-13" */
function dmyToIso(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Cắt text thành đoạn theo từng mỏ neo (vị trí số HĐ); đoạn i = [idx_i, idx_{i+1}). */
function segmentsByAnchor(text: string, re: RegExp): { num: string; seg: string }[] {
  const marks: { num: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(text)) !== null) marks.push({ num: m[1], idx: m.index });
  return marks.map((mk, i) => ({
    num: mk.num,
    seg: text.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : undefined),
  }));
}

function parseFedex(text: string): Record<string, PdfInvoiceTotals> {
  const out: Record<string, PdfInvoiceTotals> = {};
  for (const { num, seg } of segmentsByAnchor(text, /Invoice No\.:\s+(\d{6,})/)) {
    const total = seg.match(/Grand Total \(VAT included\)\s+([\d,]+)/);
    if (!total) continue; // không có tổng trong block → bỏ
    const issue = seg.match(/Invoice Date:\s+(\d{1,2} \w{3} \d{4})/);
    const due = seg.match(/due by (\d{1,2} \w{3} \d{4})/);
    out[num] = { total: numFrom(total[1]), issueDate: issue ? enDateToIso(issue[1]) : null, dueDate: due ? enDateToIso(due[1]) : null };
  }
  return out;
}

function parseDhl(text: string): Record<string, PdfInvoiceTotals> {
  const out: Record<string, PdfInvoiceTotals> = {};
  for (const { num, seg } of segmentsByAnchor(text, /Invoice no\.\s+(HANR\d+)/)) {
    const total = seg.match(/Total VND\s+([\d,]+)/);
    if (!total) continue;
    const date = seg.match(/\bDate\s+(\d{2}\/\d{2}\/\d{4})/);
    out[num] = { total: numFrom(total[1]), issueDate: date ? dmyToIso(date[1]) : null, dueDate: null };
  }
  return out;
}

export function parsePdfInvoiceTotals(text: string, carrier: 'fedex' | 'dhl'): Record<string, PdfInvoiceTotals> {
  return carrier === 'fedex' ? parseFedex(text) : parseDhl(text);
}
```

- [ ] **Step 4: Run → PASS** `npx vitest run features/carrier-rates/ap/pdf-invoice-totals.test.ts` + `npx tsc --noEmit` + `npx eslint features/carrier-rates/ap/pdf-invoice-totals.ts features/carrier-rates/ap/pdf-invoice-totals.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/carrier-rates/ap/pdf-invoice-totals.ts features/carrier-rates/ap/pdf-invoice-totals.test.ts
git commit -m "feat(carrier-ap): parser PDF đọc tổng+ngày hoá đơn FedEx/DHL (thuần)"
```

---

## Task 2: Comparator thuần `comparePdfToBill`

**Files:**
- Create: `features/carrier-rates/ap/compare-pdf-bill.ts`
- Test: `features/carrier-rates/ap/compare-pdf-bill.test.ts`

**Interfaces — Produces:**
```ts
export type PdfCmpStatus = 'match' | 'mismatch' | 'unknown';
export interface PdfBillCompare { amountStatus: PdfCmpStatus; amountDeltaVnd: number | null; issueDateStatus: PdfCmpStatus; dueDateStatus: PdfCmpStatus; overall: PdfCmpStatus }
export const PDF_MATCH_TOLERANCE_VND = 1000;
export function comparePdfToBill(
  bill: { amount: number; issueDate: string | null; dueDate: string | null },
  pdf: { pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null },
): PdfBillCompare
```

- [ ] **Step 1: Failing test** — `features/carrier-rates/ap/compare-pdf-bill.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { comparePdfToBill } from './compare-pdf-bill';

const bill = { amount: 132509041, issueDate: '2025-07-28', dueDate: '2025-08-17' };

describe('comparePdfToBill', () => {
  it('khớp khi tổng = nhau, ngày = nhau', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 132509041, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r).toEqual({ amountStatus: 'match', amountDeltaVnd: 0, issueDateStatus: 'match', dueDateStatus: 'match', overall: 'match' });
  });
  it('lệch ≤ tolerance vẫn match', () => {
    expect(comparePdfToBill(bill, { pdfAmount: 132509041 - 800, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' }).amountStatus).toBe('match');
  });
  it('lệch tiền > tolerance → mismatch + overall mismatch', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 130000000, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r.amountStatus).toBe('mismatch');
    expect(r.amountDeltaVnd).toBe(2509041);
    expect(r.overall).toBe('mismatch');
  });
  it('lệch ngày HĐ → overall mismatch dù tiền khớp', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 132509041, pdfIssueDate: '2025-07-29', pdfDueDate: '2025-08-17' });
    expect(r.issueDateStatus).toBe('mismatch');
    expect(r.overall).toBe('mismatch');
  });
  it('pdfAmount null → unknown (chưa đọc được tổng)', () => {
    const r = comparePdfToBill(bill, { pdfAmount: null, pdfIssueDate: null, pdfDueDate: null });
    expect(r.amountStatus).toBe('unknown');
    expect(r.amountDeltaVnd).toBeNull();
    expect(r.overall).toBe('unknown');
  });
  it('DHL: dueDate phía PDF null → dueDateStatus unknown, overall match nếu tiền+ngày HĐ khớp', () => {
    const r = comparePdfToBill({ amount: 34696865, issueDate: '2026-05-13', dueDate: '2026-06-12' }, { pdfAmount: 34696865, pdfIssueDate: '2026-05-13', pdfDueDate: null });
    expect(r.dueDateStatus).toBe('unknown');
    expect(r.overall).toBe('match');
  });
  it('bill.issueDate null (FBO) + pdf có ngày → issueDate unknown, không mismatch', () => {
    const r = comparePdfToBill({ amount: 132509041, issueDate: null, dueDate: null }, { pdfAmount: 132509041, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r.issueDateStatus).toBe('unknown');
    expect(r.overall).toBe('match');
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/carrier-rates/ap/compare-pdf-bill.test.ts`.

- [ ] **Step 3: Implement** — `features/carrier-rates/ap/compare-pdf-bill.ts`:
```ts
/** So tổng tiền + ngày của bill (từ XLSX/CSV) với số liệu đọc từ PDF. THUẦN.
 *  either-side null → unknown (không báo lệch sai). date unknown KHÔNG chặn match. */
export type PdfCmpStatus = 'match' | 'mismatch' | 'unknown';
export interface PdfBillCompare {
  amountStatus: PdfCmpStatus; amountDeltaVnd: number | null;
  issueDateStatus: PdfCmpStatus; dueDateStatus: PdfCmpStatus;
  overall: PdfCmpStatus;
}
export const PDF_MATCH_TOLERANCE_VND = 1000;

function dateStatus(billDate: string | null, pdfDate: string | null): PdfCmpStatus {
  if (!billDate || !pdfDate) return 'unknown';
  return billDate === pdfDate ? 'match' : 'mismatch';
}

export function comparePdfToBill(
  bill: { amount: number; issueDate: string | null; dueDate: string | null },
  pdf: { pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null },
): PdfBillCompare {
  let amountStatus: PdfCmpStatus = 'unknown';
  let amountDeltaVnd: number | null = null;
  if (pdf.pdfAmount !== null) {
    amountDeltaVnd = bill.amount - pdf.pdfAmount;
    amountStatus = Math.abs(amountDeltaVnd) <= PDF_MATCH_TOLERANCE_VND ? 'match' : 'mismatch';
  }
  const issueDateStatus = dateStatus(bill.issueDate, pdf.pdfIssueDate);
  const dueDateStatus = dateStatus(bill.dueDate, pdf.pdfDueDate);
  let overall: PdfCmpStatus;
  if (amountStatus === 'unknown') overall = 'unknown';
  else if (amountStatus === 'mismatch' || issueDateStatus === 'mismatch' || dueDateStatus === 'mismatch') overall = 'mismatch';
  else overall = 'match';
  return { amountStatus, amountDeltaVnd, issueDateStatus, dueDateStatus, overall };
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npx eslint features/carrier-rates/ap/compare-pdf-bill.ts features/carrier-rates/ap/compare-pdf-bill.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/carrier-rates/ap/compare-pdf-bill.ts features/carrier-rates/ap/compare-pdf-bill.test.ts
git commit -m "feat(carrier-ap): comparator PDF↔bill (tổng+ngày, tolerance 1000, fail→unknown)"
```

---

## Task 3: Schema — 3 cột PDF totals + `BillRow`

**Files:**
- Create: `db/migrations/0070_carrier-bill-pdf-totals.sql`
- Modify: `db/migrations/meta/_journal.json` (entry idx 70)
- Modify: `db/schema.ts` (carrierBills: 3 cột)
- Modify: `features/carrier-rates/ap/bills-actions.ts` (`BillRow` + `listBills`)

**Interfaces — Produces:** `carrierBills.pdfAmount` (numeric), `pdfIssueDate` (date), `pdfDueDate` (date). `BillRow` thêm `pdfAmount: number|null`, `pdfIssueDate: string|null`, `pdfDueDate: string|null`.

- [ ] **Step 1: Migration SQL** — `db/migrations/0070_carrier-bill-pdf-totals.sql`:
```sql
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_amount" numeric(14, 2);
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_issue_date" date;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_due_date" date;
```

- [ ] **Step 2: Journal entry** — thêm vào CUỐI mảng `entries` trong `db/migrations/meta/_journal.json` (thêm dấu phẩy sau entry idx 69):
```json
    {
      "idx": 70,
      "version": "7",
      "when": 1782477600000,
      "tag": "0070_carrier-bill-pdf-totals",
      "breakpoints": true
    }
```

- [ ] **Step 3: Schema** — trong `db/schema.ts`, `carrierBills`, ngay sau `pdfByteSize: integer('pdf_byte_size'),` thêm:
```ts
  /** Tổng tiền + ngày đọc từ PDF hoá đơn (mảng C) — để đối soát với amount/issueDate/dueDate (từ XLSX). */
  pdfAmount: numeric('pdf_amount', { precision: 14, scale: 2 }),
  pdfIssueDate: date('pdf_issue_date'),
  pdfDueDate: date('pdf_due_date'),
```

- [ ] **Step 4: BillRow + listBills** — trong `features/carrier-rates/ap/bills-actions.ts`:
  - `BillRow` thêm (sau `hasPdf: boolean;`): `pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null;`
  - `listBills` map thêm (sau `hasPdf: !!b.pdfFileKey,`):
```ts
    pdfAmount: b.pdfAmount !== null ? Number(b.pdfAmount) : null,
    pdfIssueDate: b.pdfIssueDate,
    pdfDueDate: b.pdfDueDate,
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` + `npx eslint db/schema.ts features/carrier-rates/ap/bills-actions.ts`. KHÔNG chạy db:migrate.

- [ ] **Step 6: Commit**
```bash
git add db/migrations/0070_carrier-bill-pdf-totals.sql db/migrations/meta/_journal.json db/schema.ts features/carrier-rates/ap/bills-actions.ts
git commit -m "feat(carrier-ap): cột pdf_amount/issue/due trên bill + BillRow"
```

---

## Task 4: Capture totals lúc upload PDF

**Files:**
- Modify: `features/carrier-rates/ap/invoice-upload.ts` (nhánh `if (pdfs.length > 0)`)

**Interfaces — Consumes:** `parsePdfInvoiceTotals` (Task 1); `carrierBills.pdfAmount/pdfIssueDate/pdfDueDate` (Task 3).

- [ ] **Step 1: Import + parse + set** — trong `features/carrier-rates/ap/invoice-upload.ts`:
  - Thêm import: `import { parsePdfInvoiceTotals } from './pdf-invoice-totals';`
  - Trong nhánh PDF, SAU `const invoices = matchInvoiceNumbers(text, known);` (và sau khi đã loại trường hợp `invoices.length === 0`), thêm:
```ts
        const carrier = ctx.carrierKey === 'fedex' ? 'fedex' : 'dhl';
        const totals = parsePdfInvoiceTotals(text, carrier);
```
  - Đổi vòng `for (const inv of invoices)` để set thêm pdf totals theo từng số HĐ:
```ts
        for (const inv of invoices) {
          const t = totals[inv];
          await db.update(schema.carrierBills)
            .set({
              pdfFileKey: fileKey, pdfFilename: f.filename, pdfContentType: ct, pdfByteSize: stored.length,
              pdfAmount: t ? String(t.total) : null,
              pdfIssueDate: t?.issueDate ?? null,
              pdfDueDate: t?.dueDate ?? null,
            })
            .where(eq(schema.carrierBills.id, byNumber.get(inv)!));
        }
```
  (Giữ nguyên phần `out.push(... 'Đính PDF vào N bill')` phía dưới.)

- [ ] **Step 2: Verify** — `npx tsc --noEmit` + `npx eslint features/carrier-rates/ap/invoice-upload.ts` + `npm run build`. (Không unit test — I/O orchestration; parser/comparator đã test riêng.)

- [ ] **Step 3: Commit**
```bash
git add features/carrier-rates/ap/invoice-upload.ts
git commit -m "feat(carrier-ap): lưu tổng+ngày PDF lúc đính (capture cho đối soát)"
```

---

## Task 5: Badge "PDF khớp / lệch / chưa đọc được" (bill-level)

**Files:**
- Create: `components/carrier-rates/pdf-cmp-badge.ts`
- Test: `components/carrier-rates/pdf-cmp-badge.test.ts`
- Modify: `components/carrier-rates/BillsBoard.tsx`
- Modify: `components/carrier-rates/InvoiceDetailModal.tsx`

**Interfaces — Consumes:** `comparePdfToBill` + `PdfBillCompare` (Task 2); `BillRow.pdfAmount/pdfIssueDate/pdfDueDate`, `hasPdf` (Task 3).
- Produces: `pdfCmpBadge(b, fmt): { label; title; cls } | null`.

> `BillsBoard` đã có: `fmt = (n) => Math.round(n).toLocaleString('vi-VN')`, badge "⚠ chưa có PDF" ở khối `{b.hasPdf ? (<a .../pdf>) : (<span>⚠ chưa có PDF</span>)}` (dòng ~92), và đếm "N bill chưa có PDF" ở header (dòng ~43). `InvoiceDetailModal` có khối tương tự (dòng ~70) + `fmt`.

- [ ] **Step 1: Failing test** — `components/carrier-rates/pdf-cmp-badge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pdfCmpBadge } from './pdf-cmp-badge';

const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
const base = { amount: 100, issueDate: '2025-01-01', dueDate: '2025-02-01' };

describe('pdfCmpBadge', () => {
  it('khớp → nhãn "PDF khớp" (xanh)', () => {
    const b = pdfCmpBadge({ ...base, pdfAmount: 100, pdfIssueDate: '2025-01-01', pdfDueDate: '2025-02-01' }, fmt);
    expect(b?.label).toBe('PDF khớp');
    expect(b?.cls).toContain('emerald');
  });
  it('lệch tiền → "PDF lệch" + title có số', () => {
    const b = pdfCmpBadge({ ...base, amount: 200, pdfAmount: 100, pdfIssueDate: '2025-01-01', pdfDueDate: '2025-02-01' }, fmt);
    expect(b?.label).toBe('PDF lệch');
    expect(b?.cls).toContain('amber');
    expect(b?.title).toMatch(/PDF.*XLSX.*lệch/);
  });
  it('pdfAmount null → "chưa đọc được"', () => {
    const b = pdfCmpBadge({ ...base, pdfAmount: null, pdfIssueDate: null, pdfDueDate: null }, fmt);
    expect(b?.label).toBe('PDF chưa đọc được tổng');
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run components/carrier-rates/pdf-cmp-badge.test.ts`.

- [ ] **Step 3: Implement** — `components/carrier-rates/pdf-cmp-badge.ts` (THUẦN, no JSX — trả data badge để 2 component dùng chung):
```ts
import { comparePdfToBill } from '@/features/carrier-rates/ap/compare-pdf-bill';

interface BillCmpInput {
  amount: number; issueDate: string | null; dueDate: string | null;
  pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null;
}

/** Nhãn + title + class badge đối soát PDF cho 1 bill (gọi khi bill có PDF). */
export function pdfCmpBadge(b: BillCmpInput, fmt: (n: number) => string): { label: string; title: string; cls: string } {
  const c = comparePdfToBill(b, b);
  if (c.overall === 'unknown') return { label: 'PDF chưa đọc được tổng', title: 'Không đọc được tổng tiền từ PDF — kiểm tra file', cls: 'bg-muted text-muted-foreground' };
  if (c.overall === 'match') return { label: 'PDF khớp', title: 'Tổng tiền và ngày trên PDF khớp file XLSX/CSV', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  const parts: string[] = [];
  if (c.amountStatus === 'mismatch' && b.pdfAmount !== null) parts.push(`PDF ${fmt(b.pdfAmount)} vs XLSX ${fmt(b.amount)} (lệch ${fmt(c.amountDeltaVnd ?? 0)})`);
  if (c.issueDateStatus === 'mismatch') parts.push('ngày HĐ lệch');
  if (c.dueDateStatus === 'mismatch') parts.push('ngày đáo hạn lệch');
  return { label: 'PDF lệch', title: parts.join(' · ') || 'PDF lệch file XLSX/CSV', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
}
```
(`comparePdfToBill(b, b)` hợp lệ vì `b` mang cả `amount/issueDate/dueDate` lẫn `pdfAmount/pdfIssueDate/pdfDueDate`.)

- [ ] **Step 4: Run → PASS** `npx vitest run components/carrier-rates/pdf-cmp-badge.test.ts` + `npx tsc --noEmit` + `npx eslint components/carrier-rates/pdf-cmp-badge.ts components/carrier-rates/pdf-cmp-badge.test.ts`.

- [ ] **Step 5: BillsBoard — render badge cạnh link PDF** — import `pdfCmpBadge` từ `./pdf-cmp-badge` và `comparePdfToBill` từ `@/features/carrier-rates/ap/compare-pdf-bill`. Trong khối `{b.hasPdf ? (...) : (...)}`, sau thẻ `<a .../pdf>`, KHI `b.hasPdf` thêm badge (đặt ngay sau `</a>` trong nhánh `hasPdf`):
```tsx
{b.hasPdf && (() => { const bd = pdfCmpBadge(b, fmt); return (
  <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium ' + bd.cls} title={bd.title}>{bd.label}</span>
); })()}
```

- [ ] **Step 6: BillsBoard — đếm "N bill PDF lệch" ở header** — cạnh khối đếm "N bill chưa có PDF" (dòng ~43), thêm:
```tsx
{(() => { const bad = bills.filter((b) => b.hasPdf && comparePdfToBill(b, b).overall === 'mismatch').length; return bad > 0 ? (
  <span className="text-amber-600 dark:text-amber-400"> · {bad} bill PDF lệch</span>
) : null; })()}
```

- [ ] **Step 7: InvoiceDetailModal — render badge** — import `pdfCmpBadge` từ `./pdf-cmp-badge` (KHÔNG import từ BillsBoard); trong khối `{bill.hasPdf ? (<a .../pdf>) : (<span>⚠…)}`, khi `bill.hasPdf` thêm badge sau thẻ `<a>`:
```tsx
{bill.hasPdf && (() => { const bd = pdfCmpBadge(bill, fmt); return (
  <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium ' + bd.cls} title={bd.title}>{bd.label}</span>
); })()}
```

- [ ] **Step 8: Verify** — `npx tsc --noEmit` + `npx eslint components/carrier-rates/BillsBoard.tsx components/carrier-rates/InvoiceDetailModal.tsx` + `npm run build`.

- [ ] **Step 9: Commit**
```bash
git add components/carrier-rates/BillsBoard.tsx components/carrier-rates/InvoiceDetailModal.tsx
git commit -m "feat(carrier-ap): badge PDF khớp/lệch/chưa-đọc trên bill + đếm bill lệch"
```

---

## Task 6: Verify toàn nhánh + PR

- [ ] **Step 1:** `npx tsc --noEmit` (sạch).
- [ ] **Step 2:** `npx vitest run` (toàn bộ pass — báo số).
- [ ] **Step 3:** `npm run build` (thành công).
- [ ] **Step 4:** Final whole-branch review (subagent-driven tự chạy).
- [ ] **Step 5:** Push + PR base `main`, body có Summary + Test Plan (parser FedEx/DHL từ mẫu thật; badge khớp/lệch/chưa-đọc; migration 0070 apply khi deploy; bill cũ đã đính PDF → "chưa đọc được" tới khi re-upload).

---

## Self-review notes
- Spec §1 parser → Task 1. §3 comparator → Task 2. §2 schema → Task 3. §3 capture → Task 4. §5 UI → Task 5. Verify+PR → Task 6.
- Type nhất quán: `PdfInvoiceTotals` (T1) dùng ở T4 capture. `PdfBillCompare`/`comparePdfToBill`/`PDF_MATCH_TOLERANCE_VND` (T2) dùng ở T5. `BillRow.pdfAmount/pdfIssueDate/pdfDueDate` (T3) dùng ở T5 + map ở T3. `carrierBills.pdfAmount` numeric → set bằng `String(total)` (T4), đọc bằng `Number(...)` (T3).
- Gotcha FedEx `\d{6,}` (Global Constraints) test ở T1.
- Migration KHÔNG chạy cục bộ (prod).
