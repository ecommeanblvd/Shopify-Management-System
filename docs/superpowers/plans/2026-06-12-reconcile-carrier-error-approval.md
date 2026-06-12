# Duyệt lỗi carrier trong đối soát ship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm trạng thái thứ 3 `carrier_error` ("Duyệt — lỗi carrier") cấp đơn trong đối soát ship, kèm loại lỗi + lý do bắt buộc, và report tổng hợp (tab trong modal + xuất CSV).

**Architecture:** Mở rộng `shipment_reconcile_status` (enum + 2 cột snapshot) thay vì bảng mới; report là truy vấn sống các dòng `carrier_error`. Logic thuần (kinds, summarise) tách file để TDD; UI tái dùng `ReconcileDetailPanel`/`ReconcileIssuesModal`/`csvBody`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Postgres/Supabase), React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-reconcile-carrier-error-approval-design.md`

---

### Task 1: Schema + migration + loại lỗi (kinds)

**Files:**
- Modify: `db/schema.ts:836` (enum) và `:840-853` (bảng `shipmentReconcileStatus`)
- Create: `scripts/migrate-carrier-error-approval.ts`
- Create: `features/shipments/carrier-error-kinds.ts`
- Test: `features/shipments/carrier-error-kinds.test.ts`

- [ ] **Step 1: Sửa enum + bảng trong `db/schema.ts`**

Dòng 836 — thêm giá trị enum:
```ts
export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error']);
```
Trong `shipmentReconcileStatus` (sau `billedTotalAtReview`, dòng ~850) thêm 2 cột:
```ts
  /** Loại lỗi carrier — chỉ set khi status='carrier_error'. */
  carrierErrorKind: text('carrier_error_kind'),
  /** Snapshot deltaVnd (billed−engine) lúc duyệt — report đúng kể cả khi bill import lại. */
  deltaVndAtReview: numeric('delta_vnd_at_review', { precision: 16, scale: 2 }),
```

- [ ] **Step 2: Viết script migration `scripts/migrate-carrier-error-approval.ts`**

```ts
/**
 * Migration một lần: thêm enum value 'carrier_error' + 2 cột snapshot vào
 * shipment_reconcile_status. Enum ADD VALUE phải chạy NGOÀI transaction và
 * trước khi dùng → tách statement. Idempotent (IF NOT EXISTS).
 *
 * Chạy: dotenv -- tsx scripts/migrate-carrier-error-approval.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main() {
  await db.execute(sql`ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'carrier_error'`);
  await db.execute(sql`ALTER TABLE shipment_reconcile_status ADD COLUMN IF NOT EXISTS carrier_error_kind text`);
  await db.execute(sql`ALTER TABLE shipment_reconcile_status ADD COLUMN IF NOT EXISTS delta_vnd_at_review numeric(16,2)`);
  console.log('OK: carrier_error enum + cột snapshot đã thêm.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
(KHÔNG tự chạy ở task này — chạy ở Task 5 cùng baseline. Engine không gọi enum mới khi build nên an toàn.)

- [ ] **Step 3: Viết test `carrier-error-kinds.test.ts` (fail trước)**

```ts
import { describe, it, expect } from 'vitest';
import { isCarrierErrorKind, carrierErrorKindLabel, CARRIER_ERROR_KINDS } from './carrier-error-kinds';

describe('carrier-error-kinds', () => {
  it('có đủ 6 loại, value duy nhất', () => {
    expect(CARRIER_ERROR_KINDS).toHaveLength(6);
    expect(new Set(CARRIER_ERROR_KINDS.map((k) => k.value)).size).toBe(6);
  });
  it('isCarrierErrorKind nhận value hợp lệ, loại value lạ', () => {
    expect(isCarrierErrorKind('weight')).toBe(true);
    expect(isCarrierErrorKind('zone')).toBe(true);
    expect(isCarrierErrorKind('bogus')).toBe(false);
    expect(isCarrierErrorKind('')).toBe(false);
  });
  it('carrierErrorKindLabel trả label, fallback chính value khi lạ', () => {
    expect(carrierErrorKindLabel('weight')).toBe('Sai cân');
    expect(carrierErrorKindLabel('bogus')).toBe('bogus');
  });
});
```

- [ ] **Step 4: Chạy test → FAIL** (`npx vitest run features/shipments/carrier-error-kinds.test.ts`) — "Cannot find module".

- [ ] **Step 5: Viết `features/shipments/carrier-error-kinds.ts`**

```ts
/** Phân loại lỗi carrier (FedEx/DHL tính sai) cho nút "Duyệt" — dùng chung
 *  UI dropdown + validate server. Cố định, nhỏ. */
