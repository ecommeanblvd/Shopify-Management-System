# Cảnh báo billed chưa khớp shipment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Liệt kê + cảnh báo các tracking trên hoá đơn carrier không khớp shipment nào (đơn rớt khỏi đối soát do tracking lệch), trên trang Đối soát ship + CSV export.

**Architecture:** Query LEFT JOIN `carrier_bill_lines` → `shipments` theo `trackingNumber` (lấy null), distinct theo tracking + helper thuần gom/đếm. Banner client trên trang reconcile + route CSV. Không đụng engine/cache đối soát.

**Tech Stack:** Next.js (RSC, route handler), Drizzle ORM, Vitest, `csvBody` (`@/lib/csv`).

## Global Constraints

- Branch off `main` (độc lập). Không migration (chỉ đọc).
- Phát hiện thống nhất DHL+FedEx: `carrier_bill_lines.trackingNumber` ≠ null **và** không `shipments` nào trùng tracking (LEFT JOIN, `shipments.id IS NULL`). KHÔNG dựa cột `carrier_bill_lines.shipmentId`.
- **Distinct theo tracking** (1 dòng/tracking).
- numeric đọc bằng `Number(...)`.
- Quyền `view_carrier_rates` (trang reconcile + route CSV).
- Không đụng engine đối soát/cache; query chạy song song ở page.

---

## Task 1: Data module — query + summarise thuần

**Files:**
- Create: `features/shipments/unmatched-billed.ts`
- Test: `features/shipments/unmatched-billed.test.ts`

**Interfaces — Produces:**
```ts
export interface UnmatchedBilledRow {
  tracking: string; billNumber: string | null; carrierKey: string | null;
  accountId: string; accountName: string; amountVnd: number | null; billPeriodStart: string | null;
}
export interface UnmatchedSummary { total: number; byCarrier: Array<{ carrierKey: string | null; count: number; sumVnd: number }> }
export function summariseUnmatched(rows: UnmatchedBilledRow[]): UnmatchedSummary
export async function listUnmatchedBilledTracking(): Promise<UnmatchedBilledRow[]>
```

- [ ] **Step 1: Failing test** (cho hàm thuần) — `features/shipments/unmatched-billed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { summariseUnmatched, type UnmatchedBilledRow } from './unmatched-billed';

const row = (o: Partial<UnmatchedBilledRow>): UnmatchedBilledRow => ({
  tracking: 't', billNumber: 'B', carrierKey: 'dhl', accountId: 'a', accountName: 'DHL', amountVnd: 1000, billPeriodStart: '2026-05-01', ...o,
});

describe('summariseUnmatched', () => {
  it('đếm tổng + gom theo carrier (count, Σ)', () => {
    const s = summariseUnmatched([
      row({ tracking: '1', carrierKey: 'dhl', amountVnd: 1000 }),
      row({ tracking: '2', carrierKey: 'dhl', amountVnd: 500 }),
      row({ tracking: '3', carrierKey: 'fedex', amountVnd: 2000 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byCarrier).toEqual([
      { carrierKey: 'dhl', count: 2, sumVnd: 1500 },
      { carrierKey: 'fedex', count: 1, sumVnd: 2000 },
    ]);
  });
  it('amountVnd null → cộng 0; rỗng → total 0', () => {
    expect(summariseUnmatched([]).total).toBe(0);
    const s = summariseUnmatched([row({ carrierKey: 'dhl', amountVnd: null })]);
    expect(s.byCarrier[0]).toEqual({ carrierKey: 'dhl', count: 1, sumVnd: 0 });
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/shipments/unmatched-billed.test.ts`.

