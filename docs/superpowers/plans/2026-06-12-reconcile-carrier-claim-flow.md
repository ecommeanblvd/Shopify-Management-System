# Flow lỗi carrier theo khoản + đòi NCC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Đối soát ship: chọn lỗi carrier cụ thể (auto-gợi ý từ engine), thêm trạng thái `disputing` ("đang đòi NCC") cho khoản billed>engine (đơn mở tới khi bill khớp mới duyệt), report tách đang-đòi / đã-duyệt.

**Architecture:** Tái dùng `shipment_reconcile_status` (thêm enum `disputing`, không thêm cột). Helper thuần (kinds, suggest/needsClaim/isApprovableMatch) tách file TDD. UI panel rẽ nhánh theo dấu `deltaVnd`.

**Tech Stack:** Next.js 16, Drizzle/Postgres, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-reconcile-carrier-claim-flow-design.md`

---

### Task 1: Kinds (9 + biện pháp + legacy) + helper flow + schema enum + migration

**Files:**
- Modify: `features/shipments/carrier-error-kinds.ts` (+ test)
- Create: `features/shipments/carrier-error-flow.ts` (+ test)
- Modify: `db/schema.ts` (enum)
- Create: `scripts/migrate-reconcile-disputing.ts`

- [ ] **Step 1: Test kinds** — cập nhật `carrier-error-kinds.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CARRIER_ERROR_KINDS, isCarrierErrorKind, carrierErrorKindLabel, carrierErrorKindRemediation } from './carrier-error-kinds';

