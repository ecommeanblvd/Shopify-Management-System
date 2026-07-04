# Order Lifecycle — Phase 2 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard `/f/lifecycle` theo dõi vòng đời mọi đơn: bảng theo công đoạn + lọc/sort delay, timeline chi tiết 1 đơn, trang cấu hình SLA.

**Architecture:** Đọc snapshot `order_lifecycle` (P1). Helper hiển thị thuần (stage label/tone/timeline) + queries (list/counts/detail/sla) + 1 action sửa SLA + trang server + bảng client. Không tính toán nặng client; không đổi P1.

**Tech Stack:** Next.js App Router (server components + server action), Vitest, Tailwind, RBAC.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-order-lifecycle-tracking-design.md` §6.
- Đọc `order_lifecycle` + `lifecycle_sla` (P1 đã có trên main + prod). KHÔNG đổi P1/schema/cron.
- RBAC: xem `view_fulfillment`; sửa SLA `manage_fulfillment`.
- Stage keys/labels theo §3; delay tone: overdue→bad(đỏ), due_soon→warn(vàng), on_track→ok(xanh).
- Time-in-stage tính SERVER (1 `now` mỗi query) → tránh hydration mismatch.
- Không thêm dependency. Chạy trước push: `tsc --noEmit` + `vitest run` + eslint xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `features/lifecycle/display.ts` (+test) | STAGE_LABELS/ORDER · delayTone · fmtDuration · hoursBetween · stageAnchorAt · buildTimeline (thuần) |
| `features/lifecycle/queries.ts` | listLifecycle(filter) · stageCounts · getLifecycle · listSla |
| `features/lifecycle/sla-actions.ts` | updateSla(key, hours) |
| `app/(dashboard)/f/lifecycle/page.tsx` + `LifecycleTable.tsx` | Dashboard bảng + lọc/sort |
| `app/(dashboard)/f/lifecycle/[orderId]/page.tsx` | Timeline chi tiết |
| `app/(dashboard)/f/lifecycle/sla/page.tsx` + `SlaEditor.tsx` | Cấu hình SLA |
| `lib/nav.ts` (modify) | + mục "Vòng đời đơn" |

---

### Task 1: `display.ts` — helper hiển thị (thuần)

**Files:**
- Create: `features/lifecycle/display.ts`
- Test: `features/lifecycle/display.test.ts`

**Interfaces:**
- Consumes: `StageKey` từ `./derive`.
- Produces: `STAGE_LABELS`, `STAGE_ORDER`, `type Tone`, `delayTone`, `fmtDuration`, `hoursBetween`, `stageAnchorAt`, `buildTimeline`, types `Milestones`, `TimelineStep`.

- [ ] **Step 1: Write the failing test** `features/lifecycle/display.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { delayTone, fmtDuration, hoursBetween, stageAnchorAt, buildTimeline, STAGE_LABELS } from './display';

describe('delayTone', () => {
  it('map trạng thái → tone', () => {
    expect(delayTone('overdue')).toBe('bad');
    expect(delayTone('due_soon')).toBe('warn');
    expect(delayTone('on_track')).toBe('ok');
  });
});

describe('fmtDuration', () => {
  it('null → —; <1h; giờ; ngày+giờ', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(0.5)).toBe('<1h');
    expect(fmtDuration(5)).toBe('5h');
    expect(fmtDuration(50)).toBe('2d 2h');
  });
});

describe('hoursBetween', () => {
  it('giờ giữa 2 mốc; thiếu → null; âm → 0', () => {
    expect(hoursBetween('2026-07-01T00:00:00Z', '2026-07-01T05:00:00Z')).toBe(5);
    expect(hoursBetween(null, '2026-07-01T05:00:00Z')).toBeNull();
    expect(hoursBetween('2026-07-01T05:00:00Z', '2026-07-01T00:00:00Z')).toBe(0);
  });
});

