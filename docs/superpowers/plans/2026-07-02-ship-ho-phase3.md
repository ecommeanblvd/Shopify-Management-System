# Ship Hộ — Phase 3 (Đối soát cước + Bảng kê + Margin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đối soát cước carrier thực (từ file hoá đơn carrier) vs ước tính engine cho từng đơn ship hộ, xuất bảng kê kỳ cho partner + theo dõi công nợ, và báo cáo margin (lãi thực).

**Architecture:** Reuse các cột reconcile/billing đã có trên `ship_ho_orders` + bảng `ship_ho_statements` (P1). Logic thuần (parse invoice, compute delta/margin, tổng bảng kê) tách file test được; orchestrator + queries mỏng; UI upload đối soát + trang bảng kê. KHÔNG migration mới.

**Tech Stack:** Next.js App Router (server actions), Drizzle ORM (Postgres), Vitest, `xlsx` (đã dùng ở P2), RBAC `requireManageShipHo` (P1).

## Global Constraints

- P1 + P2 đã có: bảng `ship_ho_orders` (cột `carrierCostVnd, chargedVnd, actualCarrierCostVnd, reconcileStatus, deltaVnd, marginVnd, statementId, trackingNumber, partnerBrandSlug, quotedAt, status`), bảng `ship_ho_statements` (`id, partnerBrandSlug, periodStart(date), periodEnd(date), orderCount(int), totalChargedVnd(numeric), status enum draft|issued|paid, issuedAt, paidAt, fileKey, createdAt`), `require-manage.ts` → `requireManageShipHo()`, RBAC `ship_ho:*`.
- **Tiền tệ VND** (0 lẻ). `numeric` đọc/ghi dạng **string**; `timestamp` là `Date`; `date` cột nhận string 'YYYY-MM-DD'.
- **Nguồn cước thực = file hoá đơn carrier riêng** (CSV/Excel), keyed theo `trackingNumber` (đã chốt). KHÔNG dùng LOG-Export.
- Semantics: `deltaVnd = actual − estimate(carrierCostVnd)` (chất lượng engine); `marginVnd = charged(chargedVnd) − actual` (lãi thực). Đơn chưa quote (carrierCostVnd/chargedVnd null) → delta/margin null tương ứng, vẫn ghi `actualCarrierCostVnd` + `reconcileStatus='reconciled'`.
- Bảng kê chỉ gom đơn **có `chargedVnd`** (đã có giá để thu), `statementId` null, `status ∈ {shipped, delivered}`, `quotedAt` trong kỳ.
- Mọi server action ghi dữ liệu phải `requireManageShipHo()`.
- KHÔNG migration (mọi cột đã tồn tại). Chạy trước push: `npx tsc --noEmit` + `npx vitest run` xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `features/ship-ho/reconcile-logic.ts` (+test) | `parseCarrierInvoiceRow` + `computeReconcile` (thuần) |
| `features/ship-ho/reconcile-actions.ts` | `importCarrierInvoice(rows, opts)` — match tracking, ghi actual/delta/margin |
| `features/ship-ho/statement-logic.ts` (+test) | `summarizeStatement(chargedList)` (thuần) |
| `features/ship-ho/statement-actions.ts` | `generateStatement`, `setStatementStatus` |
| `features/ship-ho/statement-queries.ts` | `listShipHoStatements`, `arByPartner`, `getShipHoStatement`, `marginByPartner` |
| `app/(dashboard)/f/ship-ho/reconcile/page.tsx` + `ReconcileUploader.tsx` | UI upload hoá đơn carrier |
| `app/(dashboard)/f/ship-ho/[id]/page.tsx` (modify) | Hiển thị cước thực + delta + margin + reconcileStatus |
| `app/(dashboard)/f/ship-ho/statements/page.tsx` + `StatementsManager.tsx` | Tạo bảng kê + list + công nợ + issue/paid + export xlsx |
| `app/(dashboard)/f/ship-ho/page.tsx` (modify) | Link "Đối soát" + "Bảng kê" |

---

### Task 1: Reconcile logic (thuần)

**Files:**
- Create: `features/ship-ho/reconcile-logic.ts`
- Test: `features/ship-ho/reconcile-logic.test.ts`

