# Shipping Reconcile Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global "Đối soát phí ship" page that shows every shipment's billed (carrier invoice) vs engine-calculated cost, the delta in VND/%, a per-surcharge drilldown, persisted reconcile status, and CSV export.

**Architecture:** On-the-fly compute — the server page calls the existing `reconcileShipments()` (which already returns per-component billed + engine amounts) and joins a new `shipment_reconcile_status` table. A client table component handles filter/sort/summary and per-row status mutations via server actions. No precompute/cache (YAGNI for current ~2.2k-row volume).

**Tech Stack:** Next.js (app router — this repo's fork; read `node_modules/next/dist/docs/` before writing routes/actions per AGENTS.md), Drizzle ORM + Postgres, Better-Auth + RBAC, Vitest, Tailwind/shadcn UI, `lib/csv` helpers.

**Spec:** [docs/superpowers/specs/2026-06-08-shipping-reconcile-module-design.md](../specs/2026-06-08-shipping-reconcile-module-design.md)

---

## File Structure

- `features/shipments/reconcile.ts` — **modify**: expose `shipmentId` on `ReconcileRow`.
- `db/schema.ts` — **modify**: add `reconcileStatusEnum` + `shipmentReconcileStatus` table.
- `db/migrations/NNNN_*.sql` — **generate**: the migration.
- `features/shipments/reconcile-view.ts` — **create**: join reconcile rows with status, compute net-base + flags.
- `features/shipments/reconcile-view.test.ts` — **create**: unit tests for the join/flags/net-base.
- `features/shipments/reconcile-status-actions.ts` — **create**: `setReconcileStatus` / `clearReconcileStatus` server actions.
- `app/(dashboard)/f/shipping-reconcile/page.tsx` — **create**: server page (auth + data load).
- `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts` — **create**: CSV export.
- `components/shipping-reconcile/ReconcileTable.tsx` — **create**: client table + filters + summary + status buttons.
- `components/shipping-reconcile/ReconcileDetailPanel.tsx` — **create**: per-component billed-vs-engine drilldown.
- `lib/nav.ts` — **modify**: add the nav item.
- `lib/nav.test.ts` — **modify**: assert the new item exists.

---

## Task 1: Expose `shipmentId` on ReconcileRow

The status join keys on shipment id. The query at `features/shipments/reconcile.ts` already selects `shipmentId` (line ~74) but `ReconcileRow` doesn't surface it, and `buildRow` doesn't receive it.

**Files:**
- Modify: `features/shipments/reconcile.ts`

- [ ] **Step 1: Add `shipmentId` to the `ReconcileRow` interface**

In `features/shipments/reconcile.ts`, in `export interface ReconcileRow`, add as the first field:

```typescript
export interface ReconcileRow {
  shipmentId: string;
  trackingNumber: string;
  orderNumber: string;
  // ...rest unchanged
```

- [ ] **Step 2: Add `shipmentId` to the `JoinedRow` interface**

In the same file, `interface JoinedRow`, add:

```typescript
interface JoinedRow {
  shipmentId: string;
  // shipments.tracking_number is nullable... (existing comment)
  trackingNumber: string | null;
  // ...rest unchanged
```

- [ ] **Step 3: Set `shipmentId` in `buildRow`**

In `buildRow`, in the returned object, add as the first property:

```typescript
  return {
    shipmentId: r.shipmentId,
    trackingNumber: r.trackingNumber ?? '',
    // ...rest unchanged
```

The loop already passes the full joined row `r` (which carries `shipmentId` from the select) into `buildRow`, so no call-site change is needed.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `reconcile.ts`.

- [ ] **Step 5: Commit**

```bash
git add features/shipments/reconcile.ts
git commit -m "feat(reconcile): expose shipmentId on ReconcileRow"
```

---

## Task 2: `shipment_reconcile_status` table + migration

**Files:**
- Modify: `db/schema.ts`
- Generate: `db/migrations/NNNN_*.sql`

- [ ] **Step 1: Add the enum + table to `db/schema.ts`**

Append near the other shipment tables (after `shipmentCharges`, around line 764):

```typescript
export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored']);

/** Operator-set reconciliation state for a shipment's billed-vs-engine
 *  comparison. ABSENCE of a row = "chưa đối soát" (pending). */
export const shipmentReconcileStatus = pgTable('shipment_reconcile_status', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipmentId: uuid('shipment_id')
    .references(() => shipments.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: reconcileStatusEnum('status').notNull(),
  note: text('note'),
  /** Snapshot of shipment_charges.total_amount when marked — lets the UI
   *  flag "billed changed since you reviewed this". */
  billedTotalAtReview: numeric('billed_total_at_review', { precision: 14, scale: 2 }),
  reconciledBy: text('reconciled_by'),
  reconciledAt: timestamp('reconciled_at').defaultNow().notNull(),
});
```

(`pgEnum`, `uuid`, `text`, `numeric`, `timestamp` are already imported at the top of `db/schema.ts`.)

- [ ] **Step 2: Generate the migration**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit generate`
Expected: a new `db/migrations/NNNN_*.sql` containing `CREATE TYPE "public"."reconcile_status"` and `CREATE TABLE "shipment_reconcile_status"`.

- [ ] **Step 3: Apply the migration to the local DB**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit migrate`
Expected: applies cleanly.

- [ ] **Step 4: Verify the table exists**

Run: `psql -d staging -tA -c "select count(*) from shipment_reconcile_status;"`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(db): add shipment_reconcile_status table"
```

---

## Task 3: `reconcile-view.ts` — join status + net-base + flags

Wraps `reconcileShipments()`, joins the status table, and derives display fields: `status` (pending when no row), `billedChangedSinceReview`, and net base (`billedBase + billedDiscount` since discount is stored negative) to dodge the list-base/discount artifact described in spec §3.6.

**Files:**
- Create: `features/shipments/reconcile-view.ts`
- Test: `features/shipments/reconcile-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/shipments/reconcile-view.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mergeStatus, netBase, type StatusRecord } from './reconcile-view';
import type { ReconcileRow } from './reconcile';