describe('stageAnchorAt', () => {
  const m = { placedAt: 'p', productionStartAt: 'ps', goodsReceivedAt: 'gr', qcPassAt: 'qc', packedAt: 'pk', shippedAt: 'sh', inTransitAt: 'it', outForDeliveryAt: 'ofd', deliveredAt: 'del', completedAt: 'cp' } as never;
  it('trả mốc vào stage hiện tại', () => {
    expect(stageAnchorAt('placed', m)).toBe('p');
    expect(stageAnchorAt('in_transit', m)).toBe('it');
    expect(stageAnchorAt('post_delivery', m)).toBe('del');
  });
  it('qc: ưu tiên qcPassAt, fallback goodsReceivedAt', () => {
    expect(stageAnchorAt('qc', { qcPassAt: 'qc', goodsReceivedAt: 'gr' } as never)).toBe('qc');
    expect(stageAnchorAt('qc', { qcPassAt: null, goodsReceivedAt: 'gr' } as never)).toBe('gr');
  });
  it('terminal/unknown → null', () => {
    expect(stageAnchorAt('cancelled', m)).toBeNull();
  });
});

describe('buildTimeline', () => {
  it('chỉ mốc đã đạt + duration từ mốc trước', () => {
    const steps = buildTimeline({
      placedAt: '2026-07-01T00:00:00Z', productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: '2026-07-01T10:00:00Z', shippedAt: '2026-07-02T10:00:00Z',
      inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
    });
    expect(steps.map((s) => s.label)).toEqual(['Đặt hàng', 'Đóng gói', 'Bàn giao carrier']);
    expect(steps[0].durationHrs).toBeNull();
    expect(steps[1].durationHrs).toBe(10);
    expect(steps[2].durationHrs).toBe(24);
  });
});