**Interfaces:**
- Produces:
  - `CARRIER_INVOICE_COLUMNS` (0-indexed: trackingNumber=0, actualCostVnd=1)
  - `parseCarrierInvoiceRow(row: readonly unknown[]): ParseInvoiceResult`
  - `computeReconcile(input: { estimateVnd: number | null; chargedVnd: number | null; actualVnd: number }): { deltaVnd: number | null; marginVnd: number | null; reconcileStatus: string }`
  - types `ParseInvoiceResult`.

Template file hoá đơn carrier (0-indexed; dòng đầu header): `0 trackingNumber* · 1 actualCostVnd*` (VND). Các cột thừa bị bỏ qua.

- [ ] **Step 1: Write the failing test** `features/ship-ho/reconcile-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';

describe('parseCarrierInvoiceRow', () => {
  it('dòng hợp lệ → ok', () => {
    const r = parseCarrierInvoiceRow(['794000000001', '123,456', 'ghi chú']);
    expect(r).toEqual({ kind: 'ok', trackingNumber: '794000000001', actualCostVnd: 123456 });
  });
  it('dòng rỗng → skip_empty', () => {
    expect(parseCarrierInvoiceRow([null, '']).kind).toBe('skip_empty');
    expect(parseCarrierInvoiceRow([]).kind).toBe('skip_empty');
  });
  it('thiếu tracking → error missing_tracking', () => {
    expect(parseCarrierInvoiceRow(['', '100'])).toEqual({ kind: 'error', reason: 'missing_tracking' });
  });
  it('cost không hợp lệ / âm → error bad_cost', () => {
    expect(parseCarrierInvoiceRow(['T1', 'abc'])).toEqual({ kind: 'error', reason: 'bad_cost' });
    expect(parseCarrierInvoiceRow(['T1', '-5'])).toEqual({ kind: 'error', reason: 'bad_cost' });
  });
  it('cost = 0 hợp lệ', () => {
    expect(parseCarrierInvoiceRow(['T1', '0'])).toEqual({ kind: 'ok', trackingNumber: 'T1', actualCostVnd: 0 });
  });
});

describe('computeReconcile', () => {
  it('đủ estimate + charged → delta = actual−estimate, margin = charged−actual', () => {
    expect(computeReconcile({ estimateVnd: 100000, chargedVnd: 130000, actualVnd: 110000 }))
      .toEqual({ deltaVnd: 10000, marginVnd: 20000, reconcileStatus: 'reconciled' });
  });
  it('chưa quote (estimate null) → delta null; charged null → margin null', () => {
    expect(computeReconcile({ estimateVnd: null, chargedVnd: null, actualVnd: 90000 }))
      .toEqual({ deltaVnd: null, marginVnd: null, reconcileStatus: 'reconciled' });
  });
  it('margin âm khi lỗ (actual > charged)', () => {
    expect(computeReconcile({ estimateVnd: 100000, chargedVnd: 100000, actualVnd: 120000 }))
      .toEqual({ deltaVnd: 20000, marginVnd: -20000, reconcileStatus: 'reconciled' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/reconcile-logic.test.ts`
Expected: FAIL — "Cannot find module './reconcile-logic'".

- [ ] **Step 3: Implement** `features/ship-ho/reconcile-logic.ts`

```ts
/**
 * THUẦN: parse 1 dòng file hoá đơn carrier (tracking + cước thực VND) và tính
 * đối soát (delta engine vs thực, margin thu vs thực). Không I/O.
 */
export const CARRIER_INVOICE_COLUMNS = { trackingNumber: 0, actualCostVnd: 1 } as const;

export type ParseInvoiceResult =
  | { kind: 'ok'; trackingNumber: string; actualCostVnd: number }
  | { kind: 'skip_empty' }
  | { kind: 'error'; reason: 'missing_tracking' | 'bad_cost' };

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}
function numOrNull(v: unknown): number | null {
  const s = str(v).replace(/[,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseCarrierInvoiceRow(row: readonly unknown[]): ParseInvoiceResult {
  if (row.every((c) => str(c) === '')) return { kind: 'skip_empty' };
  const trackingNumber = str(row[CARRIER_INVOICE_COLUMNS.trackingNumber]);
  if (trackingNumber === '') return { kind: 'error', reason: 'missing_tracking' };
  const actualCostVnd = numOrNull(row[CARRIER_INVOICE_COLUMNS.actualCostVnd]);
  if (actualCostVnd == null || actualCostVnd < 0) return { kind: 'error', reason: 'bad_cost' };
  return { kind: 'ok', trackingNumber, actualCostVnd };
}

export function computeReconcile(input: {
  estimateVnd: number | null;
  chargedVnd: number | null;
  actualVnd: number;
}): { deltaVnd: number | null; marginVnd: number | null; reconcileStatus: string } {
  const deltaVnd = input.estimateVnd == null ? null : Math.round(input.actualVnd - input.estimateVnd);
  const marginVnd = input.chargedVnd == null ? null : Math.round(input.chargedVnd - input.actualVnd);
  return { deltaVnd, marginVnd, reconcileStatus: 'reconciled' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/reconcile-logic.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/reconcile-logic.ts features/ship-ho/reconcile-logic.test.ts
git commit -m "feat(ship-ho): reconcile logic thuần (parse invoice + computeReconcile) + test"
```