export const CARRIER_ERROR_KINDS = [
  { value: 'weight', label: 'Sai cân' },
  { value: 'zone', label: 'Sai zone' },
  { value: 'surcharge', label: 'Phụ phí sai (demand/ký nhận/remote)' },
  { value: 'fuel', label: 'Lệch % fuel' },
  { value: 'ratecard', label: 'Sai rate card / chiết khấu' },
  { value: 'other', label: 'Khác' },
] as const;

export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number]['value'];

export function isCarrierErrorKind(v: string): v is CarrierErrorKind {
  return CARRIER_ERROR_KINDS.some((k) => k.value === v);
}

export function carrierErrorKindLabel(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.label ?? v;
}
```

- [ ] **Step 6: Chạy test → PASS.**

- [ ] **Step 7: Commit**
```bash
git add db/schema.ts scripts/migrate-carrier-error-approval.ts features/shipments/carrier-error-kinds.ts features/shipments/carrier-error-kinds.test.ts
git commit -m "feat(reconcile): schema carrier_error + loại lỗi carrier (kinds)"
```

---

### Task 2: Action duyệt + view layer

**Files:**
- Modify: `features/shipments/reconcile-status-actions.ts`
- Modify: `features/shipments/reconcile-view.ts`
- Test: `features/shipments/reconcile-view.test.ts` (thêm case)

- [ ] **Step 1: Thêm case test cho `mergeStatus` trong `reconcile-view.test.ts`**

Tìm test `mergeStatus` hiện có, thêm:
```ts
it('dòng carrier_error mang status + carrierErrorKind; dòng khác kind=null', () => {
  const base = [{ shipmentId: 'a' }, { shipmentId: 'b' }] as unknown as ReconcileRow[];
  const map = new Map<string, StatusRecord>([
    ['a', { status: 'carrier_error', note: 'FedEx sai cân', carrierErrorKind: 'weight', deltaVndAtReview: 120000, billedTotalAtReview: 500000 }],
  ]);
  const rows = mergeStatus(base, map);
  expect(rows[0].status).toBe('carrier_error');
  expect(rows[0].carrierErrorKind).toBe('weight');
  expect(rows[1].status).toBe('pending');
  expect(rows[1].carrierErrorKind).toBeNull();
});
```
(Import `StatusRecord`, `ReconcileRow` nếu chưa.)

- [ ] **Step 2: Chạy test → FAIL** (carrierErrorKind không tồn tại / type lỗi).

- [ ] **Step 3: Sửa `reconcile-view.ts`**

- `ReconcileStatus` (dòng 14):
```ts
export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error';
```
- `StatusRecord` (dòng 16-20):
```ts
export interface StatusRecord {
  status: 'reconciled' | 'ignored' | 'carrier_error';
  note: string | null;
  billedTotalAtReview: number | null;
  carrierErrorKind: string | null;
  deltaVndAtReview: number | null;
}
```
- `ReconcileViewRow` (dòng 22-30) thêm:
```ts
  carrierErrorKind: string | null;
```
- `mergeStatus` (dòng 44-61) — trong object trả về thêm:
```ts
      status: (rec?.status ?? 'pending') as ReconcileStatus,
      carrierErrorKind: rec?.carrierErrorKind ?? null,
