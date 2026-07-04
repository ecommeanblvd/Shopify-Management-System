# Order Lifecycle P3 — Thống kê — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang thống kê vòng đời đơn: avg + median thời gian mỗi công đoạn + tỉ lệ overdue, breakdown/filter theo brand/carrier/store/tháng.

**Architecture:** Đọc-thuần trên `order_lifecycle` (đã có mốc từ P1). Logic tổng hợp tách vào module thuần `stats-logic.ts` (test đầy đủ); query mỏng `stats-queries.ts` gom mốc + brands (vendor) + carriers (carrierKey); UI server-component `/f/lifecycle/stats` + client `StatsView` cho bộ điều khiển. KHÔNG migration, KHÔNG ghi DB, KHÔNG đụng P1/P2.

**Tech Stack:** Next.js App Router, Drizzle ORM (Postgres), Vitest, React 19, Tailwind.

## Global Constraints

- KHÔNG bảng mới / KHÔNG migration / KHÔNG ghi DB — chỉ đọc `order_lifecycle`, `shopify_order_lines`, `shipments`, `stores`.
- 6 công đoạn (SlaKey) đúng thứ tự: `placed_to_production`, `production`, `qc`, `pack`, `ship`, `deliver`.
- Duration mỗi đoạn = hiệu 2 mốc; **null nếu thiếu bất kỳ mốc nào** (đoạn chưa xong) → không tính vào đoạn đó.
- `pack` neo đầu = `qcPassAt ?? goodsReceivedAt ?? placedAt` (fallback khi skip qc/production).
- `overdue` 1 đơn ở 1 đoạn = `dur > slaHours(đoạn)` (dùng SLA từ bảng `lifecycle_sla`).
- Đơn nhiều brand/carrier → **explode**: tính cho MỖI brand/carrier.
- RBAC trang: `view_fulfillment` (mirror `/f/lifecycle`).
- Import `hoursBetween` từ `./display` (đã có + đã test) — không viết lại phép trừ giờ.
- Tiếng Việt cho nhãn UI; tuân AGENTS.md (Next.js bản này khác — theo pattern các trang `f/lifecycle` hiện có).

---

### Task 1: Module thuần `stats-logic.ts` + test

**Files:**
- Create: `features/lifecycle/stats-logic.ts`
- Test: `features/lifecycle/stats-logic.test.ts`

**Interfaces:**
- Consumes: `hoursBetween(a, b)` từ `features/lifecycle/display.ts` (trả `number|null`, kẹp ≥0).
- Produces (later tasks rely on these exact names/types):
  - `type SlaKey = 'placed_to_production'|'production'|'qc'|'pack'|'ship'|'deliver'`
  - `const SLA_SEGMENTS: SlaKey[]`
  - `interface DurationMilestones` (7 mốc, mỗi mốc `Date|string|null`)
  - `function computeDurations(m: DurationMilestones): Record<SlaKey, number|null>`
  - `interface DurationRow { orderId: string; storeId: string; storeName: string|null; placedMonth: string|null; brands: string[]; carriers: string[]; dur: Record<SlaKey, number|null> }`
  - `function median(nums: number[]): number|null`
  - `type GroupBy = 'none'|'brand'|'carrier'|'month'`
  - `interface StageStat { avgHrs: number|null; medianHrs: number|null; overdueRate: number; n: number }`
  - `interface StatGroup { key: string; orders: number; perStage: Record<SlaKey, StageStat> }`
  - `function aggregateLifecycle(rows: DurationRow[], sla: Record<SlaKey, number>, groupBy: GroupBy): StatGroup[]`

- [ ] **Step 1: Write the failing test**