describe('STAGE_LABELS', () => {
  it('có nhãn cho mọi stage chính', () => {
    expect(STAGE_LABELS.delivered ?? STAGE_LABELS.post_delivery).toBeTruthy();
    expect(STAGE_LABELS.completed).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lifecycle/display.test.ts`
Expected: FAIL — "Cannot find module './display'".

- [ ] **Step 3: Implement** `features/lifecycle/display.ts`

```ts
/** THUẦN: nhãn/tone/định dạng + timeline cho UI vòng đời. Không I/O. */
import type { StageKey } from './derive';

export const STAGE_LABELS: Record<StageKey, string> = {
  placed: 'Đã đặt',
  production: 'Sản xuất',
  qc: 'QC',
  packed: 'Đóng gói',
  shipped: 'Đã gửi',
  in_transit: 'Vận chuyển',
  out_for_delivery: 'Đang giao',
  post_delivery: 'Sau giao (30 ngày)',
  completed: 'Hoàn tất',
  refunded_full: 'Hoàn tiền',
  cancelled: 'Đã huỷ',
};

export const STAGE_ORDER: StageKey[] = [
  'placed', 'production', 'qc', 'packed', 'shipped', 'in_transit',
  'out_for_delivery', 'post_delivery', 'completed', 'refunded_full', 'cancelled',
];

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export function delayTone(delayStatus: string): Tone {
  return delayStatus === 'overdue' ? 'bad' : delayStatus === 'due_soon' ? 'warn' : 'ok';
}

export function fmtDuration(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

const asMs = (v: Date | string | null): number | null =>
  v == null ? null : (v instanceof Date ? v : new Date(v)).getTime();

export function hoursBetween(a: Date | string | null, b: Date | string | null): number | null {
  const ta = asMs(a); const tb = asMs(b);
  if (ta == null || tb == null) return null;
  return Math.max(0, (tb - ta) / 3600_000);
}

export interface Milestones {
  placedAt: Date | string | null;
  productionStartAt: Date | string | null;
  goodsReceivedAt: Date | string | null;
  qcPassAt: Date | string | null;
  packedAt: Date | string | null;
  shippedAt: Date | string | null;
  inTransitAt: Date | string | null;
  outForDeliveryAt: Date | string | null;
  deliveredAt: Date | string | null;
  completedAt: Date | string | null;
}

/** Mốc thời điểm vào stage hiện tại (để đo "đã ở stage bao lâu"). */
export function stageAnchorAt(stage: string, m: Partial<Milestones>): Date | string | null {
  switch (stage) {
    case 'placed': return m.placedAt ?? null;
    case 'production': return m.productionStartAt ?? null;
    case 'qc': return m.qcPassAt ?? m.goodsReceivedAt ?? null;
    case 'packed': return m.packedAt ?? null;
    case 'shipped': return m.shippedAt ?? null;
    case 'in_transit': return m.inTransitAt ?? null;
    case 'out_for_delivery': return m.outForDeliveryAt ?? null;
    case 'post_delivery': return m.deliveredAt ?? null;
    case 'completed': return m.completedAt ?? null;
    default: return null;
  }
}

export interface TimelineStep { key: string; label: string; at: Date | string | null; durationHrs: number | null }

const TIMELINE_ORDER: Array<{ key: keyof Milestones; label: string }> = [
  { key: 'placedAt', label: 'Đặt hàng' },
  { key: 'productionStartAt', label: 'Gửi brand sản xuất' },
  { key: 'goodsReceivedAt', label: 'Hàng về kho' },
  { key: 'qcPassAt', label: 'QC pass' },
  { key: 'packedAt', label: 'Đóng gói' },
  { key: 'shippedAt', label: 'Bàn giao carrier' },
  { key: 'inTransitAt', label: 'Bắt đầu vận chuyển' },
  { key: 'outForDeliveryAt', label: 'Đang giao' },
  { key: 'deliveredAt', label: 'Đã giao' },
  { key: 'completedAt', label: 'Hoàn tất' },
];

/** Các mốc đã đạt (at != null) + duration từ mốc đã-đạt liền trước. */
export function buildTimeline(m: Milestones): TimelineStep[] {
  const reached = TIMELINE_ORDER.filter((s) => m[s.key] != null);
  return reached.map((s, i) => ({
    key: s.key as string,
    label: s.label,
    at: m[s.key],
    durationHrs: i === 0 ? null : hoursBetween(m[reached[i - 1].key], m[s.key]),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lifecycle/display.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Verify tsc + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add features/lifecycle/display.ts features/lifecycle/display.test.ts
git commit -m "feat(lifecycle): display helpers (label/tone/timeline) + test"
```

---

### Task 2: `queries.ts` — list/counts/detail/sla

**Files:**
- Create: `features/lifecycle/queries.ts`

**Interfaces:**
- Consumes: `stageAnchorAt`, `hoursBetween` (Task 1); `schema.orderLifecycle`, `schema.lifecycleSla`, `schema.shopifyOrders`, `schema.stores`.
- Produces:
  - `interface LifecycleListRow` (orderId, orderNumber, storeName, currentStage, exception, delayStatus, delayHours, deadline, timeInStageHrs)
  - `listLifecycle(filter?: { stage?: string; delay?: string; storeId?: string }): Promise<LifecycleListRow[]>`
  - `stageCounts(): Promise<Record<string, number>>`
  - `getLifecycle(orderId: string): Promise<(typeof schema.orderLifecycle.$inferSelect & { orderNumber: string | null; storeName: string | null }) | null>`
  - `listSla(): Promise<Array<{ key: string; targetHours: number; note: string | null }>>`

- [ ] **Step 1: Implement** `features/lifecycle/queries.ts`

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { stageAnchorAt, hoursBetween } from './display';

export interface LifecycleListRow {
  orderId: string;
  orderNumber: string | null;
  storeName: string | null;
  currentStage: string;
  exception: boolean;
  delayStatus: string;
  delayHours: number;
  deadline: Date | null;
  timeInStageHrs: number | null;
}

export async function listLifecycle(
  filter?: { stage?: string; delay?: string; storeId?: string },
): Promise<LifecycleListRow[]> {
  const conds = [];
  if (filter?.stage) conds.push(eq(schema.orderLifecycle.currentStage, filter.stage));
  if (filter?.delay) conds.push(eq(schema.orderLifecycle.delayStatus, filter.delay));
  if (filter?.storeId) conds.push(eq(schema.orderLifecycle.storeId, filter.storeId));

  const rows = await db.select({
    orderId: schema.orderLifecycle.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    currentStage: schema.orderLifecycle.currentStage,
    exception: schema.orderLifecycle.exception,
    delayStatus: schema.orderLifecycle.delayStatus,
    delayHours: schema.orderLifecycle.delayHours,
    deadline: schema.orderLifecycle.deadline,
    placedAt: schema.orderLifecycle.placedAt,
    productionStartAt: schema.orderLifecycle.productionStartAt,
    goodsReceivedAt: schema.orderLifecycle.goodsReceivedAt,
    qcPassAt: schema.orderLifecycle.qcPassAt,
    packedAt: schema.orderLifecycle.packedAt,
    shippedAt: schema.orderLifecycle.shippedAt,
    inTransitAt: schema.orderLifecycle.inTransitAt,
    outForDeliveryAt: schema.orderLifecycle.outForDeliveryAt,
    deliveredAt: schema.orderLifecycle.deliveredAt,
    completedAt: schema.orderLifecycle.completedAt,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderLifecycle.orderId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.orderLifecycle.delayHours), desc(schema.orderLifecycle.deadline));

  const now = new Date();
  return rows.map((r) => ({
    orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName,
    currentStage: r.currentStage, exception: r.exception,
    delayStatus: r.delayStatus, delayHours: r.delayHours, deadline: r.deadline,
    timeInStageHrs: hoursBetween(stageAnchorAt(r.currentStage, r), now),
  }));
}

export async function stageCounts(): Promise<Record<string, number>> {
  const rows = await db.select({
    stage: schema.orderLifecycle.currentStage,
    n: sql<number>`count(*)::int`,
  }).from(schema.orderLifecycle).groupBy(schema.orderLifecycle.currentStage);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stage] = r.n;
  return out;
}

export async function getLifecycle(orderId: string) {
  const [row] = await db.select({
    lc: schema.orderLifecycle,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderLifecycle.orderId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(eq(schema.orderLifecycle.orderId, orderId))
    .limit(1);
  if (!row) return null;
  return { ...row.lc, orderNumber: row.orderNumber, storeName: row.storeName };
}

export async function listSla(): Promise<Array<{ key: string; targetHours: number; note: string | null }>> {
  return db.select({
    key: schema.lifecycleSla.key,
    targetHours: schema.lifecycleSla.targetHours,
    note: schema.lifecycleSla.note,
  }).from(schema.lifecycleSla).orderBy(schema.lifecycleSla.key);
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit` → exit 0. (Nếu Drizzle phàn nàn `select({ lc: schema.orderLifecycle })` nested — dùng cách select cột phẳng rồi ghép; nhưng nested-select-table được hỗ trợ, giữ nguyên nếu tsc pass.)

- [ ] **Step 3: Commit**

```bash
git add features/lifecycle/queries.ts
git commit -m "feat(lifecycle): queries list/counts/detail/sla"
```

---

### Task 3: `updateSla` action + dashboard list page + table + nav

**Files:**
- Create: `features/lifecycle/sla-actions.ts`
- Create: `app/(dashboard)/f/lifecycle/page.tsx`
- Create: `app/(dashboard)/f/lifecycle/LifecycleTable.tsx`
- Modify: `lib/nav.ts`

**Interfaces:**
- Consumes: `listLifecycle`, `stageCounts` (Task 2); `STAGE_LABELS`, `STAGE_ORDER`, `delayTone`, `fmtDuration` (Task 1); auth `hasPermission(role,'view_fulfillment')`.
- Produces: `updateSla(key: string, targetHours: number): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: `sla-actions.ts`**

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export async function updateSla(key: string, targetHours: number): Promise<{ ok: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) return { ok: false, error: 'Không có quyền' };
  if (!Number.isFinite(targetHours) || targetHours <= 0) return { ok: false, error: 'Giờ không hợp lệ' };
  await db.update(schema.lifecycleSla)
    .set({ targetHours: Math.round(targetHours), updatedAt: new Date() })
    .where(eq(schema.lifecycleSla.key, key));
  revalidatePath('/f/lifecycle/sla');
  return { ok: true };
}
```

- [ ] **Step 2: Dashboard page** `app/(dashboard)/f/lifecycle/page.tsx`

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listLifecycle, stageCounts } from '@/features/lifecycle/queries';
import { LifecycleTable } from './LifecycleTable';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<{ stage?: string; delay?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([
    listLifecycle({ stage: sp.stage, delay: sp.delay }),
    stageCounts(),
  ]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Vòng đời đơn hàng</h1>
          <p className="text-sm text-muted-foreground">Theo dõi công đoạn xử lý từng đơn + cảnh báo trễ so với SLA.</p>
        </div>
        <Link href="/f/lifecycle/sla" className={buttonVariants({ variant: 'outline' })}>Cấu hình SLA</Link>
      </div>
      <LifecycleTable rows={rows} counts={counts} activeStage={sp.stage ?? null} activeDelay={sp.delay ?? null} />
    </div>
  );
}
```

- [ ] **Step 3: Table client** `app/(dashboard)/f/lifecycle/LifecycleTable.tsx`

```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { STAGE_LABELS, STAGE_ORDER, delayTone, fmtDuration, type Tone } from '@/features/lifecycle/display';
import type { LifecycleListRow } from '@/features/lifecycle/queries';
import { Card, CardContent } from '@/components/ui/card';

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  muted: 'bg-muted text-muted-foreground',
};

export function LifecycleTable({ rows, counts, activeStage, activeDelay }: {
  rows: LifecycleListRow[]; counts: Record<string, number>; activeStage: string | null; activeDelay: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (v == null || q.get(k) === v) q.delete(k); else q.set(k, v);
    router.push(`/f/lifecycle?${q.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STAGE_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} onClick={() => setParam('stage', s)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeStage === s ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {STAGE_LABELS[s]} · {counts[s]}
          </button>
        ))}
        <span className="mx-1 border-l" />
        {(['overdue', 'due_soon'] as const).map((d) => (
          <button key={d} onClick={() => setParam('delay', d)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeDelay === d ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {d === 'overdue' ? '🔴 Quá hạn' : '🟡 Sắp hạn'}
          </button>
        ))}
      </div>
      <Card><CardContent className="p-0 overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground">
            <tr className="[&>th]:text-left [&>th]:p-3">
              <th>Đơn</th><th>Store</th><th>Công đoạn</th><th>Đã ở</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Không có đơn khớp bộ lọc.</td></tr>
            ) : rows.map((r) => {
              const tone = delayTone(r.delayStatus);
              return (
                <tr key={r.orderId} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td><Link href={`/f/lifecycle/${r.orderId}`} className="font-medium underline-offset-2 hover:underline">{r.orderNumber ?? r.orderId.slice(0, 8)}</Link>{r.exception && <span className="ml-1" title="Sự cố">⚠️</span>}</td>
                  <td>{r.storeName ?? '—'}</td>
                  <td>{STAGE_LABELS[r.currentStage as keyof typeof STAGE_LABELS] ?? r.currentStage}</td>
                  <td>{fmtDuration(r.timeInStageHrs)}</td>
                  <td>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>
                      {r.delayStatus === 'overdue' ? `Trễ ${fmtDuration(r.delayHours)}` : r.delayStatus === 'due_soon' ? 'Sắp hạn' : 'Đúng hạn'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 4: Nav** — trong `lib/nav.ts`, thêm sau mục `/f/fulfillment` (dùng icon lucide đã import hoặc thêm `Activity`):

```tsx
  { href: '/f/lifecycle',     label: 'Vòng đời đơn',  icon: Activity,        requires: 'view_fulfillment' },
```

(Thêm `Activity` vào import lucide-react ở đầu `lib/nav.ts` nếu chưa có.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle" features/lifecycle lib/nav.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add features/lifecycle/sla-actions.ts "app/(dashboard)/f/lifecycle/page.tsx" "app/(dashboard)/f/lifecycle/LifecycleTable.tsx" lib/nav.ts
git commit -m "feat(lifecycle): dashboard bảng vòng đời + lọc theo stage/delay + updateSla + nav"
```

---

### Task 4: Timeline chi tiết `[orderId]`

**Files:**
- Create: `app/(dashboard)/f/lifecycle/[orderId]/page.tsx`

**Interfaces:**
- Consumes: `getLifecycle` (Task 2); `buildTimeline`, `fmtDuration`, `STAGE_LABELS` (Task 1); auth.

- [ ] **Step 1: Detail page** `app/(dashboard)/f/lifecycle/[orderId]/page.tsx`

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getLifecycle } from '@/features/lifecycle/queries';
import { buildTimeline, fmtDuration, STAGE_LABELS } from '@/features/lifecycle/display';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleString('vi-VN') : '—';

export default async function LifecycleDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const lc = await getLifecycle(orderId);
  if (!lc) notFound();
  const steps = buildTimeline(lc);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{lc.orderNumber ?? orderId.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">{lc.storeName ?? '—'} · {STAGE_LABELS[lc.currentStage as keyof typeof STAGE_LABELS] ?? lc.currentStage}{lc.exception && ' · ⚠️ sự cố'}</p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>
      <Card><CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Timeline</div>
        <ol className="relative border-l ml-2 space-y-6">
          {steps.map((s) => (
            <li key={s.key} className="ml-4">
              <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-foreground" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{fmt(s.at)}</span>
              </div>
              {s.durationHrs != null && <div className="text-xs text-muted-foreground">+{fmtDuration(s.durationHrs)} từ mốc trước</div>}
            </li>
          ))}
          {steps.length === 0 && <li className="ml-4 text-sm text-muted-foreground">Chưa có mốc nào.</li>}
        </ol>
      </CardContent></Card>
      {lc.deadline && lc.delayStatus !== 'on_track' && (
        <Card><CardContent className="p-4 text-sm">
          Deadline công đoạn hiện tại: <b>{fmt(lc.deadline)}</b>
          {lc.delayStatus === 'overdue' && <span className="text-red-600"> · trễ {fmtDuration(lc.delayHours)}</span>}
        </CardContent></Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle"` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/f/lifecycle/[orderId]"
git commit -m "feat(lifecycle): trang timeline chi tiết 1 đơn"
```

---

### Task 5: Trang cấu hình SLA

**Files:**
- Create: `app/(dashboard)/f/lifecycle/sla/page.tsx`
- Create: `app/(dashboard)/f/lifecycle/sla/SlaEditor.tsx`

**Interfaces:**
- Consumes: `listSla` (Task 2); `updateSla` (Task 3); auth.

- [ ] **Step 1: SLA page** `app/(dashboard)/f/lifecycle/sla/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listSla } from '@/features/lifecycle/queries';
import { SlaEditor } from './SlaEditor';

export const dynamic = 'force-dynamic';

export default async function SlaPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_fulfillment');
  const sla = await listSla();
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Cấu hình SLA vòng đời</h1>
      <p className="text-sm text-muted-foreground">Thời gian dự kiến (giờ) cho từng công đoạn — dùng để cảnh báo trễ.</p>
      <SlaEditor sla={sla} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: SLA editor** `app/(dashboard)/f/lifecycle/sla/SlaEditor.tsx`

```tsx
'use client';

import { useState, useTransition } from 'react';
import { updateSla } from '@/features/lifecycle/sla-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const KEY_LABEL: Record<string, string> = {
  placed_to_production: 'Đặt hàng → gửi brand',
  production: 'Sản xuất (brand → về kho)',
  qc: 'QC',
  pack: 'Đóng gói',
  ship: 'Bàn giao carrier',
  deliver: 'Giao hàng',
};

export function SlaEditor({ sla, canManage }: {
  sla: Array<{ key: string; targetHours: number; note: string | null }>; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(sla.map((s) => [s.key, String(s.targetHours)])));
  const [msg, setMsg] = useState<string | null>(null);

  const save = (key: string) =>
    start(async () => {
      setMsg(null);
      const r = await updateSla(key, Number(vals[key]));
      setMsg(r.ok ? `Đã lưu ${KEY_LABEL[key] ?? key}` : (r.error ?? 'Lỗi'));
    });

  return (
    <Card><CardContent className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Công đoạn</th><th>Giờ</th><th></th></tr></thead>
        <tbody>
          {sla.map((s) => (
            <tr key={s.key} className="border-b [&>td]:p-3">
              <td>{KEY_LABEL[s.key] ?? s.key}<div className="text-xs text-muted-foreground">{s.note}</div></td>
              <td><input className="w-24 border rounded px-2 py-1" value={vals[s.key]} disabled={!canManage}
                    onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} /></td>
              <td className="text-right">{canManage && <Button size="sm" variant="outline" onClick={() => save(s.key)} disabled={pending}>Lưu</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="text-sm p-3 border-t">{msg}</p>}
    </CardContent></Card>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle"` → no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/lifecycle/sla"
git commit -m "feat(lifecycle): trang cấu hình SLA + sửa targetHours"
```

---

## Self-Review

**1. Spec coverage (§6):**
- Bảng dashboard (store/order/stage/time-in-stage/delay badge/exception, lọc stage+delay, sort delayHours, chips đếm) → Task 2 (query) + Task 3 (page+table). ✔
- Timeline chi tiết 1 đơn (mốc + duration từng đoạn) → Task 1 (buildTimeline) + Task 4. ✔
- Trang cấu hình SLA (sửa targetHours, manage_fulfillment) → Task 2 (listSla) + Task 3 (updateSla) + Task 5. ✔
- Đọc snapshot, không tính nặng client (time-in-stage tính server) → Task 2. ✔ Nav → Task 3. ✔
- Không P3 (thống kê) — đúng scope. ✔

**2. Placeholder scan:** không TBD/TODO; code đầy đủ. NOTE Task 2 Step 2 (nested select fallback) là kiểm-chứng-thực-tế.

**3. Type consistency:**
- `StageKey` (P1 derive) → `STAGE_LABELS`/`STAGE_ORDER` (Task 1) → dùng ở Task 3/4. ✔
- `LifecycleListRow` (Task 2) khớp `LifecycleTable` props (Task 3). ✔
- `Milestones`/`buildTimeline`/`stageAnchorAt` (Task 1) — `getLifecycle` row có đủ field milestone (Task 2 trả `...schema.orderLifecycle` = mọi cột) → Task 4 truyền vào `buildTimeline`. ✔
- `updateSla(key, targetHours)` (Task 3) khớp `SlaEditor` (Task 5); `listSla` shape khớp. ✔
- `delayTone`/`fmtDuration` (Task 1) dùng nhất quán Task 3/4. ✔

## Execution Handoff (điền sau khi lưu plan)