```
- `reconcileShipmentsWithStatus` select (dòng 78-84) thêm 2 cột; map (dòng 87-93) thêm:
```ts
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      status: schema.shipmentReconcileStatus.status,
      note: schema.shipmentReconcileStatus.note,
      billedTotalAtReview: schema.shipmentReconcileStatus.billedTotalAtReview,
      carrierErrorKind: schema.shipmentReconcileStatus.carrierErrorKind,
      deltaVndAtReview: schema.shipmentReconcileStatus.deltaVndAtReview,
    })
    ...
    map.set(s.shipmentId, {
      status: s.status,
      note: s.note,
      billedTotalAtReview: s.billedTotalAtReview !== null ? Number(s.billedTotalAtReview) : null,
      carrierErrorKind: s.carrierErrorKind ?? null,
      deltaVndAtReview: s.deltaVndAtReview !== null ? Number(s.deltaVndAtReview) : null,
    });
```

- [ ] **Step 4: Chạy test → PASS.**

- [ ] **Step 5: Thêm action `approveCarrierError` vào `reconcile-status-actions.ts`**

Import thêm: `import { isCarrierErrorKind } from './carrier-error-kinds';`

```ts
export interface ApproveCarrierErrorInput {
  shipmentId: string;
  kind: string;
  note: string;
  billedTotal: number;
  deltaVnd: number;
}

/** Logistics duyệt: khoản này lệch THẬT do carrier tính sai. Trạng thái cuối
 *  (đơn rời pending). Loại lỗi + lý do bắt buộc; snapshot delta để report. */