```ts
// features/lifecycle/stats-logic.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeDurations, median, aggregateLifecycle, SLA_SEGMENTS,
  type DurationRow, type SlaKey,
} from './stats-logic';

const SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};
const H = 3600_000;
const base = new Date('2026-01-01T00:00:00Z').getTime();
const at = (h: number) => new Date(base + h * H);

function row(over: Partial<DurationRow>): DurationRow {
  return {
    orderId: 'o', storeId: 's', storeName: 'S', placedMonth: '2026-01',
    brands: [], carriers: [], dur: {} as Record<SlaKey, number>, ...over,
  };
}

describe('computeDurations', () => {
  it('tính đủ 6 đoạn khi có mốc', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: at(10), goodsReceivedAt: at(100),
      qcPassAt: at(110), packedAt: at(120), shippedAt: at(130), deliveredAt: at(300),
    });
    expect(d.placed_to_production).toBe(10);
    expect(d.production).toBe(90);
    expect(d.qc).toBe(10);
    expect(d.pack).toBe(10); // qcPassAt(110)->packedAt(120)
    expect(d.ship).toBe(10);
    expect(d.deliver).toBe(170);
  });

  it('thiếu mốc → đoạn đó null', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: at(50), shippedAt: null, deliveredAt: null,
    });
    expect(d.placed_to_production).toBeNull();
    expect(d.production).toBeNull();
    expect(d.qc).toBeNull();
    expect(d.pack).toBe(50); // fallback neo = placedAt(0) -> packedAt(50)
    expect(d.ship).toBeNull();
    expect(d.deliver).toBeNull();
  });

  it('pack neo fallback goodsReceivedAt khi không có qc', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: at(5), goodsReceivedAt: at(20),
      qcPassAt: null, packedAt: at(30), shippedAt: null, deliveredAt: null,
    });
    expect(d.pack).toBe(10); // goodsReceivedAt(20)->packedAt(30)
  });
});

describe('median', () => {
  it('rỗng → null', () => { expect(median([])).toBeNull(); });
  it('lẻ → phần tử giữa', () => { expect(median([3, 1, 2])).toBe(2); });
  it('chẵn → trung bình 2 giữa', () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
});

describe('aggregateLifecycle', () => {
  it('groupBy none: avg/median/overdue/n theo đoạn, bỏ đoạn null', () => {
    const rows = [
      row({ dur: { ...z(), production: 100 } }),
      row({ dur: { ...z(), production: 300 } }), // overdue (>240)
      row({ dur: { ...z(), production: null } }), // không tính
    ];
    const [g] = aggregateLifecycle(rows, SLA, 'none');
    expect(g.key).toBe('Tất cả');
    expect(g.perStage.production.n).toBe(2);
    expect(g.perStage.production.avgHrs).toBe(200);
    expect(g.perStage.production.medianHrs).toBe(200);
    expect(g.perStage.production.overdueRate).toBe(0.5);
    expect(g.perStage.qc.n).toBe(0);
    expect(g.perStage.qc.avgHrs).toBeNull();
    expect(g.perStage.qc.overdueRate).toBe(0);
  });

  it('groupBy brand explode: 1 đơn 2 brand tính cả 2', () => {
    const rows = [row({ brands: ['A', 'B'], dur: { ...z(), qc: 60 } })];
    const gs = aggregateLifecycle(rows, SLA, 'brand');
    expect(gs.map((g) => g.key).sort()).toEqual(['A', 'B']);
    expect(gs.find((g) => g.key === 'A')!.perStage.qc.n).toBe(1);
    expect(gs.find((g) => g.key === 'B')!.perStage.qc.overdueRate).toBe(1); // 60>48
  });

  it('groupBy brand: đơn không brand → nhóm "(không brand)"', () => {
    const gs = aggregateLifecycle([row({ brands: [] })], SLA, 'brand');
    expect(gs[0].key).toBe('(không brand)');
  });

  it('groupBy month: gom theo placedMonth, sắp tăng dần', () => {
    const rows = [
      row({ placedMonth: '2026-02', dur: { ...z(), ship: 10 } }),
      row({ placedMonth: '2026-01', dur: { ...z(), ship: 10 } }),
    ];
    const gs = aggregateLifecycle(rows, SLA, 'month');
    expect(gs.map((g) => g.key)).toEqual(['2026-01', '2026-02']);
  });

  it('brand/carrier sắp theo số đơn giảm dần', () => {
    const rows = [
      row({ brands: ['A'] }), row({ brands: ['A'] }), row({ brands: ['B'] }),
    ];
    const gs = aggregateLifecycle(rows, SLA, 'brand');
    expect(gs.map((g) => g.key)).toEqual(['A', 'B']); // A có 2 đơn
    expect(gs[0].orders).toBe(2);
  });
});

// helper: mọi đoạn null
function z(): Record<SlaKey, number | null> {
  return { placed_to_production: null, production: null, qc: null, pack: null, ship: null, deliver: null };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lifecycle/stats-logic.test.ts`