---

### Task 2: Reconcile orchestrator (import hoá đơn carrier)

**Files:**
- Create: `features/ship-ho/reconcile-actions.ts`

**Interfaces:**
- Consumes: `parseCarrierInvoiceRow`, `computeReconcile` (Task 1); `schema.shipHoOrders`; `requireManageShipHo`.
- Produces: `importCarrierInvoice(rows: readonly unknown[][], opts?: { dryRun?: boolean }): Promise<ReconcileSummary>`; type `ReconcileSummary`.

- [ ] **Step 1: Implement** `features/ship-ho/reconcile-actions.ts`

```ts
'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';

export interface ReconcileSummary {
  total: number;
  matched: number;
  unmatched: number;
  skippedEmpty: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  dryRun: boolean;
}

/**
 * Đối soát cước carrier thực cho đơn ship hộ: match theo trackingNumber, ghi
 * actualCarrierCostVnd + deltaVnd (actual−estimate) + marginVnd (charged−actual)
 * + reconcileStatus. Tracking không khớp → bucket unmatched (không tạo mới).
 */
export async function importCarrierInvoice(
  rows: readonly unknown[][],
  opts?: { dryRun?: boolean },
): Promise<ReconcileSummary> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  const summary: ReconcileSummary = { total: rows.length, matched: 0, unmatched: 0, skippedEmpty: 0, errors: [], dryRun };

  const parsed: Array<{ trackingNumber: string; actualCostVnd: number }> = [];
  rows.forEach((row, i) => {
    const r = parseCarrierInvoiceRow(row);
    if (r.kind === 'ok') parsed.push({ trackingNumber: r.trackingNumber, actualCostVnd: r.actualCostVnd });
    else if (r.kind === 'skip_empty') summary.skippedEmpty += 1;
    else summary.errors.push({ rowIndex: i, reason: r.reason });
  });
  if (parsed.length === 0) return summary;

  const trackings = parsed.map((p) => p.trackingNumber);
  const orders = await db
    .select({
      id: schema.shipHoOrders.id,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
    })
    .from(schema.shipHoOrders)
    .where(inArray(schema.shipHoOrders.trackingNumber, trackings));
  const byTracking = new Map(orders.map((o) => [o.trackingNumber, o]));

  for (const p of parsed) {
    const o = byTracking.get(p.trackingNumber);
    if (!o) { summary.unmatched += 1; continue; }
    summary.matched += 1;
    if (dryRun) continue;
    const rec = computeReconcile({
      estimateVnd: o.carrierCostVnd == null ? null : Number(o.carrierCostVnd),
      chargedVnd: o.chargedVnd == null ? null : Number(o.chargedVnd),
      actualVnd: p.actualCostVnd,
    });
    await db.update(schema.shipHoOrders).set({
      actualCarrierCostVnd: String(p.actualCostVnd),
      deltaVnd: rec.deltaVnd == null ? null : String(rec.deltaVnd),
      marginVnd: rec.marginVnd == null ? null : String(rec.marginVnd),
      reconcileStatus: rec.reconcileStatus,
    }).where(eq(schema.shipHoOrders.id, o.id));
  }

  if (!dryRun) revalidatePath('/f/ship-ho');
  return summary;
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/reconcile-actions.ts
git commit -m "feat(ship-ho): import hoá đơn carrier + đối soát theo tracking"
```