describe('carrier-error-kinds', () => {
  it('9 loại theo khoản, value duy nhất', () => {
    expect(CARRIER_ERROR_KINDS).toHaveLength(9);
    expect(new Set(CARRIER_ERROR_KINDS.map((k) => k.value)).size).toBe(9);
    for (const v of ['weight','zone','fuel','remote','demand','signature','vat','ratecard','other'])
      expect(isCarrierErrorKind(v)).toBe(true);
  });
  it('mỗi loại có biện pháp', () => {
    for (const k of CARRIER_ERROR_KINDS) expect(carrierErrorKindRemediation(k.value).length).toBeGreaterThan(0);
  });
  it('label: loại mới + legacy surcharge', () => {
    expect(carrierErrorKindLabel('zone')).toBe('Sai zone');
    expect(carrierErrorKindLabel('surcharge')).toBe('Phụ phí sai');
    expect(carrierErrorKindLabel('bogus')).toBe('bogus');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run features/shipments/carrier-error-kinds.test.ts`).

- [ ] **Step 3: Viết `carrier-error-kinds.ts`**
```ts
/** Loại lỗi carrier theo từng khoản + biện pháp gợi ý. Dùng chung UI + validate. */
export const CARRIER_ERROR_KINDS = [
  { value: 'weight',    label: 'Sai cân',                       remediation: 'Đối chiếu cân thực/dim; nếu NCC cân sai → yêu cầu cân lại & điều chỉnh bill.' },
  { value: 'zone',      label: 'Sai zone',                      remediation: 'Đối chiếu zone trên rate card NCC; nếu NCC sai → đòi sửa zone & gửi bill mới.' },
  { value: 'fuel',      label: 'Sai phụ phí xăng dầu (fuel)',   remediation: 'Đối chiếu % fuel tuần label; nếu NCC áp sai → đòi điều chỉnh.' },
  { value: 'remote',    label: 'Sai phụ phí vùng xa (remote)',  remediation: 'Kiểm ODA/postcode; nếu NCC tính remote sai → đòi gỡ/điều chỉnh.' },
  { value: 'demand',    label: 'Sai phụ phí nhu cầu (demand)',  remediation: 'Đối chiếu biểu demand theo ngày; nếu sai mốc → đòi điều chỉnh.' },
  { value: 'signature', label: 'Sai phụ phí ký nhận',           remediation: 'Xác nhận có yêu cầu ký nhận không; nếu NCC thu nhầm → đòi gỡ.' },
  { value: 'vat',       label: 'Sai VAT',                       remediation: 'Kiểm VAT 8% trên đúng cơ sở; nếu NCC tính sai gốc → đòi tính lại.' },
  { value: 'ratecard',  label: 'Sai rate card / chiết khấu',    remediation: 'Đối chiếu rate/chiết khấu hợp đồng; nếu NCC áp sai → đòi áp đúng.' },
  { value: 'other',     label: 'Khác',                          remediation: 'Ghi rõ ở ô lý do; làm việc trực tiếp với NCC.' },
] as const;

export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number]['value'];

/** Loại cũ đã ngừng chọn nhưng còn dữ liệu — vẫn hiển thị đẹp. */
const LEGACY_LABELS: Record<string, string> = { surcharge: 'Phụ phí sai' };

export function isCarrierErrorKind(v: string): v is CarrierErrorKind {
  return CARRIER_ERROR_KINDS.some((k) => k.value === v);
}
export function carrierErrorKindLabel(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.label ?? LEGACY_LABELS[v] ?? v;
}
export function carrierErrorKindRemediation(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.remediation ?? '';
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Test flow** `features/shipments/carrier-error-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { suggestCauseKind, needsCarrierClaim, isApprovableMatch } from './carrier-error-flow';
import type { ReconcileDiagnosis } from './reconcile-diagnose';

const diag = (components: any[], severity = 'config'): ReconcileDiagnosis =>
  ({ totalDelta: 0, components, impliedWeight: null, impliedZone: null, verdict: '', severity } as ReconcileDiagnosis);

describe('suggestCauseKind', () => {
  it('chọn khoản |delta| lớn nhất khác KHOP', () => {
    expect(suggestCauseKind(diag([
      { key: 'fuel', billed: 0, engine: 0, delta: 50, cause: 'LECH_FUEL' },
      { key: 'remote', billed: 0, engine: 0, delta: 200, cause: 'REMOTE_KHONG_KHOP' },
    ]))).toBe('remote');
  });
  it('base+SAI_CAN→weight, base+SAI_ZONE→zone, base+LECH_RATE_CARD→ratecard', () => {
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'SAI_CAN' }]))).toBe('weight');
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'SAI_ZONE' }]))).toBe('zone');
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'LECH_RATE_CARD' }]))).toBe('ratecard');
  });
  it('signature/vat/demand theo key', () => {
    expect(suggestCauseKind(diag([{ key: 'signature', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('signature');
    expect(suggestCauseKind(diag([{ key: 'vat', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('vat');
  });
  it('gogreen/elevatedRisk→other; null→""', () => {
    expect(suggestCauseKind(diag([{ key: 'gogreen', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('other');
    expect(suggestCauseKind(null)).toBe('');
    expect(suggestCauseKind(diag([{ key: 'fuel', billed: 0, engine: 0, delta: 0, cause: 'KHOP' }]))).toBe('');
  });
});
describe('needsCarrierClaim', () => {
  it('>0 đòi, ≤0/null không', () => {
    expect(needsCarrierClaim(100)).toBe(true);
    expect(needsCarrierClaim(-100)).toBe(false);
    expect(needsCarrierClaim(0)).toBe(false);
    expect(needsCarrierClaim(null)).toBe(false);
  });
});
describe('isApprovableMatch', () => {
  it('match/rounding mới duyệt', () => {
    expect(isApprovableMatch('match')).toBe(true);
    expect(isApprovableMatch('rounding')).toBe(true);
    expect(isApprovableMatch('zone')).toBe(false);
    expect(isApprovableMatch(null)).toBe(false);
  });
});
```

- [ ] **Step 6: Run → FAIL.**

- [ ] **Step 7: Viết `carrier-error-flow.ts`**
```ts
import type { ReconcileDiagnosis, DiagnosisSeverity, ComponentDelta } from './reconcile-diagnose';

function kindOfComponent(c: ComponentDelta): string {
  switch (c.key) {
    case 'base':
      if (c.cause === 'SAI_CAN') return 'weight';
      if (c.cause === 'SAI_ZONE') return 'zone';
      return 'ratecard'; // LECH_RATE_CARD / LECH_CHIET_KHAU / LECH_FUEL_BASE…
    case 'discount': return 'ratecard';
    case 'fuel': return 'fuel';
    case 'remote': return 'remote';
    case 'demand': return 'demand';
    case 'signature': return 'signature';
    case 'vat': return 'vat';
    default: return 'other'; // gogreen / elevatedRisk / residual
  }
}

/** Gợi ý loại lỗi từ khoản lệch |delta| lớn nhất khác KHOP. '' nếu không rõ. */
export function suggestCauseKind(diagnosis: ReconcileDiagnosis | null | undefined): string {
  if (!diagnosis) return '';
  let best: ComponentDelta | null = null;
  for (const c of diagnosis.components) {
    if (c.cause === 'KHOP' || c.delta === 0) continue;
    if (best === null || Math.abs(c.delta) > Math.abs(best.delta)) best = c;
  }
  return best ? kindOfComponent(best) : '';
}

/** billed > engine ⇒ NCC thu vượt ⇒ phải đòi. */
export function needsCarrierClaim(deltaVnd: number | null): boolean {
  return deltaVnd != null && deltaVnd > 0;
}

/** Đơn đang đòi chỉ DUYỆT khi bill mới đã khớp. */
export function isApprovableMatch(severity: DiagnosisSeverity | null | undefined): boolean {
  return severity === 'match' || severity === 'rounding';
}
```
Verify `ComponentDelta` được export từ `reconcile-diagnose.ts` (đã export — interface line ~39). Nếu chưa export, thêm `export`.

- [ ] **Step 8: Run → PASS.**

- [ ] **Step 9: Schema enum** — `db/schema.ts`, đổi `reconcileStatusEnum`:
```ts
export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error', 'disputing']);
```

- [ ] **Step 10: Migration `scripts/migrate-reconcile-disputing.ts`**
```ts
/** Thêm enum value 'disputing' (đang đòi NCC). Chạy: dotenv -- tsx scripts/migrate-reconcile-disputing.ts */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
async function main() {
  await db.execute(sql`ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'disputing'`);
  console.log('OK: reconcile_status thêm disputing.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
(KHÔNG chạy ở task này.)

- [ ] **Step 11:** `npx tsc --noEmit` sạch. **Commit**
```bash
git add features/shipments/carrier-error-kinds.ts features/shipments/carrier-error-kinds.test.ts features/shipments/carrier-error-flow.ts features/shipments/carrier-error-flow.test.ts db/schema.ts scripts/migrate-reconcile-disputing.ts features/shipments/reconcile-diagnose.ts
git commit -m "feat(reconcile): loại lỗi carrier theo khoản + biện pháp + helper flow + enum disputing"
```

---

### Task 2: Action disputeWithCarrier + view layer

**Files:**
- Modify: `features/shipments/reconcile-status-actions.ts`
- Modify: `features/shipments/reconcile-view.ts` (+ test `reconcile-view.test.ts`)

- [ ] **Step 1: Test mergeStatus disputing** — thêm vào `reconcile-view.test.ts`:
```ts
it('dòng disputing mang status + carrierErrorKind + deltaVndAtReview', () => {
  const base = [{ shipmentId: 'a' }, { shipmentId: 'b' }] as unknown as ReconcileRow[];
  const map = new Map<string, StatusRecord>([
    ['a', { status: 'disputing', note: 'đòi NCC', carrierErrorKind: 'zone', deltaVndAtReview: 194306, billedTotalAtReview: 1741581 }],
  ]);
  const rows = mergeStatus(base, map);
  expect(rows[0].status).toBe('disputing');
  expect(rows[0].carrierErrorKind).toBe('zone');
  expect(rows[0].deltaVndAtReview).toBe(194306);
  expect(rows[1].deltaVndAtReview).toBeNull();
});
```
(Dùng helper `row()` nếu file dùng — khớp pattern hiện có.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: `reconcile-view.ts`**
- `ReconcileStatus` += `'disputing'`.
- `StatusRecord.status` union += `'disputing'`.
- `ReconcileViewRow` += `deltaVndAtReview: number | null;`.
- `mergeStatus` thêm `deltaVndAtReview: rec?.deltaVndAtReview ?? null,` vào object trả về.
  (carrierErrorKind đã có. select trong `reconcileShipmentsWithStatus` đã lấy `deltaVndAtReview` từ Task trước — giữ nguyên.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Action** — `reconcile-status-actions.ts`, thêm:
```ts
export interface DisputeCarrierInput {
  shipmentId: string; kind: string; note: string; billedTotal: number; deltaVnd: number;
}
/** Mở đòi NCC: đơn sang 'disputing', chốt loại lỗi + số lệch gốc đang đòi. */
export async function disputeWithCarrier(input: DisputeCarrierInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do đòi NCC');
  if (!isCarrierErrorKind(input.kind)) throw new Error('Loại lỗi không hợp lệ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId, status: 'disputing', note,
      carrierErrorKind: input.kind, billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(), reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'disputing', note, carrierErrorKind: input.kind,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(), reconciledBy: userId, reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}
```
(`isCarrierErrorKind` đã import từ Task CE2. Nếu chưa, thêm `import { isCarrierErrorKind } from './carrier-error-kinds';`.)

- [ ] **Step 6:** `npx vitest run features/shipments/` + `npx tsc --noEmit` xanh. **Commit**
```bash
git add features/shipments/reconcile-status-actions.ts features/shipments/reconcile-view.ts features/shipments/reconcile-view.test.ts
git commit -m "feat(reconcile): action disputeWithCarrier + view expose deltaVndAtReview/disputing"
```

---

### Task 3: Report — state đang-đòi/đã-duyệt

**Files:**
- Modify: `features/shipments/carrier-error-report.ts` (+ test)

- [ ] **Step 1: Test** — thêm vào `carrier-error-report.test.ts`: `CarrierErrorRow` có `state`; `summariseCarrierErrors` chạy trên rows `state==='approved'` vẫn đúng (lọc do caller). Thêm field `state` vào helper `row()` default `'approved'`. Giữ các test cũ xanh.

- [ ] **Step 2: Sửa `carrier-error-report.ts`**
- `CarrierErrorRow` += `state: 'disputing' | 'approved';`.
- `listCarrierErrors`: `.where(inArray(schema.shipmentReconcileStatus.status, ['carrier_error', 'disputing']))` (import `inArray`); map `state: r.status === 'disputing' ? 'disputing' : 'approved'`. Cần select thêm `status: schema.shipmentReconcileStatus.status`.
- `summariseCarrierErrors` **không đổi** (vẫn nhận rows; caller lọc theo state).

- [ ] **Step 3:** Run test → PASS; `npx tsc --noEmit` sạch. **Commit**
```bash
git add features/shipments/carrier-error-report.ts features/shipments/carrier-error-report.test.ts
git commit -m "feat(reconcile): report đọc cả đang-đòi + đã-duyệt (state)"
```

---

### Task 4: UI panel (flow theo khoản + đòi) + table (filter/badge/stat)

**Files:**
- Modify: `components/shipping-reconcile/ReconcileDetailPanel.tsx`
- Modify: `components/shipping-reconcile/ReconcileTable.tsx`

- [ ] **Step 1: Panel — imports + state.** Thêm:
```ts
import { disputeWithCarrier } from '@/features/shipments/reconcile-status-actions';
import { carrierErrorKindRemediation } from '@/features/shipments/carrier-error-kinds';
import { suggestCauseKind, needsCarrierClaim, isApprovableMatch } from '@/features/shipments/carrier-error-flow';
```
Trong `ReconcileActions`, khởi tạo kind từ gợi ý:
```ts
  const [kind, setKind] = useState(() => suggestCauseKind(row.diagnosis));
```
Thêm handler:
```ts
  async function dispute() {
    if (!note.trim() || !kind) return;
    setBusy(true);
    try {
      await disputeWithCarrier({ shipmentId: row.shipmentId, kind, note: note.trim(), billedTotal: row.billedTotal, deltaVnd: row.deltaVnd ?? 0 });
    } finally { setBusy(false); }
  }
  async function approveDispute() {
    setBusy(true);
    try {
      await approveCarrierError({ shipmentId: row.shipmentId, kind: row.carrierErrorKind ?? kind, note: row.note ?? note.trim(), billedTotal: row.billedTotal, deltaVnd: row.deltaVndAtReview ?? row.deltaVnd ?? 0 });
    } finally { setBusy(false); }
  }
```

- [ ] **Step 2: Panel — nhánh `disputing` (đặt TRƯỚC `if (row.status !== 'pending')` hoặc gộp vào).** Khi `row.status === 'disputing'`:
```tsx
  if (row.status === 'disputing') {
    const ready = isApprovableMatch(row.diagnosis?.severity);
    return (
      <div className="mt-4 space-y-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
        <div className="font-medium text-sky-600 dark:text-sky-400">
          ⏳ Đang đòi NCC — {carrierErrorKindLabel(row.carrierErrorKind ?? '')} · lệch gốc {fmtVnd(row.deltaVndAtReview)}đ
        </div>
        {row.note && <div className="text-muted-foreground">Ghi chú: {row.note}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !ready}
            title={!ready ? 'Chờ NCC sửa bill cho khớp mới duyệt được' : undefined}
            onClick={approveDispute}
            className="rounded border border-emerald-500/50 px-3 py-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            ✓ Duyệt chênh lệch
          </button>
          {!ready && <span className="text-xs text-muted-foreground">Chờ NCC sửa bill cho khớp…</span>}
          <button type="button" disabled={busy} onClick={undo}
            className="ml-auto rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Hoàn tác</button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Panel — nhánh đóng (`carrier_error`/`reconciled`/`ignored`) giữ như hiện có** (đã có 3-way label). Không cần đổi.

- [ ] **Step 4: Panel — nhánh pending KHỚP (isClean) giữ nguyên** ("✓ Xác nhận khớp" + "Bỏ qua").

- [ ] **Step 5: Panel — nhánh pending LỆCH: thay cụm nút.** Bỏ nút "Đã xử lý". Sau textarea:
```tsx
      <select value={kind} onChange={(e) => setKind(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
        <option value="">— chọn loại lỗi cụ thể —</option>
        {CARRIER_ERROR_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      {kind && (
        <p className="text-xs text-muted-foreground">💡 {carrierErrorKindRemediation(kind)}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {needsCarrierClaim(row.deltaVnd) ? (
          <button type="button" disabled={busy || noteEmpty || !kind}
            title={!kind ? 'Chọn loại lỗi' : noteEmpty ? 'Cần ghi lý do' : undefined}
            onClick={dispute}
            className="rounded border border-amber-500/50 px-3 py-1 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            Đối soát lại với NCC →
          </button>
        ) : (
          <button type="button" disabled={busy || noteEmpty || !kind}
            title={!kind ? 'Chọn loại lỗi' : noteEmpty ? 'Cần ghi lý do' : undefined}
            onClick={approve}
            className="rounded border border-emerald-500/50 px-3 py-1 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            ✓ Duyệt chênh lệch
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => act('ignored')}
          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Bỏ qua</button>
        {needsCarrierClaim(row.deltaVnd) && (
          <span className="w-full text-xs text-muted-foreground">NCC thu vượt {fmtVnd(row.deltaVnd)}đ — đòi lại; duyệt được khi bill mới khớp.</span>
        )}
      </div>
```
Bỏ phần `mode`/carrier sub-flow cũ + nút "Đã xử lý"/"Lỗi carrier →" của lần trước. Giữ textarea + label. Bỏ state `mode` không dùng nữa.

- [ ] **Step 6: `ReconcileTable.tsx`** — `StatusFilter` += `'disputing'`; option `<option value="disputing">Đang đòi NCC</option>`; `OPERATOR_STATUS` += `disputing: { label: 'Đang đòi NCC', className: 'border border-sky-500/40 text-sky-600 dark:text-sky-400' }`. Thêm Stat đếm disputing:
```tsx
  // trong summary useMemo: thêm disputingCount
  let ... , disputingCount = 0;
  ... if (r.status === 'disputing') disputingCount += 1;
  // render thêm: <Stat label="Đang đòi NCC" value={String(summary.disputingCount)} />
```

- [ ] **Step 7:** `npx tsc --noEmit` + `npx eslint components/shipping-reconcile/` sạch. **Commit**
```bash
git add components/shipping-reconcile/ReconcileDetailPanel.tsx components/shipping-reconcile/ReconcileTable.tsx
git commit -m "feat(reconcile): UI chọn lỗi cụ thể + đòi NCC (disputing) + gate duyệt khi khớp"
```

---

### Task 5: Modal tab tách đang-đòi/đã-duyệt + CSV state + page wiring + migration + push

**Files:**
- Modify: `components/shipping-reconcile/ReconcileIssuesModal.tsx`
- Modify: `app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts`
- Modify: `app/(dashboard)/f/shipping-reconcile/page.tsx`
- Run: `scripts/migrate-reconcile-disputing.ts`

- [ ] **Step 1: Modal tab "Lỗi carrier" — tách 2 mục.** Trong nhánh `tab === 'carrier'`, chia `carrierErrors` theo state:
```tsx
const disputing = carrierErrors.filter((r) => r.state === 'disputing');
const approved = carrierErrors.filter((r) => r.state === 'approved');
```
Header tab dùng `carrierErrors.length` (tổng). Render: mục "⏳ Đang đòi NCC ({disputing.length} · Σ lệch gốc {fmtVnd(Σ)}đ)" liệt kê từng `disputing` row; rồi mục "✓ Đã duyệt ({approved.length})" dùng `carrierErrorGroups` + list `approved`. Mỗi dòng thêm badge state (sky cho đang đòi, amber cho đã duyệt). Nút Xuất CSV giữ nguyên.

- [ ] **Step 2: CSV** — `carrier-errors.csv/route.ts`: HEADER thêm `'state'` (sau `kind`); map thêm `r.state === 'disputing' ? 'đang đòi' : 'đã duyệt'`.

- [ ] **Step 3: page.tsx** — không đổi cấu trúc (listCarrierErrors giờ trả cả 2 state); `summariseCarrierErrors(carrierErrors.filter((r) => r.state === 'approved'))` để groups chỉ gồm đã-duyệt. Cập nhật dòng:
```ts
  const carrierErrorGroups = summariseCarrierErrors(carrierErrors.filter((r) => r.state === 'approved'));
```

- [ ] **Step 4: Migration thật**
```bash
dotenv -- npx tsx scripts/migrate-reconcile-disputing.ts
```
Kỳ vọng "OK: reconcile_status thêm disputing."

- [ ] **Step 5: Tổng kiểm** `npx tsc --noEmit && npx vitest run && npx eslint . && npx next build` — xanh.

- [ ] **Step 6: Smoke DB** xác nhận enum:
```bash
dotenv -- npx tsx -e "import {db} from './db/client'; import {sql} from 'drizzle-orm'; (async()=>{const e=await db.execute(sql\`select unnest(enum_range(null::reconcile_status))::text v\`); console.log((e.rows??e).map(r=>r.v).join(',')); process.exit(0)})()"
```
Kỳ vọng có `disputing`.

- [ ] **Step 7: Commit + push**
```bash
git add -A
git commit -m "feat(reconcile): report tab tách đang-đòi/đã-duyệt + CSV state + wiring + migration"
git push origin main
```

---

## Self-Review
- **Spec coverage:** §1 kinds→T1; §2 helper→T1; §3 enum/migration→T1; §4 action→T2; §5 view→T2; §6 panel→T4; §7 table→T4; §8 report→T3/T5; §9 tests→T1/T2/T3; §10 migration→T5. Đủ.
- **Type consistency:** `disputeWithCarrier`, `suggestCauseKind/needsCarrierClaim/isApprovableMatch`, `carrierErrorKindRemediation`, `deltaVndAtReview`, `state` nhất quán.
- **Placeholder scan:** không có TBD.