Expected: FAIL — `Cannot find module './stats-logic'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// features/lifecycle/stats-logic.ts
/** THUẦN: tổng hợp thống kê vòng đời. Không I/O. */
import { hoursBetween } from './display';

export type SlaKey =
  | 'placed_to_production' | 'production' | 'qc' | 'pack' | 'ship' | 'deliver';

export const SLA_SEGMENTS: SlaKey[] = [
  'placed_to_production', 'production', 'qc', 'pack', 'ship', 'deliver',
];

export interface DurationMilestones {
  placedAt: Date | string | null;
  productionStartAt: Date | string | null;
  goodsReceivedAt: Date | string | null;
  qcPassAt: Date | string | null;
  packedAt: Date | string | null;
  shippedAt: Date | string | null;
  deliveredAt: Date | string | null;
}

/** Duration (giờ) mỗi đoạn; null nếu thiếu mốc. */
export function computeDurations(m: DurationMilestones): Record<SlaKey, number | null> {
  const packAnchor = m.qcPassAt ?? m.goodsReceivedAt ?? m.placedAt;
  return {
    placed_to_production: hoursBetween(m.placedAt, m.productionStartAt),
    production: hoursBetween(m.productionStartAt, m.goodsReceivedAt),
    qc: hoursBetween(m.goodsReceivedAt, m.qcPassAt),
    pack: hoursBetween(packAnchor, m.packedAt),
    ship: hoursBetween(m.packedAt, m.shippedAt),
    deliver: hoursBetween(m.shippedAt, m.deliveredAt),
  };
}

export interface DurationRow {
  orderId: string;
  storeId: string;
  storeName: string | null;
  placedMonth: string | null;
  brands: string[];
  carriers: string[];
  dur: Record<SlaKey, number | null>;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type GroupBy = 'none' | 'brand' | 'carrier' | 'month';

export interface StageStat {
  avgHrs: number | null;
  medianHrs: number | null;
  overdueRate: number;
  n: number;
}

export interface StatGroup {
  key: string;
  orders: number;
  perStage: Record<SlaKey, StageStat>;
}

function groupKeys(row: DurationRow, by: GroupBy): string[] {
  switch (by) {
    case 'none': return ['Tất cả'];
    case 'month': return [row.placedMonth ?? '(không rõ)'];
    case 'brand': return row.brands.length ? row.brands : ['(không brand)'];
    case 'carrier': return row.carriers.length ? row.carriers : ['(không carrier)'];
  }
}

export function aggregateLifecycle(
  rows: DurationRow[], sla: Record<SlaKey, number>, groupBy: GroupBy,
): StatGroup[] {
  // key -> { orders, seg -> number[] }
  const acc = new Map<string, { orders: number; segs: Record<SlaKey, number[]> }>();
  for (const r of rows) {
    for (const k of groupKeys(r, groupBy)) {
      let g = acc.get(k);
      if (!g) {
        g = { orders: 0, segs: emptySegs() };
        acc.set(k, g);
      }
      g.orders += 1;
      for (const seg of SLA_SEGMENTS) {
        const v = r.dur[seg];
        if (v != null) g.segs[seg].push(v);
      }
    }
  }

  const groups: StatGroup[] = [];
  for (const [key, g] of acc) {
    const perStage = {} as Record<SlaKey, StageStat>;
    for (const seg of SLA_SEGMENTS) {
      const xs = g.segs[seg];
      const n = xs.length;
      const avgHrs = n ? xs.reduce((a, b) => a + b, 0) / n : null;
      const overdue = xs.filter((v) => v > sla[seg]).length;
      perStage[seg] = {
        avgHrs, medianHrs: median(xs), overdueRate: n ? overdue / n : 0, n,
      };
    }
    groups.push({ key, orders: g.orders, perStage });
  }

  groups.sort((a, b) =>
    groupBy === 'month' || groupBy === 'none'
      ? a.key.localeCompare(b.key)
      : b.orders - a.orders || a.key.localeCompare(b.key),
  );
  return groups;
}

function emptySegs(): Record<SlaKey, number[]> {
  return {
    placed_to_production: [], production: [], qc: [], pack: [], ship: [], deliver: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lifecycle/stats-logic.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 lỗi.
```bash
git add features/lifecycle/stats-logic.ts features/lifecycle/stats-logic.test.ts
git commit -m "feat(lifecycle): stats-logic thuần (computeDurations/median/aggregate) + test"
```

---

### Task 2: Query `stats-queries.ts` (durations + stores)

**Files:**
- Create: `features/lifecycle/stats-queries.ts`

**Interfaces:**
- Consumes: `computeDurations`, `DurationRow` từ `./stats-logic`; `db`, `schema` từ `@/db/client`; drizzle `and/eq/gte/lte/isNotNull/sql`.
  - Schema thực tế: `orderLifecycle` (orderId, storeId, placedAt, productionStartAt, goodsReceivedAt, qcPassAt, packedAt, shippedAt, deliveredAt), `shopifyOrderLines` (orderId, vendor nullable), `shipments` (orderId, carrierKey nullable), `stores` (id, name).
- Produces:
  - `interface StatsFilter { storeId?: string; brand?: string; carrier?: string; fromMonth?: string; toMonth?: string }`
  - `function lifecycleDurations(filter?: StatsFilter): Promise<DurationRow[]>`
  - `function listLifecycleStores(): Promise<Array<{ id: string; name: string | null }>>`
  - `function listBrandOptions(): Promise<string[]>` và `function listCarrierOptions(): Promise<string[]>` (cho dropdown filter)

- [ ] **Step 1: Implement query**

```ts
// features/lifecycle/stats-queries.ts
import { and, eq, gte, lte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { computeDurations, type DurationRow } from './stats-logic';

export interface StatsFilter {
  storeId?: string;
  brand?: string;
  carrier?: string;
  fromMonth?: string; // 'YYYY-MM'
  toMonth?: string;   // 'YYYY-MM'
}

const monthExpr = sql<string>`to_char(${schema.orderLifecycle.placedAt}, 'YYYY-MM')`;

export async function lifecycleDurations(filter?: StatsFilter): Promise<DurationRow[]> {
  const conds = [];
  if (filter?.storeId) conds.push(eq(schema.orderLifecycle.storeId, filter.storeId));
  if (filter?.fromMonth) conds.push(gte(monthExpr, filter.fromMonth));
  if (filter?.toMonth) conds.push(lte(monthExpr, filter.toMonth));

  const base = await db.select({
    orderId: schema.orderLifecycle.orderId,
    storeId: schema.orderLifecycle.storeId,
    storeName: schema.stores.name,
    placedMonth: monthExpr,
    placedAt: schema.orderLifecycle.placedAt,
    productionStartAt: schema.orderLifecycle.productionStartAt,
    goodsReceivedAt: schema.orderLifecycle.goodsReceivedAt,
    qcPassAt: schema.orderLifecycle.qcPassAt,
    packedAt: schema.orderLifecycle.packedAt,
    shippedAt: schema.orderLifecycle.shippedAt,
    deliveredAt: schema.orderLifecycle.deliveredAt,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(conds.length ? and(...conds) : undefined);

  // brands theo đơn (vendor distinct)
  const brandRows = await db.select({
    orderId: schema.shopifyOrderLines.orderId,
    brands: sql<string[]>`array_agg(distinct ${schema.shopifyOrderLines.vendor})`,
  })
    .from(schema.shopifyOrderLines)
    .where(isNotNull(schema.shopifyOrderLines.vendor))
    .groupBy(schema.shopifyOrderLines.orderId);
  const brandMap = new Map(brandRows.map((r) => [r.orderId, (r.brands ?? []).filter(Boolean)]));

  // carriers theo đơn (carrierKey distinct)
  const carrierRows = await db.select({
    orderId: schema.shipments.orderId,
    carriers: sql<string[]>`array_agg(distinct ${schema.shipments.carrierKey})`,
  })
    .from(schema.shipments)
    .where(isNotNull(schema.shipments.carrierKey))
    .groupBy(schema.shipments.orderId);
  const carrierMap = new Map(carrierRows.map((r) => [r.orderId, (r.carriers ?? []).filter(Boolean)]));

  const rows: DurationRow[] = base.map((b) => ({
    orderId: b.orderId,
    storeId: b.storeId,
    storeName: b.storeName,
    placedMonth: b.placedMonth,
    brands: brandMap.get(b.orderId) ?? [],
    carriers: carrierMap.get(b.orderId) ?? [],
    dur: computeDurations(b),
  }));

  return rows.filter((r) => {
    if (filter?.brand && !r.brands.includes(filter.brand)) return false;
    if (filter?.carrier && !r.carriers.includes(filter.carrier)) return false;
    return true;
  });
}

export async function listLifecycleStores(): Promise<Array<{ id: string; name: string | null }>> {
  const rows = await db.selectDistinct({
    id: schema.stores.id,
    name: schema.stores.name,
  })
    .from(schema.orderLifecycle)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .orderBy(schema.stores.name);
  return rows;
}

export async function listBrandOptions(): Promise<string[]> {
  const rows = await db.selectDistinct({ vendor: schema.shopifyOrderLines.vendor })
    .from(schema.shopifyOrderLines)
    .where(isNotNull(schema.shopifyOrderLines.vendor))
    .orderBy(schema.shopifyOrderLines.vendor);
  return rows.map((r) => r.vendor!).filter(Boolean);
}

export async function listCarrierOptions(): Promise<string[]> {
  const rows = await db.selectDistinct({ carrierKey: schema.shipments.carrierKey })
    .from(schema.shipments)
    .where(isNotNull(schema.shipments.carrierKey))
    .orderBy(schema.shipments.carrierKey);
  return rows.map((r) => r.carrierKey!).filter(Boolean);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 lỗi. (Nếu `gte/lte` trên `sql` expr báo type, ép kiểu bằng cách bọc `monthExpr` — nhưng drizzle chấp nhận SQL cho toán tử so sánh; giữ nguyên nếu pass.)

- [ ] **Step 3: Smoke test query trên prod (đọc-thuần, an toàn)**

Run: `railway run npx tsx -e "import('./features/lifecycle/stats-queries.ts').then(async m => { const r = await m.lifecycleDurations(); console.log('rows', r.length, 'sample', JSON.stringify(r[0], null, 2)); process.exit(0); })"`
Expected: in ra số đơn (~1600) + 1 sample có `brands`, `carriers`, `dur`. (Chỉ SELECT — không ghi.)

- [ ] **Step 4: Commit**

```bash
git add features/lifecycle/stats-queries.ts
git commit -m "feat(lifecycle): stats-queries (lifecycleDurations + stores/brand/carrier options)"
```

---

### Task 3: UI `/f/lifecycle/stats` + StatsView + nav link

**Files:**
- Create: `app/(dashboard)/f/lifecycle/stats/page.tsx`
- Create: `app/(dashboard)/f/lifecycle/stats/StatsView.tsx`
- Modify: `app/(dashboard)/f/lifecycle/page.tsx` (thêm link "Thống kê" cạnh "Cấu hình SLA")

**Interfaces:**
- Consumes: `lifecycleDurations`, `listLifecycleStores`, `listBrandOptions`, `listCarrierOptions` (Task 2); `listSla` từ `./queries`; `aggregateLifecycle`, `SLA_SEGMENTS`, `type SlaKey`, `type GroupBy`, `type StatGroup` từ `./stats-logic`; `fmtDuration` từ `./display`; auth/getRole/hasPermission như `page.tsx` hiện có.
- SLA map dựng từ `listSla()`: `Record<SlaKey, number>` (mặc định 0 nếu thiếu key).

- [ ] **Step 1: Server page (RBAC + compute)**

```tsx
// app/(dashboard)/f/lifecycle/stats/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import {
  lifecycleDurations, listLifecycleStores, listBrandOptions, listCarrierOptions,
} from '@/features/lifecycle/stats-queries';
import { listSla } from '@/features/lifecycle/queries';
import { aggregateLifecycle, SLA_SEGMENTS, type SlaKey, type GroupBy } from '@/features/lifecycle/stats-logic';
import { buttonVariants } from '@/components/ui/button';
import { StatsView } from './StatsView';

export const dynamic = 'force-dynamic';

const GROUP_BYS: GroupBy[] = ['none', 'brand', 'carrier', 'month'];

export default async function LifecycleStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; brand?: string; carrier?: string; from?: string; to?: string; by?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const sp = await searchParams;
  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(sp.by ?? '') ? (sp.by as GroupBy) : 'none';
  const filter = {
    storeId: sp.store || undefined,
    brand: sp.brand || undefined,
    carrier: sp.carrier || undefined,
    fromMonth: sp.from || undefined,
    toMonth: sp.to || undefined,
  };

  const [rows, slaRows, stores, brands, carriers] = await Promise.all([
    lifecycleDurations(filter),
    listSla(),
    listLifecycleStores(),
    listBrandOptions(),
    listCarrierOptions(),
  ]);

  const sla = {} as Record<SlaKey, number>;
  for (const s of SLA_SEGMENTS) sla[s] = 0;
  for (const r of slaRows) if ((SLA_SEGMENTS as string[]).includes(r.key)) sla[r.key as SlaKey] = r.targetHours;

  const groups = aggregateLifecycle(rows, sla, groupBy);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Thống kê vòng đời</h1>
          <p className="text-sm text-muted-foreground">Thời gian trung bình/trung vị mỗi công đoạn + tỉ lệ trễ. {rows.length} đơn.</p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Dashboard</Link>
      </div>
      <StatsView
        groups={groups}
        sla={sla}
        stores={stores}
        brands={brands}
        carriers={carriers}
        active={{ store: sp.store ?? '', brand: sp.brand ?? '', carrier: sp.carrier ?? '', from: sp.from ?? '', to: sp.to ?? '', by: groupBy }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Client StatsView (bộ điều khiển + bảng)**

```tsx
// app/(dashboard)/f/lifecycle/stats/StatsView.tsx
'use client';
import { useRouter } from 'next/navigation';
import { STAGE_LABELS_SEG, SLA_SEGMENTS, type SlaKey, type GroupBy, type StatGroup } from './seg-labels';
import { fmtDuration } from '@/features/lifecycle/display';

export interface StatsViewProps {
  groups: StatGroup[];
  sla: Record<SlaKey, number>;
  stores: Array<{ id: string; name: string | null }>;
  brands: string[];
  carriers: string[];
  active: { store: string; brand: string; carrier: string; from: string; to: string; by: GroupBy };
}

const GROUP_TABS: Array<{ by: GroupBy; label: string }> = [
  { by: 'none', label: 'Tổng' },
  { by: 'brand', label: 'Theo Brand' },
  { by: 'carrier', label: 'Theo Carrier' },
  { by: 'month', label: 'Theo Tháng' },
];

function tone(rate: number): string {
  if (rate >= 0.3) return 'text-red-600';
  if (rate >= 0.1) return 'text-amber-600';
  return 'text-emerald-600';
}

export function StatsView({ groups, sla, stores, brands, carriers, active }: StatsViewProps) {
  const router = useRouter();

  function apply(patch: Partial<typeof active>) {
    const next = { ...active, ...patch };
    const q = new URLSearchParams();
    if (next.store) q.set('store', next.store);
    if (next.brand) q.set('brand', next.brand);
    if (next.carrier) q.set('carrier', next.carrier);
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
    if (next.by && next.by !== 'none') q.set('by', next.by);
    router.push(`/f/lifecycle/stats?${q.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Bộ lọc */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Store</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.store}
            onChange={(e) => apply({ store: e.target.value })}>
            <option value="">Tất cả store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Brand</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.brand}
            onChange={(e) => apply({ brand: e.target.value })}>
            <option value="">Tất cả brand</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Carrier</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.carrier}
            onChange={(e) => apply({ carrier: e.target.value })}>
            <option value="">Tất cả carrier</option>
            {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Từ tháng</span>
          <input type="month" className="h-9 rounded-md border bg-background px-2" value={active.from}
            onChange={(e) => apply({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Đến tháng</span>
          <input type="month" className="h-9 rounded-md border bg-background px-2" value={active.to}
            onChange={(e) => apply({ to: e.target.value })} />
        </label>
      </div>

      {/* Tabs breakdown */}
      <div className="flex gap-2">
        {GROUP_TABS.map((t) => (
          <button key={t.by} onClick={() => apply({ by: t.by })}
            className={`px-3 py-1.5 rounded-md text-sm border ${active.by === t.by ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Bảng */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{active.by === 'none' ? '' : GROUP_TABS.find((t) => t.by === active.by)!.label}</th>
              <th className="px-3 py-2 text-right font-medium">Đơn</th>
              {SLA_SEGMENTS.map((seg) => (
                <th key={seg} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {STAGE_LABELS_SEG[seg]}<br /><span className="text-xs text-muted-foreground">SLA {fmtDuration(sla[seg])}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={SLA_SEGMENTS.length + 2} className="px-3 py-8 text-center text-muted-foreground">Không có dữ liệu.</td></tr>
            )}
            {groups.map((g) => (
              <tr key={g.key} className="border-t">
                <td className="px-3 py-2 font-medium">{g.key}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.orders}</td>
                {SLA_SEGMENTS.map((seg) => {
                  const st = g.perStage[seg];
                  return (
                    <td key={seg} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {st.n === 0 ? <span className="text-muted-foreground">—</span> : (
                        <>
                          <div>{fmtDuration(st.avgHrs)} <span className="text-muted-foreground">· {fmtDuration(st.medianHrs)}</span></div>
                          <div className={`text-xs ${tone(st.overdueRate)}`}>{Math.round(st.overdueRate * 100)}% trễ ({st.n})</div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Mỗi ô: trung bình · trung vị (số đơn có dữ liệu) + % đơn vượt SLA. 🟢 &lt;10% · 🟡 10–30% · 🔴 ≥30%.</p>
    </div>
  );
}
```

- [ ] **Step 3: Re-export types cho client (`seg-labels.ts`)**

Client import từ module thuần OK (không I/O), nhưng để nhãn công đoạn gọn + tránh kéo `stats-logic` runtime vào client bundle không cần thiết, tạo file nhãn nhẹ:

```tsx
// app/(dashboard)/f/lifecycle/stats/seg-labels.ts
export { SLA_SEGMENTS } from '@/features/lifecycle/stats-logic';
export type { SlaKey, GroupBy, StatGroup } from '@/features/lifecycle/stats-logic';
import type { SlaKey } from '@/features/lifecycle/stats-logic';

export const STAGE_LABELS_SEG: Record<SlaKey, string> = {
  placed_to_production: 'Đặt→Sản xuất',
  production: 'Sản xuất',
  qc: 'QC',
  pack: 'Đóng gói',
  ship: 'Bàn giao',
  deliver: 'Giao hàng',
};
```

- [ ] **Step 4: Thêm link "Thống kê" ở dashboard**

Trong `app/(dashboard)/f/lifecycle/page.tsx`, đổi cụm nút góc phải thành 2 link:

```tsx
        <div className="flex gap-2">
          <Link href="/f/lifecycle/stats" className={buttonVariants({ variant: 'outline' })}>Thống kê</Link>
          <Link href="/f/lifecycle/sla" className={buttonVariants({ variant: 'outline' })}>Cấu hình SLA</Link>
        </div>
```

(thay cho `<Link href="/f/lifecycle/sla" ...>Cấu hình SLA</Link>` đơn lẻ.)

- [ ] **Step 5: Typecheck + lint + build-check trang**

Run: `npx tsc --noEmit` → 0 lỗi.
Run: `npx eslint app/\(dashboard\)/f/lifecycle/stats features/lifecycle/stats-queries.ts features/lifecycle/stats-logic.ts` → 0 lỗi.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/f/lifecycle/stats" "app/(dashboard)/f/lifecycle/page.tsx"
git commit -m "feat(lifecycle): trang thống kê /f/lifecycle/stats (avg/median/overdue + breakdown) + nav"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** avg+median+overdueRate (Task1) ✓ · brand/carrier/store/month breakdown+filter (Task1 groupBy + Task2 filter + Task3 UI) ✓ · store=workspace (store filter) ✓ · explode multi-brand (Task1 test) ✓ · read-only, no migration ✓.
- **Placeholder scan:** không có TODO/TBD; mọi step có code thật.
- **Type consistency:** `SlaKey`, `SLA_SEGMENTS`, `DurationRow`, `StatGroup`, `GroupBy` khai báo ở Task1, dùng nguyên vẹn ở Task2/3. `computeDurations` nhận đúng 7 mốc khớp cột `orderLifecycle`. `fmtDuration` nhận `number|null` (đã có).
- **Rủi ro nhỏ:** `gte/lte` trên `monthExpr` (sql) — nếu drizzle báo type, Task2 note đã hướng dẫn; đây là so sánh chuỗi 'YYYY-MM' hợp lệ ở Postgres.