- [ ] **Step 3: Implement** — `features/shipments/unmatched-billed.ts`:
```ts
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface UnmatchedBilledRow {
  tracking: string; billNumber: string | null; carrierKey: string | null;
  accountId: string; accountName: string; amountVnd: number | null; billPeriodStart: string | null;
}
export interface UnmatchedSummary { total: number; byCarrier: Array<{ carrierKey: string | null; count: number; sumVnd: number }> }

/** Gom theo carrier (thứ tự xuất hiện đầu): count + Σ amount. THUẦN. */
export function summariseUnmatched(rows: UnmatchedBilledRow[]): UnmatchedSummary {
  const map = new Map<string | null, { carrierKey: string | null; count: number; sumVnd: number }>();
  for (const r of rows) {
    const cur = map.get(r.carrierKey) ?? { carrierKey: r.carrierKey, count: 0, sumVnd: 0 };
    cur.count += 1;
    cur.sumVnd += r.amountVnd ?? 0;
    map.set(r.carrierKey, cur);
  }
  return { total: rows.length, byCarrier: [...map.values()] };
}

/** Tracking trên hoá đơn carrier KHÔNG khớp shipment nào (distinct theo tracking). */
export async function listUnmatchedBilledTracking(): Promise<UnmatchedBilledRow[]> {
  const raw = await db
    .select({
      tracking: schema.carrierBillLines.trackingNumber,
      total: schema.carrierBillLines.total,
      billNumber: schema.carrierBills.billNumber,
      billPeriodStart: schema.carrierBills.periodStart,
      accountId: schema.carrierAccounts.id,
      accountName: schema.carrierAccounts.name,
      carrierKey: schema.carrierAccounts.carrierKey,
    })
    .from(schema.carrierBillLines)
    .leftJoin(schema.shipments, eq(schema.shipments.trackingNumber, schema.carrierBillLines.trackingNumber))
    .innerJoin(schema.carrierBills, eq(schema.carrierBills.id, schema.carrierBillLines.billId))
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.carrierBills.carrierAccountId))
    .where(and(isNotNull(schema.carrierBillLines.trackingNumber), isNull(schema.shipments.id)))
    .orderBy(asc(schema.carrierAccounts.name), asc(schema.carrierBillLines.trackingNumber));

  // Distinct theo tracking (1 dòng/tracking — dòng đầu đại diện).
  const seen = new Set<string>();
  const out: UnmatchedBilledRow[] = [];
  for (const r of raw) {
    const t = r.tracking as string; // isNotNull đã lọc
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({
      tracking: t,
      billNumber: r.billNumber ?? null,
      carrierKey: r.carrierKey ?? null,
      accountId: r.accountId,
      accountName: r.accountName,
      amountVnd: r.total !== null ? Number(r.total) : null,
      billPeriodStart: r.billPeriodStart ?? null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS** `npx vitest run features/shipments/unmatched-billed.test.ts` + `npx tsc --noEmit` + `npx eslint features/shipments/unmatched-billed.ts features/shipments/unmatched-billed.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/shipments/unmatched-billed.ts features/shipments/unmatched-billed.test.ts
git commit -m "feat(reconcile): query + summarise tracking billed chưa khớp shipment"
```

---

## Task 2: UI banner + wire trang reconcile + CSV route

**Files:**
- Create: `components/shipping-reconcile/UnmatchedBilledBanner.tsx`
- Create: `app/(dashboard)/f/shipping-reconcile/unmatched-billed.csv/route.ts`
- Modify: `app/(dashboard)/f/shipping-reconcile/page.tsx`

**Interfaces — Consumes:** `listUnmatchedBilledTracking`, `summariseUnmatched`, `UnmatchedBilledRow` (Task 1).

- [ ] **Step 1: Banner component** — `components/shipping-reconcile/UnmatchedBilledBanner.tsx` (`'use client'`):
```tsx
'use client';
import { useState } from 'react';
import type { UnmatchedBilledRow } from '@/features/shipments/unmatched-billed';

const fmt = (n: number | null) => n === null ? '—' : Math.round(n).toLocaleString('vi-VN');