---

### Task 3: Statement logic (thuần)

**Files:**
- Create: `features/ship-ho/statement-logic.ts`
- Test: `features/ship-ho/statement-logic.test.ts`

**Interfaces:**
- Produces: `summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number }`.

- [ ] **Step 1: Write the failing test** `features/ship-ho/statement-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { summarizeStatement } from './statement-logic';

describe('summarizeStatement', () => {
  it('tổng chargedVnd + đếm đơn', () => {
    expect(summarizeStatement([100000, 250000, 50000])).toEqual({ orderCount: 3, totalChargedVnd: 400000 });
  });
  it('rỗng → 0/0', () => {
    expect(summarizeStatement([])).toEqual({ orderCount: 0, totalChargedVnd: 0 });
  });
  it('làm tròn tổng về VND', () => {
    expect(summarizeStatement([100000.4, 99999.6])).toEqual({ orderCount: 2, totalChargedVnd: 200000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/statement-logic.test.ts`
Expected: FAIL — "Cannot find module './statement-logic'".

- [ ] **Step 3: Implement** `features/ship-ho/statement-logic.ts`

```ts
/** THUẦN: tổng hợp bảng kê kỳ từ danh sách chargedVnd (VND). */
export function summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number } {
  const total = chargedVndList.reduce((s, v) => s + v, 0);
  return { orderCount: chargedVndList.length, totalChargedVnd: Math.round(total) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/statement-logic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/statement-logic.ts features/ship-ho/statement-logic.test.ts
git commit -m "feat(ship-ho): summarizeStatement thuần + test"
```

---

### Task 4: Statement orchestrator + queries

**Files:**
- Create: `features/ship-ho/statement-actions.ts`
- Create: `features/ship-ho/statement-queries.ts`

**Interfaces:**
- Consumes: `summarizeStatement` (Task 3); `schema.shipHoOrders`, `schema.shipHoStatements`, `schema.mmpBrands`; `requireManageShipHo`.
- Produces:
  - `generateStatement(partnerBrandSlug: string, periodStart: string, periodEnd: string, opts?: { dryRun?: boolean }): Promise<{ ok: boolean; error?: string; statementId?: string; orderCount: number; totalChargedVnd: number; dryRun: boolean }>`
  - `setStatementStatus(id: string, status: 'issued' | 'paid'): Promise<{ ok: boolean; error?: string }>`
  - `listShipHoStatements()`, `arByPartner()`, `getShipHoStatement(id)`, `marginByPartner()`.

- [ ] **Step 1: Implement** `features/ship-ho/statement-actions.ts`

```ts
'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement } from './statement-logic';

/** Gom đơn đủ điều kiện bill của partner trong kỳ (có chargedVnd, chưa vào kê,
 *  đã gửi/giao, quotedAt trong [start,end]) → tạo ship_ho_statements + gán. */
export async function generateStatement(
  partnerBrandSlug: string,
  periodStart: string,
  periodEnd: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string; statementId?: string; orderCount: number; totalChargedVnd: number; dryRun: boolean }> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  if (!partnerBrandSlug) return { ok: false, error: 'Thiếu partner', orderCount: 0, totalChargedVnd: 0, dryRun };
  if (!periodStart || !periodEnd) return { ok: false, error: 'Thiếu kỳ', orderCount: 0, totalChargedVnd: 0, dryRun };

  const orders = await db
    .select({ id: schema.shipHoOrders.id, chargedVnd: schema.shipHoOrders.chargedVnd })
    .from(schema.shipHoOrders)
    .where(and(
      eq(schema.shipHoOrders.partnerBrandSlug, partnerBrandSlug),
      sql`${schema.shipHoOrders.chargedVnd} is not null`,
      isNull(schema.shipHoOrders.statementId),
      inArray(schema.shipHoOrders.status, ['shipped', 'delivered']),
      sql`${schema.shipHoOrders.quotedAt}::date >= ${periodStart}`,
      sql`${schema.shipHoOrders.quotedAt}::date <= ${periodEnd}`,
    ));

  const sums = summarizeStatement(orders.map((o) => Number(o.chargedVnd)));
  if (dryRun || orders.length === 0) {
    return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, dryRun };
  }

  const [st] = await db.insert(schema.shipHoStatements).values({
    partnerBrandSlug,
    periodStart,
    periodEnd,
    orderCount: sums.orderCount,
    totalChargedVnd: String(sums.totalChargedVnd),
    status: 'draft',
  }).returning({ id: schema.shipHoStatements.id });

  await db.update(schema.shipHoOrders)
    .set({ statementId: st.id, status: 'billed' })
    .where(inArray(schema.shipHoOrders.id, orders.map((o) => o.id)));

  revalidatePath('/f/ship-ho/statements');
  return { ok: true, statementId: st.id, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, dryRun };
}

/** issued: đánh dấu đã gửi partner. paid: đã thu → đơn trong kê chuyển 'settled'. */
export async function setStatementStatus(
  id: string,
  status: 'issued' | 'paid',
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (status === 'issued') {
    await db.update(schema.shipHoStatements).set({ status: 'issued', issuedAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
  } else {
    await db.update(schema.shipHoStatements).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
    await db.update(schema.shipHoOrders).set({ status: 'settled' }).where(eq(schema.shipHoOrders.statementId, id));
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true };
}
```