function row(over: Partial<ReconcileRow> = {}): ReconcileRow {
  return {
    shipmentId: 's1', trackingNumber: 't1', orderNumber: '#1', storeName: 'S',
    carrierKey: 'fedex', shipCountry: 'SA', weightKg: 1, labelDate: null,
    billedTotal: 2_388_966, billedBase: 5_079_100, billedFuel: 513_729,
    billedRemote: 550_000, billedDemand: 71_000, billedSignature: 0,
    billedVat: 176_960, billedGogreen: null, billedDiscount: -4_001_823,
    engineTotal: 1_270_649, engineBase: 1_075_196, engineFuel: 310_312,
    engineRemote: 0, engineDemand: 76_920, engineResidential: 0,
    engineVat: 119_020, engineDiscount: 0, engineReason: null,
    deltaVnd: 1_118_317, deltaPct: 46.8,
    ...over,
  };
}

describe('netBase', () => {
  it('nets the negative discount into the list base', () => {
    // 5,079,100 + (-4,001,823) = 1,077,277
    expect(netBase(5_079_100, -4_001_823)).toBe(1_077_277);
  });
  it('returns null when base is null', () => {
    expect(netBase(null, -100)).toBeNull();
  });
  it('treats a null discount as zero', () => {
    expect(netBase(1000, null)).toBe(1000);
  });
});