export function UnmatchedBilledBanner({ rows }: { rows: UnmatchedBilledRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpen((v) => !v)} className="text-left font-medium text-amber-700 dark:text-amber-400">
          ⚠ {rows.length} tracking trên hoá đơn chưa khớp shipment nào — kiểm tra tracking vận hành {open ? '▲' : '▼'}
        </button>
        <a href="/f/shipping-reconcile/unmatched-billed.csv" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Tải CSV</a>
      </div>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left"><th className="py-1 pr-3">Tracking</th><th className="py-1 pr-3">Hoá đơn</th><th className="py-1 pr-3">Carrier/Account</th><th className="py-1 pr-3">Số tiền</th><th className="py-1 pr-3">Kỳ</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tracking} className="border-t border-border/60">
                  <td className="py-1 pr-3 font-mono">{r.tracking}</td>
                  <td className="py-1 pr-3">{r.billNumber ?? '—'}</td>
                  <td className="py-1 pr-3">{r.carrierKey ?? '—'} · {r.accountName}</td>
                  <td className="py-1 pr-3 tabular-nums">{fmt(r.amountVnd)}</td>
                  <td className="py-1 pr-3">{r.billPeriodStart ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire vào page** — `app/(dashboard)/f/shipping-reconcile/page.tsx`:
  - Import: `import { listUnmatchedBilledTracking } from '@/features/shipments/unmatched-billed';` và `import { UnmatchedBilledBanner } from '@/components/shipping-reconcile/UnmatchedBilledBanner';`.
  - Thêm `listUnmatchedBilledTracking()` vào nhóm query song song (thêm 1 await; có thể đặt cạnh `listCarrierErrors()` hoặc gọi riêng: `const unmatchedBilled = await listUnmatchedBilledTracking();`).
  - Trong JSX, NGAY DƯỚI khối `<div>…<h1>Đối soát phí ship</h1>…</div>` và TRƯỚC `<ReconcileTable …/>`, chèn: `<UnmatchedBilledBanner rows={unmatchedBilled} />`.

- [ ] **Step 3: CSV route** — `app/(dashboard)/f/shipping-reconcile/unmatched-billed.csv/route.ts` (mirror `carrier-errors.csv`):
```ts
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { listUnmatchedBilledTracking } from '@/features/shipments/unmatched-billed';

export const dynamic = 'force-dynamic';

const HEADER = ['tracking', 'bill_number', 'carrier', 'account', 'amount_vnd', 'bill_period_start'];

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new Response('Forbidden', { status: 403 });

  const rows = await listUnmatchedBilledTracking();
  const out: CsvValue[][] = rows.map((r) => [r.tracking, r.billNumber, r.carrierKey, r.accountName, r.amountVnd, r.billPeriodStart]);
  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="unmatched-billed.csv"',
      'cache-control': 'no-store',
    },
  });
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx eslint components/shipping-reconcile/UnmatchedBilledBanner.tsx "app/(dashboard)/f/shipping-reconcile/page.tsx" "app/(dashboard)/f/shipping-reconcile/unmatched-billed.csv/route.ts"` + `npm run build`.

- [ ] **Step 5: Commit**
```bash
git add components/shipping-reconcile/UnmatchedBilledBanner.tsx "app/(dashboard)/f/shipping-reconcile/page.tsx" "app/(dashboard)/f/shipping-reconcile/unmatched-billed.csv/route.ts"
git commit -m "feat(reconcile): banner + CSV tracking billed chưa khớp shipment"
```

---

## Task 3: Verify toàn nhánh + PR

- [ ] **Step 1:** `npx tsc --noEmit` (sạch).
- [ ] **Step 2:** `npx vitest run` (toàn bộ pass — báo số).
- [ ] **Step 3:** `npm run build` (thành công).
- [ ] **Step 4:** Final whole-branch review (subagent-driven tự chạy).
- [ ] **Step 5:** Push + PR base `main`, body Summary + Test Plan: banner hiện khi có tracking billed không khớp shipment; CSV export; ẩn khi 0; quyền view_carrier_rates.

---

## Self-review notes
- Spec §1 query → T1. §2 summarise thuần → T1. §3 UI banner + page → T2. §4 CSV → T2. Verify+PR → T3.
- Type nhất quán: `UnmatchedBilledRow`/`summariseUnmatched`/`listUnmatchedBilledTracking` (T1) dùng ở T2 (banner, page, CSV).
- Distinct theo tracking xử lý trong `listUnmatchedBilledTracking` (Set) — summarise đếm rows đã distinct.
- Không migration, không đụng engine/cache.