- [ ] **Step 2: Implement** `features/ship-ho/statement-queries.ts`

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listShipHoStatements() {
  return db
    .select({
      id: schema.shipHoStatements.id,
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      periodStart: schema.shipHoStatements.periodStart,
      periodEnd: schema.shipHoStatements.periodEnd,
      orderCount: schema.shipHoStatements.orderCount,
      totalChargedVnd: schema.shipHoStatements.totalChargedVnd,
      status: schema.shipHoStatements.status,
      issuedAt: schema.shipHoStatements.issuedAt,
      paidAt: schema.shipHoStatements.paidAt,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .orderBy(desc(schema.shipHoStatements.createdAt));
}

/** Công nợ = tổng totalChargedVnd của statement 'issued' (chưa 'paid') theo partner. */
export async function arByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      outstandingVnd: sql<string>`sum(${schema.shipHoStatements.totalChargedVnd})`,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .where(eq(schema.shipHoStatements.status, 'issued'))
    .groupBy(schema.shipHoStatements.partnerBrandSlug, schema.mmpBrands.displayName);
}

/** Bảng kê + các đơn thuộc nó (kèm margin) — để xem chi tiết / export xlsx. */
export async function getShipHoStatement(id: string) {
  const [st] = await db.select().from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return null;
  const orders = await db
    .select({
      code: schema.shipHoOrders.code,
      country: schema.shipHoOrders.country,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      marginVnd: schema.shipHoOrders.marginVnd,
    })
    .from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.statementId, id));
  return { statement: st, orders };
}

/** Báo cáo margin: tổng marginVnd theo partner (chỉ đơn đã đối soát). */
export async function marginByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoOrders.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      orderCount: sql<number>`count(*)::int`,
      totalMarginVnd: sql<string>`coalesce(sum(${schema.shipHoOrders.marginVnd}), 0)`,
    })
    .from(schema.shipHoOrders)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoOrders.partnerBrandSlug))
    .where(sql`${schema.shipHoOrders.marginVnd} is not null`)
    .groupBy(schema.shipHoOrders.partnerBrandSlug, schema.mmpBrands.displayName);
}
```

- [ ] **Step 3: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0. (If Drizzle complains about the `status` literal in `inArray([...])`, cast the array as `('shipped'|'delivered')[]` — behavior unchanged.)

- [ ] **Step 4: Commit**

```bash
git add features/ship-ho/statement-actions.ts features/ship-ho/statement-queries.ts
git commit -m "feat(ship-ho): generateStatement + setStatementStatus + queries (AR/margin)"
```

---

### Task 5: UI đối soát (upload) + margin trên order detail

**Files:**
- Create: `app/(dashboard)/f/ship-ho/reconcile/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/reconcile/ReconcileUploader.tsx`
- Modify: `app/(dashboard)/f/ship-ho/[id]/page.tsx` (thêm block cước thực/delta/margin)
- Modify: `app/(dashboard)/f/ship-ho/page.tsx` (link "Đối soát")

**Interfaces:**
- Consumes: `importCarrierInvoice` (Task 2); `getShipHoOrder` (P1 queries) đã trả full row (gồm `actualCarrierCostVnd, deltaVnd, marginVnd, reconcileStatus`); auth `hasPermission(role,'manage_ship_ho'|'view_ship_ho')`.

- [ ] **Step 1: Reconcile page** `app/(dashboard)/f/ship-ho/reconcile/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { ReconcileUploader } from './ReconcileUploader';