describe('mergeStatus', () => {
  it('marks rows with no status record as pending', () => {
    const [r] = mergeStatus([row()], new Map());
    expect(r.status).toBe('pending');
    expect(r.note).toBeNull();
    expect(r.billedChangedSinceReview).toBe(false);
  });

  it('applies a stored reconciled status', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'reconciled', note: 'ok', billedTotalAtReview: 2_388_966 }],
    ]);
    const [r] = mergeStatus([row()], map);
    expect(r.status).toBe('reconciled');
    expect(r.note).toBe('ok');
    expect(r.billedChangedSinceReview).toBe(false);
  });

  it('flags billedChangedSinceReview when billed differs from snapshot', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'reconciled', note: null, billedTotalAtReview: 2_000_000 }],
    ]);
    const [r] = mergeStatus([row({ billedTotal: 2_388_966 })], map);
    expect(r.billedChangedSinceReview).toBe(true);
  });

  it('computes net base on the view row', () => {
    const [r] = mergeStatus([row()], new Map());
    expect(r.billedBaseNet).toBe(1_077_277);
    expect(r.engineBaseNet).toBe(1_075_196);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run features/shipments/reconcile-view.test.ts`
Expected: FAIL — cannot find module `./reconcile-view`.

- [ ] **Step 3: Implement `reconcile-view.ts`**

Create `features/shipments/reconcile-view.ts`:

```typescript
/**
 * View layer over reconcileShipments(): joins operator-set reconcile
 * status and derives display-only fields (net base, change flag).
 * Kept separate from the pure-compute reconcile.ts so the engine math
 * stays status-agnostic and unit-testable.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  reconcileShipments,
  type ReconcileRow,
  type ReconcileSummary,
} from './reconcile';

export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored';

export interface StatusRecord {
  status: 'reconciled' | 'ignored';
  note: string | null;
  billedTotalAtReview: number | null;
}

export interface ReconcileViewRow extends ReconcileRow {
  status: ReconcileStatus;
  note: string | null;
  billedChangedSinceReview: boolean;
  /** billedBase + billedDiscount (discount stored negative). Avoids the
   *  list-base/discount display artifact — see spec §3.6. */
  billedBaseNet: number | null;
  engineBaseNet: number | null;
}

export interface ReconcileView {
  summary: ReconcileSummary;
  rows: ReconcileViewRow[];
}

/** Net the (negative) discount into the list base. */
export function netBase(base: number | null, discount: number | null): number | null {
  if (base === null) return null;
  return base + (discount ?? 0);
}

/** Merge a status map (keyed by shipmentId) onto reconcile rows. */
export function mergeStatus(
  rows: ReconcileRow[],
  statusByShipment: Map<string, StatusRecord>,
): ReconcileViewRow[] {
  return rows.map((r) => {
    const rec = statusByShipment.get(r.shipmentId);
    const billedChangedSinceReview =
      rec?.billedTotalAtReview != null && rec.billedTotalAtReview !== r.billedTotal;
    return {
      ...r,
      status: (rec?.status ?? 'pending') as ReconcileStatus,
      note: rec?.note ?? null,
      billedChangedSinceReview,
      billedBaseNet: netBase(r.billedBase, r.billedDiscount),
      engineBaseNet: r.engineBase,
    };
  });
}

interface ReconcileViewOptions {
  carrierKey?: 'fedex' | 'dhl';
  fromDate?: Date;
  toDate?: Date;
}

/** Load all reconcile rows (no topN cap) joined with status. */
export async function reconcileShipmentsWithStatus(
  opts: ReconcileViewOptions = {},
): Promise<ReconcileView> {
  const summary = await reconcileShipments({ ...opts, topN: 1_000_000 });

  const statusRows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      status: schema.shipmentReconcileStatus.status,
      note: schema.shipmentReconcileStatus.note,
      billedTotalAtReview: schema.shipmentReconcileStatus.billedTotalAtReview,
    })
    .from(schema.shipmentReconcileStatus);

  const map = new Map<string, StatusRecord>();
  for (const s of statusRows) {
    map.set(s.shipmentId, {
      status: s.status,
      note: s.note,
      billedTotalAtReview: s.billedTotalAtReview !== null ? Number(s.billedTotalAtReview) : null,
    });
  }

  return { summary, rows: mergeStatus(summary.rows, map) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run features/shipments/reconcile-view.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add features/shipments/reconcile-view.ts features/shipments/reconcile-view.test.ts
git commit -m "feat(reconcile): reconcile-view layer with status join + net base"
```

---

## Task 4: Status mutation server actions

**Files:**
- Create: `features/shipments/reconcile-status-actions.ts`

- [ ] **Step 1: Implement the actions**

Create `features/shipments/reconcile-status-actions.ts`:

```typescript
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

const ROUTE = '/f/shipping-reconcile';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    throw new Error('Forbidden');
  }
  return session.user.id;
}

export interface SetReconcileStatusInput {
  shipmentId: string;
  status: 'reconciled' | 'ignored';
  note?: string | null;
  /** Current billed total, snapshotted for change detection. */
  billedTotal: number;
}

