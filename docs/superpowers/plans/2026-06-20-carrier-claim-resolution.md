# Đóng vòng đời claim lỗi carrier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng các đơn `disputing` (đang đòi NCC) bằng cách upload credit note (tự khớp tracking → ghi đã thu hồi → `credited`) hoặc bấm chấp nhận chênh lệch (→ `accepted`).

**Architecture:** 2 trạng thái terminal mới (`credited`/`accepted`) + 3 cột trên `shipment_reconcile_status`; parser thuần đọc credit note + matcher thuần khớp tracking với đơn đang đòi; 2 server action; UI trong tab "Đang đòi NCC" của `ReconcileIssuesModal`; report/CSV mở rộng.

**Tech Stack:** Next.js (server actions, RSC), Drizzle (migration tay + journal), Vitest, R2 (`putObject`), parse XML TT78 (regex, dependency-free).

## Global Constraints

- **Off `main`** (mảng A–C + #193–#198 đã merge): migration là **`0072_carrier-claim-resolution`**, journal idx **72** (0071 = mmp-order-pushes đã có trên main). Task 1 đã rebase + đổi số sang 0072.
- **Credit note = XML hoá đơn điện tử TT78** (FedEx/DHL gửi kèm PDF). Parse XML (1 parser dùng chung), KHÔNG parse PDF; PDF chỉ đính làm bằng chứng.
- Migration **tay** (`.sql` + journal), **KHÔNG** chạy `db:migrate` cục bộ (DATABASE_URL=PRODUCTION; apply khi deploy). `ALTER TYPE … ADD VALUE` chỉ thêm value (không ghi data cùng câu) → an toàn PG12+.
- Parser/matcher **thuần** (no I/O); parse/khớp fail → bỏ entry/đưa unmatched, **không** tạo recovered sai.
- **Task 3 (parser) cần MẪU THẬT** credit note DHL/FedEx — controller phải cung cấp mẫu (chạy `pdftotext -layout` / đọc CSV-XLSX) TRƯỚC khi dispatch; fixture test trích từ mẫu.
- `recoveredVnd` numeric → ghi bằng `String(n)`, đọc bằng `Number(...)`.
- `claimedVnd = |deltaVndAtReview|`. `fullyRecovered = recoveredVnd ≥ claimedVnd`.
- Quyền: tái dùng `requireUser()` (quyền `view_carrier_rates`) như các action reconcile hiện có.
- Chỉ khớp credit note với đơn `status='disputing'`. Idempotent theo `creditNoteNumber` (áp lại cùng CN → không cộng đôi).

---

## Task 1: Schema + trạng thái mới (nền)

**Files:**
- Create: `db/migrations/0071_carrier-claim-resolution.sql`
- Modify: `db/migrations/meta/_journal.json` (idx 71)
- Modify: `db/schema.ts` (enum + 3 cột)
- Modify: `features/shipments/reconcile-view.ts` (`ReconcileStatus` union)
- Modify: `features/shipments/reconcile-filter.ts` (`ReconcileFilters.status` union)
- Modify: `components/shipping-reconcile/ReconcileTable.tsx` (STATUS map + filter `<option>`)

**Interfaces — Produces:** enum `reconcile_status` thêm `'credited'`,`'accepted'`; `shipmentReconcileStatus.recoveredVnd/creditNoteNumber/creditNoteFileKey`; `ReconcileStatus` + filter union gồm 2 status mới.

- [ ] **Step 1: Migration SQL** — `db/migrations/0071_carrier-claim-resolution.sql`:
```sql
ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'credited';--> statement-breakpoint
ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'accepted';--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "recovered_vnd" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "credit_note_number" text;--> statement-breakpoint
ALTER TABLE "shipment_reconcile_status" ADD COLUMN IF NOT EXISTS "credit_note_file_key" text;
```

- [ ] **Step 2: Journal entry** — thêm vào cuối `entries` (dấu phẩy sau idx 70):
```json
    {
      "idx": 71,
      "version": "7",
      "when": 1782564000000,
      "tag": "0071_carrier-claim-resolution",
      "breakpoints": true
    }
```

- [ ] **Step 3: Schema** — `db/schema.ts`:
  - Đổi `reconcileStatusEnum`:
```ts
export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error', 'disputing', 'internal_error', 'credited', 'accepted']);
```
  - Trong `shipmentReconcileStatus`, sau `deltaVndAtReview: …,` thêm:
```ts
  /** Số tiền NCC đã thu hồi (credit note) — đối chiếu với |deltaVndAtReview|. */
  recoveredVnd: numeric('recovered_vnd', { precision: 16, scale: 2 }),
  creditNoteNumber: text('credit_note_number'),
  creditNoteFileKey: text('credit_note_file_key'),
```

- [ ] **Step 4: ReconcileStatus union** — `features/shipments/reconcile-view.ts:20`:
```ts
export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted';
```

- [ ] **Step 5: Filter union** — `features/shipments/reconcile-filter.ts`, trong `ReconcileFilters`:
```ts
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted';
```

- [ ] **Step 6: STATUS map + filter option** — `components/shipping-reconcile/ReconcileTable.tsx`:
  - Trong object STATUS (cạnh `disputing`), thêm:
```tsx
  credited: { label: 'Đã thu hồi', className: 'border border-emerald-500/40 text-emerald-600 dark:text-emerald-400' },
  accepted: { label: 'Chấp nhận chênh lệch', className: 'border border-border text-muted-foreground' },
```
  - Trong `<select>` filter trạng thái, sau option `disputing`, thêm:
```tsx
          <option value="credited">Đã thu hồi</option>
          <option value="accepted">Chấp nhận chênh lệch</option>
```
  - Cập nhật union prop của filter status nếu ReconcileTable có khai báo riêng (grep `internal_error'` trong file; thêm `| 'credited' | 'accepted'` mọi nơi liệt kê status để tsc sạch).

- [ ] **Step 7: Verify** — `npx tsc --noEmit` + `npx eslint db/schema.ts features/shipments/reconcile-view.ts features/shipments/reconcile-filter.ts components/shipping-reconcile/ReconcileTable.tsx`. KHÔNG db:migrate.

- [ ] **Step 8: Commit**
```bash
git add db/migrations/0071_carrier-claim-resolution.sql db/migrations/meta/_journal.json db/schema.ts features/shipments/reconcile-view.ts features/shipments/reconcile-filter.ts components/shipping-reconcile/ReconcileTable.tsx
git commit -m "feat(reconcile): trạng thái credited/accepted + cột recovered/credit-note"
```

---

## Task 2: Matcher thuần `matchCreditToDisputing`

**Files:**
- Create: `features/shipments/credit-note-match.ts`
- Test: `features/shipments/credit-note-match.test.ts`

**Interfaces — Produces:**
```ts
export interface CreditNoteLine { tracking: string; creditVnd: number }
export interface DisputingRow { shipmentId: string; tracking: string; claimedVnd: number; recoveredVnd: number }
export interface CreditMatchRow { shipmentId: string; tracking: string; creditVnd: number; newRecovered: number; fullyRecovered: boolean }
export interface CreditMatchResult { matched: CreditMatchRow[]; unmatched: { tracking: string; creditVnd: number; reason: string }[] }
export function matchCreditToDisputing(lines: CreditNoteLine[], disputing: DisputingRow[]): CreditMatchResult
```

- [ ] **Step 1: Failing test** — `features/shipments/credit-note-match.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { matchCreditToDisputing } from './credit-note-match';

const disp = [
  { shipmentId: 's1', tracking: '111', claimedVnd: 100000, recoveredVnd: 0 },
  { shipmentId: 's2', tracking: '222', claimedVnd: 100000, recoveredVnd: 30000 },
];

describe('matchCreditToDisputing', () => {
  it('khớp đủ → fullyRecovered', () => {
    const r = matchCreditToDisputing([{ tracking: '111', creditVnd: 100000 }], disp);
    expect(r.matched).toEqual([{ shipmentId: 's1', tracking: '111', creditVnd: 100000, newRecovered: 100000, fullyRecovered: true }]);
    expect(r.unmatched).toEqual([]);
  });
  it('cộng dồn recovered hiện có; thiếu → fullyRecovered=false', () => {
    const r = matchCreditToDisputing([{ tracking: '222', creditVnd: 40000 }], disp);
    expect(r.matched[0]).toMatchObject({ shipmentId: 's2', newRecovered: 70000, fullyRecovered: false });
  });
  it('tracking không đang đòi → unmatched', () => {
    const r = matchCreditToDisputing([{ tracking: '999', creditVnd: 50000 }], disp);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual([{ tracking: '999', creditVnd: 50000, reason: 'Không phải đơn đang đòi NCC' }]);
  });
  it('recovered vượt claimed → vẫn fullyRecovered, giữ số thực', () => {
    const r = matchCreditToDisputing([{ tracking: '111', creditVnd: 150000 }], disp);
    expect(r.matched[0]).toMatchObject({ newRecovered: 150000, fullyRecovered: true });
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/shipments/credit-note-match.test.ts`.

- [ ] **Step 3: Implement** — `features/shipments/credit-note-match.ts`:
```ts
/** Khớp dòng credit note (tracking → số NCC giảm) với các đơn đang đòi NCC. THUẦN. */
export interface CreditNoteLine { tracking: string; creditVnd: number }
export interface DisputingRow { shipmentId: string; tracking: string; claimedVnd: number; recoveredVnd: number }
export interface CreditMatchRow { shipmentId: string; tracking: string; creditVnd: number; newRecovered: number; fullyRecovered: boolean }
export interface CreditMatchResult { matched: CreditMatchRow[]; unmatched: { tracking: string; creditVnd: number; reason: string }[] }

export function matchCreditToDisputing(lines: CreditNoteLine[], disputing: DisputingRow[]): CreditMatchResult {
  const byTracking = new Map<string, DisputingRow>();
  for (const d of disputing) byTracking.set(d.tracking, d);
  const matched: CreditMatchRow[] = [];
  const unmatched: CreditMatchResult['unmatched'] = [];
  for (const ln of lines) {
    const d = byTracking.get(ln.tracking);
    if (!d) { unmatched.push({ tracking: ln.tracking, creditVnd: ln.creditVnd, reason: 'Không phải đơn đang đòi NCC' }); continue; }
    const newRecovered = d.recoveredVnd + ln.creditVnd;
    matched.push({ shipmentId: d.shipmentId, tracking: d.tracking, creditVnd: ln.creditVnd, newRecovered, fullyRecovered: newRecovered >= d.claimedVnd });
  }
  return { matched, unmatched };
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npx eslint features/shipments/credit-note-match.ts features/shipments/credit-note-match.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/shipments/credit-note-match.ts features/shipments/credit-note-match.test.ts
git commit -m "feat(reconcile): matcher thuần khớp credit note với đơn đang đòi"
```

---

## Task 3: Parser thuần `parseCreditNoteXml` (XML TT78 — dùng chung DHL+FedEx)

**Files:**
- Create: `features/shipments/credit-note-parse.ts`
- Test: `features/shipments/credit-note-parse.test.ts`

> **Mẫu thật ĐÃ CÓ**: FedEx gửi credit note dạng **XML hoá đơn điện tử chuẩn TT78** (kèm PDF cho người xem). Parse **XML** (chính xác, ổn định, 1 parser cho mọi NCC vì TT78 dùng tag chuẩn) — KHÔNG parse PDF. Dependency-free: regex trên schema cố định (XML máy sinh, không namespace ở field dữ liệu cần lấy). Fixture = trích từ file thật `VN-Credit Note .../734093212-260600140-VAT.xml`.

**Cấu trúc XML (đã phân tích từ mẫu thật):**
- Số CN chuẩn: `<KHHDon>K26TFA</KHHDon>` + `<SHDon>27612</SHDon>` → `K26TFA-27612`.
- Mỗi dòng hàng = block `<HHDVu>…</HHDVu>`: `<THHDVu>871785641570 VN CA</THHDVu>` (token đầu = AWB/tracking) + số tiền GỒM VAT (âm) ở extra `<TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-2566197</DLieu>`. Fallback `<ThTien>` (pre-tax) nếu NCC khác không có extra Amount.
- Dòng mô tả ("Điều chỉnh cho hoá đơn…") nằm ở `<GChu>`/Extra — KHÔNG phải `<HHDVu>` → không lẫn.

**Interfaces — Produces:**
```ts
export interface CreditNoteLine { tracking: string; creditVnd: number }  // cùng shape Task 2
export interface CreditNoteParsed { creditNoteNumber: string | null; lines: CreditNoteLine[] }
export function parseCreditNoteXml(xml: string): CreditNoteParsed
```

- [ ] **Step 1: Failing test** — `features/shipments/credit-note-parse.test.ts` (fixture trích mẫu thật, che PII người mua):
```ts
import { describe, it, expect } from 'vitest';
import { parseCreditNoteXml } from './credit-note-parse';

// Trích từ credit note FedEx thật (TT78). 2 dòng AWB, số tiền GỒM VAT (âm).
const FEDEX_CN = `<HDon><DLHDon Id="DuLieuKy"><TTChung><THDon>Hóa đơn GTGT</THDon><KHHDon>K26TFA</KHHDon><SHDon>27612</SHDon><NLap>2026-06-05</NLap></TTChung><NDHDon><DSHHDVu>` +
  `<HHDVu><STT>1</STT><THHDVu>871785641570 VN CA</THHDVu><SLuong>-1</SLuong><ThTien>-2376108</ThTien><TTKhac><TTin><TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-2566197</DLieu></TTin><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>-190089</DLieu></TTin></TTKhac></HHDVu>` +
  `<HHDVu><STT>2</STT><THHDVu>871510877160 VN GB</THHDVu><SLuong>-1</SLuong><ThTien>-2481149</ThTien><TTKhac><TTin><TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-2679641</DLieu></TTin><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>-198492</DLieu></TTin></TTKhac></HHDVu>` +
  `</DSHHDVu><TToan><TgTTTBSo>-5245838</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;

describe('parseCreditNoteXml', () => {
  it('FedEx TT78 → số CN (KHHDon-SHDon) + 2 dòng {tracking, creditVnd gồm VAT, dương}', () => {
    const r = parseCreditNoteXml(FEDEX_CN);
    expect(r.creditNoteNumber).toBe('K26TFA-27612');
    expect(r.lines).toEqual([
      { tracking: '871785641570', creditVnd: 2566197 },
      { tracking: '871510877160', creditVnd: 2679641 },
    ]);
  });
  it('fallback ThTien khi không có extra Amount', () => {
    const x = `<HDon><DLHDon><TTChung><KHHDon>X</KHHDon><SHDon>9</SHDon></TTChung><NDHDon><DSHHDVu>` +
      `<HHDVu><THHDVu>999000111222 VN US</THHDVu><ThTien>-100000</ThTien></HHDVu>` +
      `</DSHHDVu></NDHDon></DLHDon></HDon>`;
    expect(parseCreditNoteXml(x).lines).toEqual([{ tracking: '999000111222', creditVnd: 100000 }]);
  });
  it('rác / không phải XML → rỗng', () => {
    expect(parseCreditNoteXml('blah')).toEqual({ creditNoteNumber: null, lines: [] });
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/shipments/credit-note-parse.test.ts`.

- [ ] **Step 3: Implement** — `features/shipments/credit-note-parse.ts` (THUẦN, regex trên TT78, không dep):
```ts
export interface CreditNoteLine { tracking: string; creditVnd: number }
export interface CreditNoteParsed { creditNoteNumber: string | null; lines: CreditNoteLine[] }

/** Đọc credit note hoá đơn điện tử TT78 (FedEx/DHL gửi XML). Số tiền trong file là
 *  ÂM (giảm trừ) → creditVnd = trị tuyệt đối. THUẦN. */
export function parseCreditNoteXml(xml: string): CreditNoteParsed {
  const kh = xml.match(/<KHHDon>([^<]+)<\/KHHDon>/)?.[1]?.trim();
  const sh = xml.match(/<SHDon>([^<]+)<\/SHDon>/)?.[1]?.trim();
  const creditNoteNumber = sh ? (kh ? `${kh}-${sh}` : sh) : null;

  const lines: CreditNoteLine[] = [];
  for (const block of xml.match(/<HHDVu>[\s\S]*?<\/HHDVu>/g) ?? []) {
    const desc = block.match(/<THHDVu>([^<]*)<\/THHDVu>/)?.[1]?.trim();
    if (!desc) continue;
    const tracking = desc.split(/\s+/)[0];
    if (!/^\d{6,}$/.test(tracking)) continue;          // AWB/tracking = token số ≥6
    // Số tiền GỒM VAT: extra "Amount"; fallback ThTien (pre-tax) nếu thiếu.
    const raw = block.match(/<TTruong>Amount<\/TTruong>\s*<KDLieu>[^<]*<\/KDLieu>\s*<DLieu>(-?\d+)<\/DLieu>/)?.[1]
      ?? block.match(/<ThTien>(-?\d+)<\/ThTien>/)?.[1];
    if (raw == null) continue;
    const creditVnd = Math.abs(Number(raw));
    if (!Number.isFinite(creditVnd) || creditVnd === 0) continue;
    lines.push({ tracking, creditVnd });
  }
  return { creditNoteNumber, lines };
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npx eslint features/shipments/credit-note-parse.ts features/shipments/credit-note-parse.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/shipments/credit-note-parse.ts features/shipments/credit-note-parse.test.ts
git commit -m "feat(reconcile): parser credit note XML TT78 (dùng chung DHL/FedEx)"
```

---

## Task 4: Server actions `applyCreditNote` / `acceptDifference`

**Files:**
- Create: `features/shipments/claim-resolution-actions.ts`

**Interfaces — Consumes:** `parseCreditNoteXml` (T3), `matchCreditToDisputing`/`DisputingRow` (T2), `UploadFile` (`@/features/carrier-rates/ap/bills-actions`), `putObject` (`@/lib/storage/s3`), `db`/`schema`.
- Produces:
```ts
export interface CreditApplyResult { creditNoteNumber: string | null; matched: { tracking: string; creditVnd: number; credited: boolean }[]; unmatched: { tracking: string; creditVnd: number; reason: string }[] }
// xml = file XML TT78 (để KHỚP); pdf = optional, đính làm bằng chứng cho người xem.
export async function applyCreditNote(input: { xml: UploadFile; pdf?: UploadFile }): Promise<CreditApplyResult>
export async function acceptDifference(input: { shipmentId: string }): Promise<void>
```

- [ ] **Step 1: Implement** — `features/shipments/claim-resolution-actions.ts` (`'use server'`):
```ts
'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { putObject } from '@/lib/storage/s3';
import { parseCreditNoteXml } from './credit-note-parse';
import { matchCreditToDisputing, type DisputingRow } from './credit-note-match';
import type { UploadFile } from '@/features/carrier-rates/ap/bills-actions';

const ROUTE = '/f/shipping-reconcile';
async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreditApplyResult {
  creditNoteNumber: string | null;
  matched: { tracking: string; creditVnd: number; credited: boolean }[];
  unmatched: { tracking: string; creditVnd: number; reason: string }[];
}

export async function applyCreditNote(input: { xml: UploadFile; pdf?: UploadFile }): Promise<CreditApplyResult> {
  const userId = await requireUser();
  // 1) XML TT78 là text — decode UTF-8 rồi parse (không pdftotext, không carrier param).
  const xmlText = new TextDecoder('utf-8').decode(input.xml.bytes);
  const parsed = parseCreditNoteXml(xmlText);
  if (parsed.lines.length === 0) return { creditNoteNumber: parsed.creditNoteNumber, matched: [], unmatched: [] };

  // 2) đơn đang đòi (join tracking + claimed/recovered hiện tại)
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      tracking: schema.shipments.trackingNumber,
      delta: schema.shipmentReconcileStatus.deltaVndAtReview,
      recovered: schema.shipmentReconcileStatus.recoveredVnd,
      cn: schema.shipmentReconcileStatus.creditNoteNumber,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .where(eq(schema.shipmentReconcileStatus.status, 'disputing'));

  // idempotent: bỏ đơn đã áp đúng credit note này (tránh cộng đôi)
  const disputing: DisputingRow[] = rows
    .filter((r) => r.tracking && !(parsed.creditNoteNumber && r.cn === parsed.creditNoteNumber))
    .map((r) => ({
      shipmentId: r.shipmentId,
      tracking: r.tracking as string,
      claimedVnd: Math.abs(r.delta !== null ? Number(r.delta) : 0),
      recoveredVnd: r.recovered !== null ? Number(r.recovered) : 0,
    }));

  const res = matchCreditToDisputing(parsed.lines, disputing);
  if (res.matched.length === 0) {
    return { creditNoteNumber: parsed.creditNoteNumber, matched: [], unmatched: res.unmatched };
  }

  // 3) lưu file BẰNG CHỨNG 1 lần: ưu tiên PDF (người xem), fallback XML. Set cho từng đơn khớp.
  const proof = input.pdf ?? input.xml;
  const ct = proof.contentType || (input.pdf ? 'application/pdf' : 'application/xml');
  const ext = proof.filename.includes('.') ? proof.filename.slice(proof.filename.lastIndexOf('.')) : '';
  const fileKey = `carrier-credit-notes/${randomUUID()}${ext}`;
  await putObject(fileKey, proof.bytes, ct);

  const matchedOut: CreditApplyResult['matched'] = [];
  for (const m of res.matched) {
    await db.update(schema.shipmentReconcileStatus)
      .set({
        recoveredVnd: String(m.newRecovered),
        creditNoteNumber: parsed.creditNoteNumber,
        creditNoteFileKey: fileKey,
        status: m.fullyRecovered ? 'credited' : 'disputing',
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      })
      .where(and(eq(schema.shipmentReconcileStatus.shipmentId, m.shipmentId), eq(schema.shipmentReconcileStatus.status, 'disputing')));
    matchedOut.push({ tracking: m.tracking, creditVnd: m.creditVnd, credited: m.fullyRecovered });
  }
  revalidatePath(ROUTE);
  return { creditNoteNumber: parsed.creditNoteNumber, matched: matchedOut, unmatched: res.unmatched };
}

export async function acceptDifference(input: { shipmentId: string }): Promise<void> {
  const userId = await requireUser();
  await db.update(schema.shipmentReconcileStatus)
    .set({ status: 'accepted', reconciledBy: userId, reconciledAt: sql`now()` })
    .where(and(eq(schema.shipmentReconcileStatus.shipmentId, input.shipmentId), eq(schema.shipmentReconcileStatus.status, 'disputing')));
  revalidatePath(ROUTE);
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` + `npx eslint features/shipments/claim-resolution-actions.ts` + `npm run build`. (Không unit test — I/O orchestration; parser+matcher đã test riêng.)

- [ ] **Step 3: Commit**
```bash
git add features/shipments/claim-resolution-actions.ts
git commit -m "feat(reconcile): action applyCreditNote + acceptDifference (đóng vòng đời claim)"
```

---

## Task 5: Report + CSV mở rộng

**Files:**
- Modify: `features/shipments/carrier-error-report.ts` (`CarrierErrorRow`, query, `summariseCarrierErrors` giữ nguyên chữ ký)
- Modify: `app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts`

**Interfaces — Consumes:** cột `recoveredVnd`/`creditNoteNumber` (T1). Produces: `CarrierErrorRow` thêm `recoveredVnd: number|null`, `creditNoteNumber: string|null`; `state` thêm `'credited'|'accepted'`.

- [ ] **Step 1: CarrierErrorRow + query** — trong `features/shipments/carrier-error-report.ts`:
  - `state: 'disputing' | 'approved' | 'credited' | 'accepted';` và thêm `recoveredVnd: number | null; creditNoteNumber: string | null;` vào `CarrierErrorRow`.
  - `listCarrierErrors`: `.where(inArray(status, ['carrier_error', 'disputing', 'credited', 'accepted']))`; select thêm `recovered: schema.shipmentReconcileStatus.recoveredVnd, creditNoteNumber: schema.shipmentReconcileStatus.creditNoteNumber`; map thêm `recoveredVnd: r.recovered !== null ? Number(r.recovered) : null, creditNoteNumber: r.creditNoteNumber ?? null`, và:
```ts
    state: r.status === 'disputing' ? 'disputing'
      : r.status === 'credited' ? 'credited'
      : r.status === 'accepted' ? 'accepted'
      : 'approved',
```

- [ ] **Step 2: CSV** — trong `carrier-errors.csv/route.ts`, thêm cột header `Đã thu hồi`, `Số credit note`, `Trạng thái` và xuất `r.recoveredVnd ?? ''`, `r.creditNoteNumber ?? ''`, `r.state`. (Theo đúng cách build CSV hiện có trong file — grep header row, thêm field cùng thứ tự.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit` + `npx eslint features/shipments/carrier-error-report.ts "app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts"`.

- [ ] **Step 4: Commit**
```bash
git add features/shipments/carrier-error-report.ts "app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts"
git commit -m "feat(reconcile): report/CSV thêm đã thu hồi + credit note + trạng thái mới"
```

---

## Task 6: UI — upload credit note + chấp nhận chênh lệch

**Files:**
- Create: `components/shipping-reconcile/CreditNoteDialog.tsx`
- Modify: `components/shipping-reconcile/ReconcileIssuesModal.tsx`

**Interfaces — Consumes:** `applyCreditNote`/`acceptDifference` (T4), `CarrierErrorRow` (T5).

- [ ] **Step 1: CreditNoteDialog** — `components/shipping-reconcile/CreditNoteDialog.tsx` (`'use client'`): nút "Upload credit note" → input file `accept=".xml,.pdf" multiple` (kéo cả cặp XML+PDF FedEx gửi). Tách theo đuôi: file `.xml` = để KHỚP (bắt buộc), file `.pdf` = đính proof (optional). Helper:
  ```ts
  const toUp = async (f: File) => ({ bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type });
  const xmlF = files.find((f) => /\.xml$/i.test(f.name));
  const pdfF = files.find((f) => /\.pdf$/i.test(f.name));
  if (!xmlF) { setError('Cần file XML credit note (để khớp). PDF chỉ là bằng chứng.'); return; }
  const res = await applyCreditNote({ xml: await toUp(xmlF), pdf: pdfF ? await toUp(pdfF) : undefined });
  ```
  → hiện bảng kết quả `matched` (tracking · số giảm · credited?) + `unmatched` (tracking · lý do) → `router.refresh()` nếu `matched.length>0`. Theo style `CarrierInvoiceDialog` (Dialog/Button/useTransition/useRouter). **KHÔNG còn chọn carrier** (XML TT78 carrier-agnostic). Import action trực tiếp từ `@/features/shipments/claim-resolution-actions` (pattern import 'use server' như `ReconcileDetailPanel`).

- [ ] **Step 2: ReconcileIssuesModal — nút + cột + tổng** — trong mục "Đang đòi NCC" (`tab === 'carrier'`):
  - Render `<CreditNoteDialog />` ở đầu mục.
  - Mỗi dòng `disputing`: cột "Đã thu hồi / Còn lại" = `fmtVnd(r.recoveredVnd)` / `fmtVnd(Math.abs(r.deltaVnd ?? 0) - (r.recoveredVnd ?? 0))`; nút "Chấp nhận chênh lệch" → `useTransition` gọi `acceptDifference({ shipmentId: r.shipmentId })` rồi `router.refresh()`.
  - Tổng: `Σ đang đòi` (claimed các đơn `state==='disputing'`), `Σ đã thu hồi` (`Σ recoveredVnd`), `Σ chấp nhận` (`state==='accepted'`: `Σ (|delta|−recovered)`).
  - Hiện đơn `state==='credited'`/`'accepted'` (đã đóng) tách nhóm hoặc badge để phân biệt với đang đòi.
  > `ReconcileIssuesModal` là client component (`'use client'`) — thêm `import { useRouter } from 'next/navigation'` + `useTransition` nếu chưa có.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` + `npx eslint components/shipping-reconcile/CreditNoteDialog.tsx components/shipping-reconcile/ReconcileIssuesModal.tsx` + `npm run build`.

- [ ] **Step 4: Commit**
```bash
git add components/shipping-reconcile/CreditNoteDialog.tsx components/shipping-reconcile/ReconcileIssuesModal.tsx
git commit -m "feat(reconcile): UI upload credit note + chấp nhận chênh lệch + cột đã thu hồi"
```

---

## Task 7: Verify toàn nhánh + PR

- [ ] **Step 1:** `npx tsc --noEmit` (sạch).
- [ ] **Step 2:** `npx vitest run` (toàn bộ pass — báo số).
- [ ] **Step 3:** `npm run build` (thành công).
- [ ] **Step 4:** Final whole-branch review (subagent-driven tự chạy).
- [ ] **Step 5:** Push + PR base `main` (stacked sau mảng C), body Summary + Test Plan: upload credit note khớp tracking → credited/partial; chấp nhận chênh lệch → accepted; report/CSV; migration 0071 apply khi deploy; merge sau A/B/C.

---

## Self-review notes
- Spec §1 schema → T1. §2 parser → T3. §3 matcher → T2. §4 actions → T4. §5 UI → T6. §6 report/CSV → T5. Lọc/hiển thị (filter+STATUS) → T1.
- Type nhất quán: `CreditNoteLine` dùng chung T2/T3. `DisputingRow`/`matchCreditToDisputing` (T2) dùng ở T4. `parseCreditNote` (T3) dùng ở T4. `recoveredVnd/creditNoteNumber/creditNoteFileKey` (T1) dùng ở T4/T5. `state` mới (T5) dùng ở T6.
- Số tiền numeric: ghi `String(...)`, đọc `Number(...)`.
- **T3 phụ thuộc mẫu thật** — dispatch sau khi có mẫu; T2/T1 không phụ thuộc, làm trước.
- Migration 0071 KHÔNG chạy cục bộ.