export const dynamic = 'force-dynamic';

export default async function ShipHoReconcilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đối soát cước carrier</h1>
      <p className="text-sm text-muted-foreground">
        File .xlsx/.csv theo thứ tự cột: <b>tracking · cước thực (VND)</b>. Dòng đầu header (bỏ qua).
        Hệ thống match theo tracking, ghi cước thực + delta (thực − ước tính) + margin (thu − thực).
      </p>
      <ReconcileUploader />
    </div>
  );
}
```

- [ ] **Step 2: Reconcile uploader (client)** `app/(dashboard)/f/ship-ho/reconcile/ReconcileUploader.tsx`

```tsx
'use client';

import { useState, useTransition } from 'react';
import { read, utils } from 'xlsx';
import { importCarrierInvoice, type ReconcileSummary } from '@/features/ship-ho/reconcile-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ReconcileUploader() {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ReconcileSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null); setSummary(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const all = utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
      setRows(all.slice(1));
    } catch {
      setErr('File không đọc được — kiểm tra định dạng .xlsx/.csv'); setRows([]);
    }
  };

  const run = (dryRun: boolean) =>
    start(async () => {
      setErr(null);
      if (rows.length === 0) { setErr('Chưa có dữ liệu'); return; }
      setSummary(await importCarrierInvoice(rows, { dryRun }));
    });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <input type="file" accept=".xlsx,.xls,.csv" className="block text-sm" onChange={onFile} />
        {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} dòng</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={pending || !rows.length}>Xem trước</Button>
          <Button onClick={() => run(false)} disabled={pending || !rows.length}>Đối soát</Button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {summary && (
          <div className="text-sm border-t pt-3 space-y-1">
            <div>{summary.dryRun ? 'Xem trước' : 'Đã đối soát'}: <b>{summary.matched}</b> khớp · {summary.unmatched} không khớp tracking · {summary.skippedEmpty} trống · {summary.errors.length} lỗi</div>
            {summary.errors.slice(0, 10).map((e) => <div key={e.rowIndex} className="text-red-600 text-xs">Dòng {e.rowIndex + 2}: {e.reason}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Margin block on order detail** — in `app/(dashboard)/f/ship-ho/[id]/page.tsx`, add after the existing price `<Card>` (uses the `vnd()` helper already defined in that file):

```tsx
      <Card><CardContent className="p-4 space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Đối soát cước</div>
        <div className="flex justify-between"><span>Cước carrier thực</span><span>{vnd(o.actualCarrierCostVnd)}</span></div>
        <div className="flex justify-between"><span>Lệch engine (thực − ước tính)</span><span>{vnd(o.deltaVnd)}</span></div>
        <div className="flex justify-between font-semibold border-t pt-2"><span>Margin (thu − thực)</span><span>{vnd(o.marginVnd)}</span></div>
        {!o.reconcileStatus && <p className="text-muted-foreground text-xs">Chưa đối soát cước thực.</p>}
      </CardContent></Card>
```

- [ ] **Step 4: "Đối soát" link on list page** — in `app/(dashboard)/f/ship-ho/page.tsx` header actions `<div className="flex gap-2">`, add:

```tsx
          <Link href="/f/ship-ho/reconcile" className={buttonVariants({ variant: 'outline' })}>Đối soát</Link>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/ship-ho" features/ship-ho` → no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/f/ship-ho"
git commit -m "feat(ship-ho): UI đối soát cước (upload) + margin trên order detail"
```

---

### Task 6: UI bảng kê + công nợ + margin report

**Files:**
- Create: `app/(dashboard)/f/ship-ho/statements/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/statements/StatementsManager.tsx`
- Modify: `app/(dashboard)/f/ship-ho/page.tsx` (link "Bảng kê")

**Interfaces:**
- Consumes: `generateStatement`, `setStatementStatus` (Task 4); `listShipHoStatements`, `arByPartner`, `getShipHoStatement`, `marginByPartner` (Task 4); `listShipHoPartners` (P1); auth.

- [ ] **Step 1: Statements page** `app/(dashboard)/f/ship-ho/statements/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoStatements, arByPartner, marginByPartner } from '@/features/ship-ho/statement-queries';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { StatementsManager } from './StatementsManager';

export const dynamic = 'force-dynamic';

export default async function ShipHoStatementsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const [statements, ar, margin, partners] = await Promise.all([
    listShipHoStatements(), arByPartner(), marginByPartner(), listShipHoPartners(),
  ]);
  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Bảng kê & công nợ ship hộ</h1>
      <StatementsManager
        statements={statements}
        ar={ar}
        margin={margin}
        partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))}
        canManage={canManage}
      />
    </div>
  );
}
```

- [ ] **Step 2: Statements manager (client)** `app/(dashboard)/f/ship-ho/statements/StatementsManager.tsx`

```tsx
'use client';