export async function setReconcileStatus(input: SetReconcileStatusInput): Promise<void> {
  const userId = await requireUser();
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: input.status,
      note: input.note?.trim() || null,
      billedTotalAtReview: input.billedTotal.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: input.status,
        note: input.note?.trim() || null,
        billedTotalAtReview: input.billedTotal.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

/** Remove the status row → shipment returns to "pending". */
export async function clearReconcileStatus(shipmentId: string): Promise<void> {
  await requireUser();
  await db
    .delete(schema.shipmentReconcileStatus)
    .where(eq(schema.shipmentReconcileStatus.shipmentId, shipmentId));
  revalidatePath(ROUTE);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add features/shipments/reconcile-status-actions.ts
git commit -m "feat(reconcile): setReconcileStatus / clearReconcileStatus actions"
```

---

## Task 5: Detail panel component (per-component drilldown)

Built before the table so the table can import it. Pure presentational — receives a `ReconcileViewRow`, renders the billed-vs-engine breakdown by surcharge, using **net base** for the base row.

**Files:**
- Create: `components/shipping-reconcile/ReconcileDetailPanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `components/shipping-reconcile/ReconcileDetailPanel.tsx`:

```tsx
'use client';

import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

interface ComponentLine {
  label: string;
  billed: number | null;
  engine: number | null;
  /** Optional human note explaining a known cause of the delta. */
  hint?: string;
}

function lines(row: ReconcileViewRow): ComponentLine[] {
  return [
    { label: 'Cước gốc (sau giảm giá)', billed: row.billedBaseNet, engine: row.engineBaseNet },
    { label: 'Phụ phí xăng dầu (fuel)', billed: row.billedFuel, engine: row.engineFuel },
    { label: 'Vùng xa (remote)', billed: row.billedRemote, engine: row.engineRemote },
    { label: 'Phụ phí nhu cầu (demand)', billed: row.billedDemand, engine: row.engineDemand },
    { label: 'Ký nhận (signature)', billed: row.billedSignature, engine: row.engineResidential },
    { label: 'VAT', billed: row.billedVat, engine: row.engineVat },
  ];
}

export function ReconcileDetailPanel({ row }: { row: ReconcileViewRow }) {
  if (row.engineTotal === null) {
    return (
      <div className="p-4 text-sm text-amber-600 dark:text-amber-400">
        Hệ thống chưa tính được giá cho đơn này (lý do: {row.engineReason ?? 'không rõ'}). Không có số liệu để đối soát từng khoản.
      </div>
    );
  }
  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1">Khoản phí</th>
            <th className="text-right py-1">Billed</th>
            <th className="text-right py-1">Hệ thống</th>
            <th className="text-right py-1">Lệch</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {lines(row).map((l) => {
            const delta = l.billed !== null && l.engine !== null ? l.billed - l.engine : null;
            return (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 font-sans">{l.label}</td>
                <td className="py-1 text-right">{fmtVnd(l.billed)}</td>
                <td className="py-1 text-right">{fmtVnd(l.engine)}</td>
                <td className={`py-1 text-right ${delta && Math.abs(delta) > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {fmtVnd(delta)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 font-sans">Tổng</td>
            <td className="py-1 text-right">{fmtVnd(row.billedTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.engineTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.deltaVnd)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Giảm giá hợp đồng đã được gộp vào "Cước gốc (sau giảm giá)". Billed gốc trên hóa đơn: {fmtVnd(row.billedBase)} − giảm {fmtVnd(row.billedDiscount)}.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/shipping-reconcile/ReconcileDetailPanel.tsx
git commit -m "feat(reconcile): per-component detail panel"
```

---

## Task 6: Reconcile table component (filters + summary + status)

**Files:**
- Create: `components/shipping-reconcile/ReconcileTable.tsx`

- [ ] **Step 1: Implement the table**

Create `components/shipping-reconcile/ReconcileTable.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { ReconcileViewRow, ReconcileStatus } from '@/features/shipments/reconcile-view';
import { setReconcileStatus, clearReconcileStatus } from '@/features/shipments/reconcile-status-actions';
import { ReconcileDetailPanel } from './ReconcileDetailPanel';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

type CarrierFilter = 'all' | 'fedex' | 'dhl';
type StatusFilter = 'all' | 'pending' | 'reconciled' | 'ignored';

interface Props {
  rows: ReconcileViewRow[];
}

function deltaClass(pct: number | null): string {
  if (pct === null) return '';
  const a = Math.abs(pct);
  if (a > 25) return 'text-red-600 dark:text-red-400';
  if (a > 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function ReconcileTable({ rows }: Props) {
  const [carrier, setCarrier] = useState<CarrierFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [country, setCountry] = useState('');
  const [minPct, setMinPct] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const minAbs = minPct ? Number(minPct) : null;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => carrier === 'all' || r.carrierKey === carrier)
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => !country || r.shipCountry.toLowerCase() === country.toLowerCase())
      .filter((r) => minAbs === null || (r.deltaPct !== null && Math.abs(r.deltaPct) >= minAbs))
      .filter(
        (r) =>
          !needle ||
          r.orderNumber.toLowerCase().includes(needle) ||
          r.trackingNumber.toLowerCase().includes(needle),
      )
      .sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));
  }, [rows, carrier, status, country, minPct, q]);

  const summary = useMemo(() => {
    let billed = 0, engine = 0, over10 = 0, pendingCount = 0;
    for (const r of filtered) {
      billed += r.billedTotal;
      engine += r.engineTotal ?? 0;
      if (r.deltaPct !== null && Math.abs(r.deltaPct) > 10) over10 += 1;
      if (r.status === 'pending') pendingCount += 1;
    }
    const delta = billed - engine;
    const pct = billed > 0 ? (delta / billed) * 100 : 0;
    return { billed, engine, delta, pct, over10, pendingCount, n: filtered.length };
  }, [filtered]);

  async function mark(r: ReconcileViewRow, next: 'reconciled' | 'ignored') {
    setPending(r.shipmentId);
    try {
      if (r.status === next) {
        await clearReconcileStatus(r.shipmentId);
      } else {
        await setReconcileStatus({ shipmentId: r.shipmentId, status: next, billedTotal: r.billedTotal });
      }
    } finally {
      setPending(null);
    }
  }

  const exportHref = useMemo(() => {
    const p = new URLSearchParams();
    if (carrier !== 'all') p.set('carrier', carrier);
    if (country) p.set('country', country);
    return `/f/shipping-reconcile/export.csv${p.toString() ? `?${p}` : ''}`;
  }, [carrier, country]);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Σ Billed" value={`${fmtVnd(summary.billed)} đ`} />
        <Stat label="Σ Hệ thống" value={`${fmtVnd(summary.engine)} đ`} />
        <Stat label="Σ Lệch" value={`${fmtVnd(summary.delta)} đ (${summary.pct.toFixed(2)}%)`} />
        <Stat label="Đơn lệch >10%" value={String(summary.over10)} />
        <Stat label="Chưa đối soát" value={String(summary.pendingCount)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={carrier} onChange={(e) => setCarrier(e.target.value as CarrierFilter)} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Tất cả carrier</option>
          <option value="fedex">FedEx</option>
          <option value="dhl">DHL</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Mọi trạng thái</option>
          <option value="pending">Chưa đối soát</option>
          <option value="reconciled">Đã đối soát</option>
          <option value="ignored">Bỏ qua</option>
        </select>
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Nước (vd SA)" className="w-28 rounded border border-border bg-background px-2 py-1" />
        <input value={minPct} onChange={(e) => setMinPct(e.target.value)} placeholder="Lệch ≥ %" className="w-24 rounded border border-border bg-background px-2 py-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm order / tracking" className="w-48 rounded border border-border bg-background px-2 py-1" />
        <a href={exportHref} className="ml-auto rounded border border-border px-3 py-1 hover:bg-muted">Export CSV</a>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">CC</th>
              <th className="px-3 py-2 text-left">Nước</th>
              <th className="px-3 py-2 text-right">KG</th>
              <th className="px-3 py-2 text-right">Billed</th>
              <th className="px-3 py-2 text-right">Hệ thống</th>
              <th className="px-3 py-2 text-right">Lệch</th>
              <th className="px-3 py-2 text-right">Δ%</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {filtered.map((r) => (
              <FragmentRow
                key={r.shipmentId}
                r={r}
                expanded={expanded === r.shipmentId}
                busy={pending === r.shipmentId}
                onToggle={() => setExpanded(expanded === r.shipmentId ? null : r.shipmentId)}
                onMark={mark}
              />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground font-sans">Không có đơn nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono tabular-nums font-semibold">{value}</div>
    </div>
  );
}

function FragmentRow({
  r, expanded, busy, onToggle, onMark,
}: {
  r: ReconcileViewRow;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onMark: (r: ReconcileViewRow, next: 'reconciled' | 'ignored') => void;
}) {
  const statusLabel: Record<ReconcileStatus, string> = {
    pending: 'Chưa', reconciled: 'Đã đối soát', ignored: 'Bỏ qua',
  };
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-2 font-sans">{r.orderNumber}</td>
        <td className="px-3 py-2">{r.trackingNumber}</td>
        <td className="px-3 py-2 font-sans">{r.carrierKey}</td>
        <td className="px-3 py-2">{r.shipCountry}</td>
        <td className="px-3 py-2 text-right">{r.weightKg ?? '—'}</td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.billedTotal)}</td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.engineTotal)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{fmtVnd(r.deltaVnd)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{r.deltaPct !== null ? `${r.deltaPct.toFixed(1)}` : '—'}</td>
        <td className="px-3 py-2 font-sans" onClick={(e) => e.stopPropagation()}>
          <span className="mr-2">{statusLabel[r.status]}{r.billedChangedSinceReview ? ' ⚠' : ''}</span>
          <button disabled={busy} onClick={() => onMark(r, 'reconciled')} className="mr-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50">✓</button>
          <button disabled={busy} onClick={() => onMark(r, 'ignored')} className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50">Bỏ qua</button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/10">
          <td colSpan={10}><ReconcileDetailPanel row={r} /></td>
        </tr>
      )}
    </>
  );
}