export async function approveCarrierError(input: ApproveCarrierErrorInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do lỗi carrier');
  if (!isCarrierErrorKind(input.kind)) throw new Error('Loại lỗi không hợp lệ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: 'carrier_error',
      note,
      carrierErrorKind: input.kind,
      billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'carrier_error',
        note,
        carrierErrorKind: input.kind,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}
```

- [ ] **Step 6: Dọn snapshot khi đổi khỏi carrier_error trong `setReconcileStatus`**

Trong `setReconcileStatus`, nhánh `values` và `set` (dòng ~36-50) thêm reset 2 cột (vì reconciled/ignored không phải lỗi carrier):
```ts
      // values:
      carrierErrorKind: null,
      deltaVndAtReview: null,
      // set:
        carrierErrorKind: null,
        deltaVndAtReview: null,
```

- [ ] **Step 7: Chạy `npx vitest run features/shipments/` + `npx tsc --noEmit` → xanh. Commit**
```bash
git add features/shipments/reconcile-status-actions.ts features/shipments/reconcile-view.ts features/shipments/reconcile-view.test.ts
git commit -m "feat(reconcile): action approveCarrierError + view expose carrierErrorKind"
```

---

### Task 3: Report domain (pure summarise + reader)

**Files:**
- Create: `features/shipments/carrier-error-report.ts`
- Test: `features/shipments/carrier-error-report.test.ts`

- [ ] **Step 1: Viết test `carrier-error-report.test.ts` (fail trước)**

```ts
import { describe, it, expect } from 'vitest';
import { summariseCarrierErrors, type CarrierErrorRow } from './carrier-error-report';

const row = (over: Partial<CarrierErrorRow>): CarrierErrorRow => ({
  shipmentId: 's', carrierKey: 'fedex', orderName: null, tracking: null,
  shipCountry: null, labelDate: null, kind: 'weight', note: 'x',
  billedVnd: null, deltaVnd: 100, approvedByName: null, approvedAt: new Date(0), ...over,
});

describe('summariseCarrierErrors', () => {
  it('rỗng → []', () => expect(summariseCarrierErrors([])).toEqual([]));

  it('gom theo carrier, cộng delta, null→0', () => {
    const g = summariseCarrierErrors([
      row({ carrierKey: 'fedex', deltaVnd: 100, kind: 'weight' }),
      row({ carrierKey: 'fedex', deltaVnd: null, kind: 'zone' }),
      row({ carrierKey: 'dhl', deltaVnd: 50, kind: 'weight' }),
    ]);
    const fedex = g.find((x) => x.carrierKey === 'fedex')!;
    const dhl = g.find((x) => x.carrierKey === 'dhl')!;
    expect(fedex.count).toBe(2);
    expect(fedex.sumDeltaVnd).toBe(100);
    expect(dhl.sumDeltaVnd).toBe(50);
  });

  it('byKind theo thứ tự CARRIER_ERROR_KINDS', () => {
    const g = summariseCarrierErrors([
      row({ carrierKey: 'fedex', kind: 'zone', deltaVnd: 10 }),
      row({ carrierKey: 'fedex', kind: 'weight', deltaVnd: 20 }),
    ]);
    expect(g[0].byKind.map((k) => k.kind)).toEqual(['weight', 'zone']);
    expect(g[0].byKind[0].sumDeltaVnd).toBe(20);
  });
});
```

- [ ] **Step 2: Chạy test → FAIL.**

- [ ] **Step 3: Viết `features/shipments/carrier-error-report.ts`**

```ts
/**
 * Report các đơn đã DUYỆT là lỗi carrier (status='carrier_error'). Không có
 * bảng report riêng — đọc sống từ shipment_reconcile_status (snapshot delta).
 * summariseCarrierErrors là thuần để TDD.
 */
import { db, schema } from '@/db/client';
import { desc, eq } from 'drizzle-orm';
import { CARRIER_ERROR_KINDS } from './carrier-error-kinds';

export interface CarrierErrorRow {
  shipmentId: string;
  carrierKey: string | null;
  orderName: string | null;
  tracking: string | null;
  shipCountry: string | null;
  labelDate: Date | null;
  kind: string;
  note: string;
  billedVnd: number | null;
  deltaVnd: number | null;
  approvedByName: string | null;
  approvedAt: Date;
}

export interface CarrierErrorGroup {
  carrierKey: string | null;
  count: number;
  sumDeltaVnd: number;
  byKind: Array<{ kind: string; count: number; sumDeltaVnd: number }>;
}

const KIND_ORDER = CARRIER_ERROR_KINDS.map((k) => k.value);

/** Gom theo carrier (thứ tự xuất hiện đầu), rồi theo kind (thứ tự CARRIER_ERROR_KINDS). */
export function summariseCarrierErrors(rows: CarrierErrorRow[]): CarrierErrorGroup[] {
  const byCarrier = new Map<string | null, CarrierErrorRow[]>();
  for (const r of rows) {
    const list = byCarrier.get(r.carrierKey) ?? [];
    list.push(r);
    byCarrier.set(r.carrierKey, list);
  }
  const out: CarrierErrorGroup[] = [];
  for (const [carrierKey, list] of byCarrier) {
    const kindMap = new Map<string, { count: number; sumDeltaVnd: number }>();
    let sum = 0;
    for (const r of list) {
      const d = r.deltaVnd ?? 0;
      sum += d;
      const k = kindMap.get(r.kind) ?? { count: 0, sumDeltaVnd: 0 };
      k.count += 1;
      k.sumDeltaVnd += d;
      kindMap.set(r.kind, k);
    }
    const byKind = [...kindMap.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => {
        const ia = KIND_ORDER.indexOf(a.kind), ib = KIND_ORDER.indexOf(b.kind);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    out.push({ carrierKey, count: list.length, sumDeltaVnd: sum, byKind });
  }
  return out;
}

/** Đọc các đơn đã duyệt lỗi carrier — join shipments/orders/user. */
export async function listCarrierErrors(): Promise<CarrierErrorRow[]> {
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      carrierKey: schema.shipments.carrierKey,
      orderName: schema.shopifyOrders.shopifyOrderNumber,
      tracking: schema.shipments.trackingNumber,
      shipCountry: schema.shopifyOrders.shipCountry,
      labelDate: schema.shipments.labelCreatedAt,
      kind: schema.shipmentReconcileStatus.carrierErrorKind,
      note: schema.shipmentReconcileStatus.note,
      billedVnd: schema.shipmentReconcileStatus.billedTotalAtReview,
      deltaVnd: schema.shipmentReconcileStatus.deltaVndAtReview,
      approvedByName: schema.user.name,
      approvedAt: schema.shipmentReconcileStatus.reconciledAt,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .leftJoin(schema.user, eq(schema.user.id, schema.shipmentReconcileStatus.reconciledBy))
    .where(eq(schema.shipmentReconcileStatus.status, 'carrier_error'))
    .orderBy(desc(schema.shipmentReconcileStatus.reconciledAt));
  return rows.map((r) => ({
    shipmentId: r.shipmentId,
    carrierKey: r.carrierKey,
    orderName: r.orderName ?? null,
    tracking: r.tracking ?? null,
    shipCountry: r.shipCountry ?? null,
    labelDate: r.labelDate ?? null,
    kind: r.kind ?? 'other',
    note: r.note ?? '',
    billedVnd: r.billedVnd !== null ? Number(r.billedVnd) : null,
    deltaVnd: r.deltaVnd !== null ? Number(r.deltaVnd) : null,
    approvedByName: r.approvedByName ?? null,
    approvedAt: r.approvedAt,
  }));
}
```
(Xác minh tên cột `schema.user.name`, `shipments.labelCreatedAt`, `shopifyOrders.shopifyOrderNumber`/`shipCountry` — đã có trong schema.)

- [ ] **Step 4: Chạy test → PASS. `npx tsc --noEmit` xanh. Commit**
```bash
git add features/shipments/carrier-error-report.ts features/shipments/carrier-error-report.test.ts
git commit -m "feat(reconcile): report lỗi carrier (summarise thuần + reader)"
```

---

### Task 4: UI cấp đơn (panel) + bảng (table)

**Files:**
- Modify: `components/shipping-reconcile/ReconcileDetailPanel.tsx`
- Modify: `components/shipping-reconcile/ReconcileTable.tsx`

- [ ] **Step 1: `ReconcileDetailPanel.tsx` — import + state**

Đầu file thêm:
```ts
import { approveCarrierError } from '@/features/shipments/reconcile-status-actions';
import { CARRIER_ERROR_KINDS, carrierErrorKindLabel } from '@/features/shipments/carrier-error-kinds';
```
Trong `ReconcileActions`, sau `const [note, setNote] = ...`:
```ts
  const [kind, setKind] = useState('');
```

- [ ] **Step 2: Hàm duyệt + nhánh đã-duyệt**

Thêm trong `ReconcileActions`:
```ts
  async function approve() {
    if (!note.trim() || !kind) return;
    setBusy(true);
    try {
      await approveCarrierError({
        shipmentId: row.shipmentId, kind, note: note.trim(),
        billedTotal: row.billedTotal, deltaVnd: row.deltaVnd ?? 0,
      });
    } finally { setBusy(false); }
  }
```
Sửa nhánh `row.status !== 'pending'` để hỗ trợ carrier_error: thay đoạn `<span>` trạng thái bằng:
```tsx
        <span className={
          row.status === 'reconciled' ? 'text-emerald-600 dark:text-emerald-400 font-medium'
          : row.status === 'carrier_error' ? 'text-amber-600 dark:text-amber-400 font-medium'
          : 'text-muted-foreground font-medium'
        }>
          {row.status === 'reconciled' ? '✓ Đã đối soát'
            : row.status === 'carrier_error' ? `✓ Đã duyệt — lỗi carrier (${carrierErrorKindLabel(row.carrierErrorKind ?? '')})`
            : 'Đã bỏ qua'}
          {row.billedChangedSinceReview ? ' — ⚠ billed đã thay đổi sau khi review' : ''}
        </span>
```

- [ ] **Step 3: Thêm dropdown loại lỗi + nút Duyệt (nhánh pending)**

Trong khối `return` pending (sau textarea, trước/trong hàng nút), thêm select + nút thứ 3:
```tsx
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || noteMissing} title={noteMissing ? 'Cần ghi chú xử lý' : undefined}
          onClick={() => act('reconciled')}
          className="rounded border border-emerald-500/50 px-3 py-1 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40">
          ✓ Đã đối soát
        </button>
        <button type="button" disabled={busy} onClick={() => act('ignored')}
          className="rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
          Bỏ qua
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">— loại lỗi carrier —</option>
          {CARRIER_ERROR_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <button type="button" disabled={busy || note.trim().length === 0 || !kind}
          title={!kind ? 'Chọn loại lỗi + ghi lý do' : note.trim().length === 0 ? 'Cần ghi lý do' : undefined}
          onClick={approve}
          className="rounded border border-amber-500/50 px-3 py-1 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">
          Duyệt (lỗi carrier)
        </button>
      </div>
```
(Thay thế cụm nút cũ — gộp 2 nút cũ + cụm Duyệt vào 1 hàng; giữ dòng cảnh báo `noteMissing` bên dưới. Đổi label nhắc ở textarea để gợi ý cả "duyệt lỗi carrier": ví dụ thêm "— hoặc chọn loại lỗi + lý do rồi bấm Duyệt nếu là lỗi carrier".)

- [ ] **Step 4: `ReconcileTable.tsx` — filter + badge + props modal**

- `StatusFilter` (dòng 17):
```ts
type StatusFilter = 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error';
```
- Thêm option (sau "Bỏ qua", dòng ~138):
```tsx
          <option value="carrier_error">Lỗi carrier</option>
```
- `OPERATOR_STATUS` (dòng ~212) thêm:
```ts
  carrier_error: { label: 'Lỗi carrier', className: 'border border-amber-500/40 text-amber-600 dark:text-amber-400' },
```
- Props component nhận thêm `carrierErrors` + `carrierErrorGroups` và truyền vào `ReconcileIssuesModal` (dòng ~144):
```tsx
          <ReconcileIssuesModal openIssues={openIssues} reports={reports}
            carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups} />
```
Cập nhật type props của `ReconcileTable` import `CarrierErrorRow`, `CarrierErrorGroup` từ `@/features/shipments/carrier-error-report`.

- [ ] **Step 5: `npx tsc --noEmit && npx eslint components/shipping-reconcile/` → sạch. Commit**
```bash
git add components/shipping-reconcile/ReconcileDetailPanel.tsx components/shipping-reconcile/ReconcileTable.tsx
git commit -m "feat(reconcile): UI nút Duyệt lỗi carrier + filter/badge trạng thái"
```

---

### Task 5: Report UI (tab + CSV) + page wiring + migration & verify

**Files:**
- Modify: `components/shipping-reconcile/ReconcileIssuesModal.tsx`
- Create: `app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts`
- Modify: `app/(dashboard)/f/shipping-reconcile/page.tsx`
- Run: `scripts/migrate-carrier-error-approval.ts`

- [ ] **Step 1: `ReconcileIssuesModal.tsx` — props + tab thứ 3**

Import:
```ts
import { carrierErrorKindLabel } from '@/features/shipments/carrier-error-kinds';
import type { CarrierErrorRow, CarrierErrorGroup } from '@/features/shipments/carrier-error-report';
```
`Props` thêm `carrierErrors: CarrierErrorRow[]`, `carrierErrorGroups: CarrierErrorGroup[]`.
`tab` union thêm `'carrier'`: `useState<'issues' | 'reports' | 'carrier'>('issues')`.
Thêm `TabButton` thứ 3:
```tsx
                <TabButton active={tab === 'carrier'} onClick={() => setTab('carrier')}>
                  Lỗi carrier ({carrierErrors.length})
                </TabButton>
```
Thêm nhánh render khi `tab === 'carrier'`:
```tsx
            ) : tab === 'carrier' ? (
              <div>
                <div className="flex items-center justify-between border-b border-border px-5 py-2">
                  <span className="text-xs text-muted-foreground">Các đơn đã duyệt là lỗi carrier (FedEx/DHL tính sai).</span>
                  <a href="/f/shipping-reconcile/carrier-errors.csv" download
                    className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted">Xuất CSV</a>
                </div>
                {carrierErrorGroups.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Chưa có đơn lỗi carrier nào được duyệt.</p>
                )}
                {carrierErrorGroups.map((g) => (
                  <div key={g.carrierKey ?? '—'} className="px-5 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                      <span className="uppercase">{g.carrierKey ?? '—'}</span>
                      <span className="font-mono text-xs text-muted-foreground">{g.count} đơn · Σ lệch {fmtVnd(g.sumDeltaVnd)} đ</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {g.byKind.map((k) => (
                        <span key={k.kind}>{carrierErrorKindLabel(k.kind)}: {k.count} ({fmtVnd(k.sumDeltaVnd)} đ)</span>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="divide-y divide-border border-t border-border">
                  {carrierErrors.map((r) => (
                    <div key={r.shipmentId} className="px-5 py-2 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{r.orderName ?? r.tracking ?? r.shipmentId.slice(0, 8)}</span>
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">{carrierErrorKindLabel(r.kind)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{(r.carrierKey ?? '—').toUpperCase()} · {r.shipCountry ?? '—'} · lệch {fmtVnd(r.deltaVnd)} đ</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.approvedByName ?? 'Logistics'} · {new Date(r.approvedAt).toLocaleString('vi-VN')}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
```
(Chèn nhánh này vào đúng chỗ ternary `tab === 'issues' ? (...) : (...)` hiện có — đổi thành `issues ? ... : carrier ? ... : reports`.)

- [ ] **Step 2: Route CSV `carrier-errors.csv/route.ts`**

```ts
/** GET /f/shipping-reconcile/carrier-errors.csv → các đơn đã duyệt lỗi carrier. */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { listCarrierErrors } from '@/features/shipments/carrier-error-report';
import { carrierErrorKindLabel } from '@/features/shipments/carrier-error-kinds';

export const dynamic = 'force-dynamic';

const HEADER = ['order', 'tracking', 'carrier', 'country', 'label_date', 'kind', 'reason', 'billed_vnd', 'delta_vnd', 'approved_by', 'approved_at'];

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new Response('Forbidden', { status: 403 });

  const rows = await listCarrierErrors();
  const out: CsvValue[][] = rows.map((r) => [
    r.orderName, r.tracking, r.carrierKey, r.shipCountry,
    r.labelDate ? r.labelDate.toISOString().slice(0, 10) : null,
    carrierErrorKindLabel(r.kind), r.note, r.billedVnd, r.deltaVnd,
    r.approvedByName, r.approvedAt.toISOString().slice(0, 19).replace('T', ' '),
  ]);

  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="carrier-errors.csv"',
      'cache-control': 'no-store',
    },
  });
}
```

- [ ] **Step 3: `page.tsx` wiring**

Import `listCarrierErrors, summariseCarrierErrors` từ `@/features/shipments/carrier-error-report`. Sửa `Promise.all` (dòng 25-27):
```ts
  const [{ rows, computedAt }, reports, carrierErrors] = await Promise.all([
    reconcileShipmentsWithStatus({ forceRecompute: sp.refresh === '1' }),
    listIssueReports(),
    listCarrierErrors(),
  ]);
  const carrierErrorGroups = summariseCarrierErrors(carrierErrors);
```
Truyền xuống (dòng 41):
```tsx
      <ReconcileTable rows={rows} reports={reports} carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups} />
```

- [ ] **Step 4: Chạy migration thật (production, có `.env`)**
```bash
dotenv -- npx tsx scripts/migrate-carrier-error-approval.ts
```
Kỳ vọng: "OK: carrier_error enum + cột snapshot đã thêm."

- [ ] **Step 5: Tổng kiểm**
```bash
npx tsc --noEmit && npx vitest run && npx eslint . && npx next build
```
Kỳ vọng: tsc sạch, tests xanh, eslint sạch, build pass.

- [ ] **Step 6: Smoke DB thật** — query xác nhận enum + cột:
```bash
dotenv -- npx tsx -e "import {db} from './db/client'; import {sql} from 'drizzle-orm'; (async()=>{const e=await db.execute(sql\`select unnest(enum_range(null::reconcile_status))::text as v\`); console.log(e.rows ?? e); process.exit(0)})()"
```
Kỳ vọng: có `carrier_error`.

- [ ] **Step 7: Commit + push**
```bash
git add -A
git commit -m "feat(reconcile): report lỗi carrier (tab modal + CSV) + page wiring + migration"
git push origin main
```

---

## Self-Review

- **Spec coverage:** §1 schema→T1; §2 kinds→T1; §3 action→T2; §4 view→T2; §5 report→T3; §6 panel→T4; §7 table→T4; §8 modal→T5; §9 CSV→T5; §10 page→T5; §11 tests→T1/T2/T3; §12 migration→T1+T5. Đủ.
- **Type consistency:** `carrierErrorKind`, `deltaVndAtReview`, `CarrierErrorRow`/`CarrierErrorGroup`, `approveCarrierError`, `summariseCarrierErrors`, `listCarrierErrors` nhất quán giữa các task.
- **Placeholder scan:** không có TBD; code đầy đủ từng step.