import { useState, useTransition } from 'react';
import { utils, writeFile } from 'xlsx';
import { generateStatement, setStatementStatus } from '@/features/ship-ho/statement-actions';
import { getShipHoStatement } from '@/features/ship-ho/statement-queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const vnd = (v: string | number | null) => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + ' ₫');

interface Statement {
  id: string; partnerBrandSlug: string; brandName: string | null;
  periodStart: string; periodEnd: string; orderCount: number; totalChargedVnd: string;
  status: string; issuedAt: Date | null; paidAt: Date | null;
}
interface Ar { partnerBrandSlug: string; brandName: string | null; outstandingVnd: string }
interface Margin { partnerBrandSlug: string; brandName: string | null; orderCount: number; totalMarginVnd: string }
interface PartnerOpt { slug: string; name: string }

export function StatementsManager({ statements, ar, margin, partners, canManage }: {
  statements: Statement[]; ar: Ar[]; margin: Margin[]; partners: PartnerOpt[]; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [partner, setPartner] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const gen = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await generateStatement(partner, from, to, { dryRun });
      if (!r.ok) { setMsg(r.error ?? 'Lỗi'); return; }
      setMsg(`${dryRun ? 'Xem trước' : 'Đã tạo bảng kê'}: ${r.orderCount} đơn · ${Number(r.totalChargedVnd).toLocaleString('vi-VN')} ₫`);
    });

  const mark = (id: string, status: 'issued' | 'paid') =>
    start(async () => { await setStatementStatus(id, status); });

  const exportXlsx = (id: string, label: string) =>
    start(async () => {
      const data = await getShipHoStatement(id);
      if (!data) return;
      const rows = data.orders.map((o) => ({
        'Mã đơn': o.code, 'Nước': o.country,
        'Giá thu (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd),
        'Cước thực (VND)': o.actualCarrierCostVnd == null ? '' : Number(o.actualCarrierCostVnd),
        'Margin (VND)': o.marginVnd == null ? '' : Number(o.marginVnd),
      }));
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Bảng kê');
      writeFile(wb, `bang-ke-${label}.xlsx`);
    });

  return (
    <div className="space-y-6">
      {canManage && (
        <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">Partner
            <select className="block border rounded px-2 py-1 mt-1" value={partner} onChange={(e) => setPartner(e.target.value)}>
              <option value="">— chọn —</option>
              {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Từ<input type="date" className="block border rounded px-2 py-1 mt-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm">Đến<input type="date" className="block border rounded px-2 py-1 mt-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button variant="outline" onClick={() => gen(true)} disabled={pending || !partner || !from || !to}>Xem trước</Button>
          <Button onClick={() => gen(false)} disabled={pending || !partner || !from || !to}>Tạo bảng kê</Button>
          {msg && <span className="text-sm">{msg}</span>}
        </CardContent></Card>
      )}

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Công nợ (đã gửi chưa thu)</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm"><tbody>
            {ar.length === 0 ? <tr><td className="p-3 text-muted-foreground">Không có công nợ.</td></tr>
              : ar.map((a) => <tr key={a.partnerBrandSlug} className="border-b [&>td]:p-3"><td>{a.brandName ?? a.partnerBrandSlug}</td><td className="text-right font-medium">{vnd(a.outstandingVnd)}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Margin theo partner</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm"><tbody>
            {margin.map((m) => <tr key={m.partnerBrandSlug} className="border-b [&>td]:p-3"><td>{m.brandName ?? m.partnerBrandSlug}</td><td className="text-muted-foreground">{m.orderCount} đơn</td><td className="text-right font-medium">{vnd(m.totalMarginVnd)}</td></tr>)}
            {margin.length === 0 && <tr><td className="p-3 text-muted-foreground">Chưa có đơn đối soát.</td></tr>}
          </tbody></table>
        </CardContent></Card>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Bảng kê</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Partner</th><th>Kỳ</th><th>Đơn</th><th>Tổng thu</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-b [&>td]:p-3">
                  <td>{s.brandName ?? s.partnerBrandSlug}</td>
                  <td>{s.periodStart} → {s.periodEnd}</td>
                  <td>{s.orderCount}</td>
                  <td className="font-medium">{vnd(s.totalChargedVnd)}</td>
                  <td>{s.status === 'draft' ? 'Nháp' : s.status === 'issued' ? 'Đã gửi' : 'Đã thu'}</td>
                  <td className="text-right space-x-1">
                    <Button variant="outline" size="sm" onClick={() => exportXlsx(s.id, `${s.partnerBrandSlug}-${s.periodStart}`)} disabled={pending}>Xuất</Button>
                    {canManage && s.status === 'draft' && <Button variant="outline" size="sm" onClick={() => mark(s.id, 'issued')} disabled={pending}>Gửi</Button>}
                    {canManage && s.status === 'issued' && <Button size="sm" onClick={() => mark(s.id, 'paid')} disabled={pending}>Đã thu</Button>}
                  </td>
                </tr>
              ))}
              {statements.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Chưa có bảng kê.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: "Bảng kê" link on list page** — in `app/(dashboard)/f/ship-ho/page.tsx` header actions, add:

```tsx
          <Link href="/f/ship-ho/statements" className={buttonVariants({ variant: 'outline' })}>Bảng kê</Link>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/ship-ho" features/ship-ho` → no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/f/ship-ho"
git commit -m "feat(ship-ho): UI bảng kê kỳ + công nợ + margin report + export xlsx"
```

---

## Self-Review

**1. Spec coverage (P3 = spec §7):**
- §7.1 đối soát cước (match tracking → actual/delta/margin/reconcileStatus) → Task 1 (logic) + Task 2 (orchestrator) + Task 5 (UI upload + hiển thị). ✔ Nguồn = file invoice carrier riêng (đã chốt).
- §7.2 bảng kê kỳ (gom đơn có chargedVnd, gán statementId, status 'billed', export) → Task 3 (logic) + Task 4 (generateStatement) + Task 6 (UI + export xlsx). ✔
- Công nợ AR (draft→issued→paid; settled khi paid) → Task 4 (setStatementStatus) + Task 6 (arByPartner + nút). ✔
- Báo cáo margin → Task 4 (marginByPartner) + Task 6 (bảng margin). ✔
- KHÔNG migration (cột đã có ở P1). ✔

**2. Placeholder scan:** không TBD/TODO; mọi step có code/command. 1 NOTE (Task 4 cast inArray) là kiểm chứng thực tế.

**3. Type consistency:**
- `computeReconcile({estimateVnd,chargedVnd,actualVnd})` → `{deltaVnd,marginVnd,reconcileStatus}` (Task 1) dùng ở Task 2. ✔
- `summarizeStatement(number[])` → `{orderCount,totalChargedVnd}` (Task 3) dùng ở Task 4. ✔
- `importCarrierInvoice(rows,opts)` → `ReconcileSummary` (Task 2) khớp ReconcileUploader (Task 5). ✔
- `generateStatement(slug,start,end,opts)` + `setStatementStatus(id,status)` (Task 4) khớp StatementsManager (Task 6). ✔
- Queries `listShipHoStatements/arByPartner/getShipHoStatement/marginByPartner` (Task 4) khớp field dùng ở Task 6. ✔
- Cột `schema.shipHoOrders.*` / `schema.shipHoStatements.*` (P1) dùng nhất quán; `getShipHoOrder` (P1) đã trả full row nên order detail (Task 5) đọc được `actualCarrierCostVnd/deltaVnd/marginVnd/reconcileStatus`. ✔

## Execution Handoff (điền sau khi lưu plan)