function deltaClass(pct: number | null): string {
  if (pct === null) return '';
  const a = Math.abs(pct);
  if (a > 25) return 'text-red-600 dark:text-red-400';
  if (a > 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}
```

> Note: remove the duplicate `deltaClass` — keep the top-level one declared before `ReconcileTable` and delete the second definition at the bottom (it's shown twice above only because both call sites need it; a function declaration is hoisted, so keep exactly ONE `deltaClass` in the file).

- [ ] **Step 2: Remove the duplicate `deltaClass`**

Ensure the file has exactly one `function deltaClass(...)` declaration. Delete the trailing duplicate.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/shipping-reconcile/ReconcileTable.tsx
git commit -m "feat(reconcile): client table with filters, summary, status actions"
```

---

## Task 7: Server page

**Files:**
- Create: `app/(dashboard)/f/shipping-reconcile/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/(dashboard)/f/shipping-reconcile/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';
import { ReconcileTable } from '@/components/shipping-reconcile/ReconcileTable';

export const dynamic = 'force-dynamic';

export default async function ShippingReconcilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    redirect('/');
  }

  const { rows } = await reconcileShipmentsWithStatus();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Đối soát phí ship</h1>
        <p className="text-sm text-muted-foreground">
          So giá hóa đơn carrier (billed) với giá hệ thống tính, theo từng đơn và từng khoản phí.
        </p>
      </div>
      <ReconcileTable rows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run the dev server (`DATABASE_URL="postgres://macos@localhost:5432/staging" npx next dev`), open `/f/shipping-reconcile`, confirm the table loads with the summary bar and rows.
Expected: rows visible, sorted by |Δ| desc; clicking a row expands the per-component panel; ✓/Bỏ qua buttons update status.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/f/shipping-reconcile/page.tsx"
git commit -m "feat(reconcile): shipping-reconcile page"
```

---

## Task 8: CSV export route

**Files:**
- Create: `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts`:

```typescript
/**
 * GET /f/shipping-reconcile/export.csv?carrier=&country=&from=&to=
 *   → text/csv: one row per shipment with billed vs engine per component.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';

export const dynamic = 'force-dynamic';

const HEADER = [
  'order', 'tracking', 'carrier', 'country', 'weight_kg', 'label_date',
  'billed_total', 'engine_total', 'delta_vnd', 'delta_pct', 'status',
  'billed_base_net', 'engine_base_net',
  'billed_fuel', 'engine_fuel', 'billed_remote', 'engine_remote',
  'billed_demand', 'engine_demand', 'billed_signature', 'engine_signature',
  'billed_vat', 'engine_vat', 'engine_reason',
];

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const carrierParam = url.searchParams.get('carrier');
  const carrier = carrierParam === 'fedex' || carrierParam === 'dhl' ? carrierParam : undefined;
  const country = url.searchParams.get('country')?.toUpperCase() || undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const { rows } = await reconcileShipmentsWithStatus({
    carrierKey: carrier,
    fromDate: from ? new Date(from) : undefined,
    toDate: to ? new Date(to) : undefined,
  });

  const filtered = country ? rows.filter((r) => r.shipCountry === country) : rows;
  filtered.sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));

  const out: CsvValue[][] = filtered.map((r) => [
    r.orderNumber, r.trackingNumber, r.carrierKey, r.shipCountry, r.weightKg,
    r.labelDate ? r.labelDate.toISOString().slice(0, 10) : null,
    r.billedTotal, r.engineTotal, r.deltaVnd, r.deltaPct, r.status,
    r.billedBaseNet, r.engineBaseNet,
    r.billedFuel, r.engineFuel, r.billedRemote, r.engineRemote,
    r.billedDemand, r.engineDemand, r.billedSignature, r.engineResidential,
    r.billedVat, r.engineVat, r.engineReason,
  ]);

  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="shipping-reconcile.csv"',
      'cache-control': 'no-store',
    },
  });
}
```

- [ ] **Step 2: Verify export**

With the dev server running, open `/f/shipping-reconcile/export.csv` (logged in).
Expected: a CSV downloads with the header row + one row per shipment.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/f/shipping-reconcile/export.csv/route.ts"
git commit -m "feat(reconcile): CSV export route"
```

---

## Task 9: Nav item

**Files:**
- Modify: `lib/nav.ts`
- Modify: `lib/nav.test.ts`

- [ ] **Step 1: Add the nav item**

In `lib/nav.ts`, add `Receipt` to the lucide import line, then add to the `NAV` array after the carrier-rates entry:

```typescript
import { LayoutDashboard, Store, Eye, Settings, History, Users, Globe, ToggleRight, Truck, ShoppingBag, Sparkles, Package, Receipt } from 'lucide-react';
```

```typescript
  { href: '/f/carrier-rates', label: 'Carrier rates', icon: Truck,           requires: 'view_carrier_rates' },
  { href: '/f/shipping-reconcile', label: 'Đối soát phí ship', icon: Receipt, requires: 'view_carrier_rates' },
```

- [ ] **Step 2: Add a test asserting the item exists**

In `lib/nav.test.ts`, inside `describe('NAV structure', ...)`, add:

```typescript
  it('includes the shipping-reconcile module gated by view_carrier_rates', () => {
    const item = NAV.find((n) => n.href === '/f/shipping-reconcile');
    expect(item).toBeDefined();
    expect(item!.requires).toBe('view_carrier_rates');
  });
```

- [ ] **Step 3: Run the nav tests**

Run: `npx vitest run lib/nav.test.ts`
Expected: PASS (including the existing "five core modules" test, which uses `toContain` and is unaffected).

- [ ] **Step 4: Commit**

```bash
git add lib/nav.ts lib/nav.test.ts
git commit -m "feat(reconcile): add shipping-reconcile nav item"
```

---

## Task 10: Full verification

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run features/shipments lib/nav.test.ts`
Expected: all PASS.

- [ ] **Step 3: Manual smoke test**

With dev server + staging DB: load `/f/shipping-reconcile`, verify summary totals roughly match the audit (Σ Billed ≈ 4.1B, Σ Lệch ≈ 255.6M / 6.23% when no filter), expand a FedEx-SA row to confirm the fuel delta shows, mark one row reconciled and confirm it persists across reload, export CSV.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(reconcile): verification cleanup" || echo "nothing to commit"
```
