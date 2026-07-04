# Vòng đời đơn — Redesign + fix ngữ nghĩa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List + chi tiết vòng đời dễ đọc (đang ở stage nào / chờ gì), nhóm đơn cũ "ship chưa giao" thành `stale` thay vì "trễ 100d", timeline sắp theo thời gian thật + đánh dấu mốc ước lượng.

**Architecture:** Thêm phân loại `stale` vào logic thuần `derive.ts` (persist `delay_status`); helper stage + timeline sanitize vào `display.ts`; stats loại `stale` khỏi đoạn `deliver`; 2 trang UI vẽ lại. KHÔNG migration (`delay_status` là text tự do). Repopulate bằng cron sync-lifecycle.

**Tech Stack:** Next.js App Router, Drizzle ORM, Vitest, React 19, Tailwind.

## Global Constraints

- KHÔNG migration, KHÔNG đổi schema, KHÔNG ghi bảng mới. `delay_status` nhận thêm giá trị `'stale'` (text, không enum DB).
- KHÔNG đụng `sync.ts` (cách gom tín hiệu nguồn) — chỉ phân loại + hiển thị.
- `STALE_THRESHOLD_MS = 30 * 24 * 3600_000` (30 ngày).
- `stale` chỉ áp khi: `currentStage ∈ {shipped, in_transit, out_for_delivery}` ∧ `deliveredAt == null` ∧ `shippedAt != null` ∧ `now − shippedAt > STALE_THRESHOLD_MS`. Khi đó `delayHours = ceil((now − shippedAt)/H)` (số giờ kể từ khi gửi, dùng để hiển thị "gửi Nd trước").
- Timeline sắp **tăng dần theo thời gian thật**; mốc `approx` gắn nhãn `≈`; duration chỉ tính khi 2 mốc liền kề đều không approx.
- RBAC 2 trang giữ nguyên `view_fulfillment`.
- Tiếng Việt, sentence case, không emoji trong code icon (dùng lucide-react như phần còn lại của app — kiểm cách import icon hiện có trước khi thêm).
- Import `hoursBetween`/`fmtDuration` từ `display.ts` — không viết lại.

---

### Task 1: `derive.ts` — phân loại `stale` + test

**Files:**
- Modify: `features/lifecycle/derive.ts`
- Test: `features/lifecycle/derive.test.ts` (thêm case)

**Interfaces:**
- Consumes: types hiện có (`LifecycleSignals`, `LifecyclePrev`, `DEFAULT_SLA`).
- Produces: `DelayStatus` mở rộng `'stale'`; hành vi mới của `deriveLifecycle` (persist `delayStatus='stale'`).

- [ ] **Step 1: Thêm test (FAIL trước)**

Thêm vào `features/lifecycle/derive.test.ts`:

```ts
describe('stale — đơn cũ ship chưa có tín hiệu giao', () => {
  it('shipped > 30 ngày, chưa delivered → stale, delayHours = giờ kể từ shipped', () => {
    const r = run(sig({ labelMinAt: d(24 * 40), hasTracking: true })); // gửi 40 ngày trước
    expect(r.currentStage).toBe('shipped');
    expect(r.delayStatus).toBe('stale');
    expect(r.delayHours).toBe(24 * 40);
  });
  it('shipped 5 ngày → KHÔNG stale (overdue theo deliver SLA vẫn tính bình thường)', () => {
    const r = run(sig({ labelMinAt: d(24 * 5), hasTracking: true }));
    expect(r.currentStage).toBe('shipped');
    expect(r.delayStatus).not.toBe('stale');
  });
  it('out_for_delivery > 30 ngày chưa delivered → stale', () => {
    const r = run(sig({ labelMinAt: d(24 * 40), hasTracking: true, anyOutForDelivery: true }));
    expect(r.currentStage).toBe('out_for_delivery');
    expect(r.delayStatus).toBe('stale');
  });
  it('đã delivered → KHÔNG stale', () => {
    const r = run(sig({ labelMinAt: d(24 * 40), packs: 1, packsDelivered: 1, shipDeliveredMaxAt: d(24 * 35) }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.delayStatus).not.toBe('stale');
  });
});
```

- [ ] **Step 2: Chạy — FAIL**

Run: `npx vitest run features/lifecycle/derive.test.ts`
Expected: 3 fail (delayStatus 'overdue' thay vì 'stale').

- [ ] **Step 3: Implement**

Trong `features/lifecycle/derive.ts`:

1. Đổi type:
```ts
export type DelayStatus = 'on_track' | 'due_soon' | 'overdue' | 'stale';
```

2. Thêm hằng cạnh `COMPLETED_WINDOW_MS`:
```ts
const STALE_THRESHOLD_MS = 30 * 24 * H;
```

3. Sau block `--- Delay ---` (ngay trước `return {`), chèn:
```ts
  // --- Stale: đơn cũ đã ship nhưng chưa có tín hiệu giao (spec redesign §4.1) ---
  const shippedStages: StageKey[] = ['shipped', 'in_transit', 'out_for_delivery'];
  if (
    shippedStages.includes(currentStage) && !deliveredAt && shippedAt &&
    now.getTime() - shippedAt.getTime() > STALE_THRESHOLD_MS
  ) {
    delayStatus = 'stale';
    delayHours = Math.ceil((now.getTime() - shippedAt.getTime()) / H);
  }
```

- [ ] **Step 4: Chạy — PASS**

Run: `npx vitest run features/lifecycle/derive.test.ts`
Expected: tất cả PASS (cũ + 4 mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → 0.
```bash
git add features/lifecycle/derive.ts features/lifecycle/derive.test.ts
git commit -m "feat(lifecycle): phân loại delayStatus 'stale' cho đơn ship chưa có tín hiệu giao"
```

---

### Task 2: `display.ts` — helper stage + timeline sanitize + test

**Files:**
- Modify: `features/lifecycle/display.ts`
- Test: `features/lifecycle/display.test.ts`

**Interfaces:**
- Consumes: `StageKey` (`./derive`), `Milestones`, `hoursBetween`, `fmtDuration`.
- Produces: `MAIN_CHAIN`, `nextStage`, `stageProgress`, `statusLabel`; `Tone` thêm `'stale'`; `delayTone` xử lý `'stale'`; `buildTimeline(m, syncedAt)` trả `TimelineStep` có `approx`/`approxReason`.

- [ ] **Step 1: Thêm/sửa test (FAIL trước)**

Trong `features/lifecycle/display.test.ts`, cập nhật import + thêm:

```ts
import {
  delayTone, fmtDuration, hoursBetween, stageAnchorAt, buildTimeline, STAGE_LABELS,
  nextStage, stageProgress, statusLabel,
} from './display';

describe('nextStage', () => {
  it('trả stage kế tiếp trong chuỗi chính', () => {
    expect(nextStage('shipped')).toBe('in_transit');
    expect(nextStage('placed')).toBe('production');
  });
  it('completed/terminal → null', () => {
    expect(nextStage('completed')).toBeNull();
    expect(nextStage('cancelled')).toBeNull();
  });
});

describe('stageProgress', () => {
  it('index theo chuỗi chính', () => {
    expect(stageProgress('placed').index).toBe(0);
    expect(stageProgress('shipped').index).toBe(4);
    expect(stageProgress('placed').total).toBe(9);
  });
});

describe('delayTone + statusLabel — stale', () => {
  it('stale → tone stale', () => { expect(delayTone('stale')).toBe('stale'); });
  it('statusLabel stale/overdue/due_soon/on_track', () => {
    expect(statusLabel('stale', 960).text).toBe('Nghi mất tín hiệu');
    expect(statusLabel('stale', 960).tone).toBe('stale');
    expect(statusLabel('overdue', 50).text).toBe('Trễ 2d 2h');
    expect(statusLabel('due_soon', 0).text).toBe('Sắp hạn');
    expect(statusLabel('on_track', 0).text).toBe('Đúng hạn');
  });
});

describe('buildTimeline — sắp theo thời gian thật + approx', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const H = 3600_000;
  const at = (h: number) => new Date(base + h * H);
  it('sắp tăng dần theo thời gian, đánh dấu out-of-order + first-seen, ẩn duration bất thường', () => {
    // shipped (spine) sớm; packed/production muộn hơn shipped → out_of_order; qc ≈ syncedAt
    const synced = at(1000);
    const steps = buildTimeline({
      placedAt: at(0), productionStartAt: at(700), goodsReceivedAt: null,
      qcPassAt: at(999), packedAt: at(400), shippedAt: at(100),
      inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
    }, synced);
    // thứ tự thời gian: placed(0) < shipped(100) < packed(400) < production(700) < qc(999)
    expect(steps.map((s) => s.key)).toEqual([
      'placedAt', 'shippedAt', 'packedAt', 'productionStartAt', 'qcPassAt',
    ]);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.shippedAt.approx).toBe(false);
    expect(byKey.packedAt.approx).toBe(true);
    expect(byKey.packedAt.approxReason).toBe('out_of_order');
    expect(byKey.qcPassAt.approx).toBe(true);
    expect(byKey.qcPassAt.approxReason).toBe('first_seen');
    // duration chỉ tính giữa 2 mốc không-approx liền kề
    expect(byKey.packedAt.durationHrs).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy — FAIL** (`nextStage` chưa tồn tại; buildTimeline signature cũ)

Run: `npx vitest run features/lifecycle/display.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Trong `features/lifecycle/display.ts`:

1. Đổi `Tone` + `delayTone`:
```ts
export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'stale';
export function delayTone(delayStatus: string): Tone {
  return delayStatus === 'stale' ? 'stale'
    : delayStatus === 'overdue' ? 'bad'
    : delayStatus === 'due_soon' ? 'warn' : 'ok';
}
```

2. Thêm sau `STAGE_ORDER`:
```ts
/** Chuỗi chính (bỏ terminal refunded/cancelled) để đo tiến độ + stage kế tiếp. */
export const MAIN_CHAIN: StageKey[] = [
  'placed', 'production', 'qc', 'packed', 'shipped',
  'in_transit', 'out_for_delivery', 'post_delivery', 'completed',
];

export function nextStage(stage: StageKey): StageKey | null {
  const i = MAIN_CHAIN.indexOf(stage);
  if (i < 0 || i >= MAIN_CHAIN.length - 1) return null;
  return MAIN_CHAIN[i + 1];
}

export function stageProgress(stage: StageKey): { index: number; total: number } {
  const total = MAIN_CHAIN.length;
  const i = MAIN_CHAIN.indexOf(stage);
  return { index: i < 0 ? total : i, total };
}

export function statusLabel(
  delayStatus: string, delayHours: number,
): { text: string; tone: Tone } {
  switch (delayStatus) {
    case 'stale': return { text: 'Nghi mất tín hiệu', tone: 'stale' };
    case 'overdue': return { text: `Trễ ${fmtDuration(delayHours)}`, tone: 'bad' };
    case 'due_soon': return { text: 'Sắp hạn', tone: 'warn' };
    default: return { text: 'Đúng hạn', tone: 'ok' };
  }
}
```

3. Thay `TimelineStep` + `buildTimeline` (giữ `TIMELINE_ORDER`, `Milestones`, `asMs`):
```ts
export interface TimelineStep {
  key: string;
  label: string;
  at: Date | string | null;
  durationHrs: number | null;
  approx: boolean;
  approxReason: 'first_seen' | 'out_of_order' | null;
}

/** Mốc nguồn đáng tin (spine) để phát hiện lệch thứ tự. */
const SPINE_KEYS = new Set<keyof Milestones>(['placedAt', 'shippedAt', 'deliveredAt', 'completedAt']);

/** Timeline: các mốc đã đạt, sắp tăng dần theo thời gian thật; đánh dấu approx; duration an toàn. */
export function buildTimeline(m: Milestones, syncedAt: Date | string | null): TimelineStep[] {
  const canonical = new Map(TIMELINE_ORDER.map((s, i) => [s.key, i] as const));
  const reached = TIMELINE_ORDER
    .filter((s) => m[s.key] != null)
    .map((s) => ({ key: s.key, label: s.label, ms: asMs(m[s.key])! }));
  const spine = reached.filter((r) => SPINE_KEYS.has(r.key as keyof Milestones));
  const syncMs = asMs(syncedAt);

  const sorted = [...reached].sort((a, b) => a.ms - b.ms);

  const built = sorted.map((r) => {
    const cIdx = canonical.get(r.key) ?? 0;
    const firstSeen = syncMs != null && Math.abs(r.ms - syncMs) <= 24 * 3600_000
      && !SPINE_KEYS.has(r.key as keyof Milestones);
    const outOfOrder = spine.some((s) => {
      const sIdx = canonical.get(s.key) ?? 0;
      return (sIdx > cIdx && s.ms < r.ms) || (sIdx < cIdx && s.ms > r.ms);
    }) && !SPINE_KEYS.has(r.key as keyof Milestones);
    const approxReason: TimelineStep['approxReason'] = firstSeen ? 'first_seen' : outOfOrder ? 'out_of_order' : null;
    return {
      key: r.key as string,
      label: TIMELINE_ORDER.find((t) => t.key === r.key)!.label,
      at: m[r.key as keyof Milestones],
      ms: r.ms,
      approx: approxReason != null,
      approxReason,
      durationHrs: null as number | null,
    };
  });

  for (let i = 1; i < built.length; i++) {
    if (!built[i].approx && !built[i - 1].approx) {
      built[i].durationHrs = Math.max(0, (built[i].ms - built[i - 1].ms) / 3600_000);
    }
  }
  return built.map(({ ms: _ms, ...step }) => step);
}
```

> Lưu ý: `asMs` đang là hàm private trong file — dùng lại, không export. `Milestones` không có `refundedAt/cancelledAt` nên spine chỉ gồm mốc thuộc `Milestones`.

- [ ] **Step 4: Chạy — PASS**

Run: `npx vitest run features/lifecycle/display.test.ts`
Expected: PASS (cũ + mới). Nếu test buildTimeline cũ (1 tham số) còn tồn tại → cập nhật nó truyền thêm `null` cho `syncedAt`.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → 0. (Sẽ báo lỗi ở 2 call-site `buildTimeline`/`LifecycleTable` — Task 4/5 sửa. Nếu tsc đỏ chỉ vì call-site đó, ghi chú và tiếp tục; commit Task 2 vẫn hợp lệ vì file logic đã đúng.)

Thực tế để tsc xanh ngay, sửa call-site tối thiểu ở detail page trong CÙNG commit này: `buildTimeline(lc)` → `buildTimeline(lc, lc.syncedAt)`.

```bash
git add features/lifecycle/display.ts features/lifecycle/display.test.ts "app/(dashboard)/f/lifecycle/[orderId]/page.tsx"
git commit -m "feat(lifecycle): helper nextStage/stageProgress/statusLabel + buildTimeline sanitize (sắp theo thời gian + approx)"
```

- [ ] **Step 6: tsc xanh**

Run: `npx tsc --noEmit`
Expected: 0 (call-site detail đã truyền `syncedAt`).

---

### Task 3: Stats — loại `stale` khỏi đoạn `deliver`

**Files:**
- Modify: `features/lifecycle/stats-logic.ts`
- Modify: `features/lifecycle/stats-queries.ts`
- Test: `features/lifecycle/stats-logic.test.ts`

**Interfaces:**
- `DurationRow` thêm `stale: boolean`.
- `aggregateLifecycle` bỏ qua đoạn `deliver` cho row `stale`.
- `lifecycleDurations` select `delayStatus` → `stale`.

- [ ] **Step 1: Thêm test (FAIL trước)**

Trong `features/lifecycle/stats-logic.test.ts`, thêm `stale: false` vào helper `row` mặc định và thêm case:

```ts
  it('row stale không tính vào đoạn deliver, vẫn tính đoạn khác', () => {
    const rows = [
      row({ stale: true, dur: { ...z(), deliver: 5000, ship: 10 } }),
      row({ stale: false, dur: { ...z(), deliver: 100 } }),
    ];
    const [g] = aggregateLifecycle(rows, SLA, 'none');
    expect(g.perStage.deliver.n).toBe(1);          // chỉ row không-stale
    expect(g.perStage.deliver.avgHrs).toBe(100);
    expect(g.perStage.ship.n).toBe(1);             // stale vẫn đóng góp đoạn ship
  });
```

Cập nhật helper `row` (thêm field): `stale: false,` trong object mặc định + kiểu `Partial<DurationRow>`.

- [ ] **Step 2: Chạy — FAIL**

Run: `npx vitest run features/lifecycle/stats-logic.test.ts`
Expected: FAIL (`deliver.n` = 2).

- [ ] **Step 3: Implement**

`stats-logic.ts`:
1. `DurationRow` thêm field:
```ts
export interface DurationRow {
  orderId: string;
  storeId: string;
  storeName: string | null;
  placedMonth: string | null;
  brands: string[];
  carriers: string[];
  stale: boolean;
  dur: Record<SlaKey, number | null>;
}
```
2. Trong vòng lặp gom của `aggregateLifecycle`, bỏ qua `deliver` khi `r.stale`:
```ts
      for (const seg of SLA_SEGMENTS) {
        if (seg === 'deliver' && r.stale) continue;
        const v = r.dur[seg];
        if (v != null) g.segs[seg].push(v);
      }
```

`stats-queries.ts`:
3. Select thêm `delayStatus` trong `base`:
```ts
    delayStatus: schema.orderLifecycle.delayStatus,
```
4. Khi map `rows`, thêm `stale: b.delayStatus === 'stale',`.

- [ ] **Step 4: Chạy — PASS + tsc**

Run: `npx vitest run features/lifecycle/stats-logic.test.ts` → PASS.
Run: `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add features/lifecycle/stats-logic.ts features/lifecycle/stats-queries.ts features/lifecycle/stats-logic.test.ts
git commit -m "feat(lifecycle): stats loại đơn stale khỏi tỉ lệ overdue đoạn deliver"
```

---

### Task 4: List UI `/f/lifecycle` — thanh công đoạn + current→next + chip mới

**Files:**
- Modify: `app/(dashboard)/f/lifecycle/LifecycleTable.tsx`

**Interfaces:**
- Consumes: `LifecycleListRow` (đã có `currentStage`, `delayStatus`, `delayHours`, `timeInStageHrs`, `exception`, `orderNumber`, `storeName`); `STAGE_LABELS`, `STAGE_ORDER`, `nextStage`, `stageProgress`, `statusLabel`, `fmtDuration`, `type Tone` (`display.ts`).

- [ ] **Step 1: Viết lại `LifecycleTable.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import {
  STAGE_LABELS, STAGE_ORDER, MAIN_CHAIN, nextStage, stageProgress,
  statusLabel, fmtDuration, type Tone,
} from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';
import type { LifecycleListRow } from '@/features/lifecycle/queries';
import { Card, CardContent } from '@/components/ui/card';

const CHIP: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  stale: 'bg-muted text-muted-foreground border border-border',
  muted: 'bg-muted text-muted-foreground',
};

function StageBar({ stage }: { stage: StageKey }) {
  const { index, total } = stageProgress(stage);
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-[5px] flex-1 rounded-full ${i <= index ? 'bg-foreground' : 'bg-border'}`} />
      ))}
    </div>
  );
}

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
        {([['overdue', 'Quá hạn'], ['due_soon', 'Sắp hạn'], ['stale', 'Nghi mất tín hiệu']] as const).map(([d, label]) => (
          <button key={d} onClick={() => setParam('delay', d)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeDelay === d ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <Card><CardContent className="p-0 divide-y">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Không có đơn khớp bộ lọc.</div>
        ) : rows.map((r) => {
          const stage = r.currentStage as StageKey;
          const nx = nextStage(stage);
          const st = statusLabel(r.delayStatus, r.delayHours);
          const when = r.delayStatus === 'stale'
            ? `gửi ${fmtDuration(r.delayHours)} trước, chưa có tín hiệu`
            : `đã ở ${fmtDuration(r.timeInStageHrs)}`;
          return (
            <div key={r.orderId} className="grid grid-cols-[150px_1fr_auto] items-center gap-4 p-3 hover:bg-muted/40">
              <div className="min-w-0">
                <Link href={`/f/lifecycle/${r.orderId}`} className="font-medium underline-offset-2 hover:underline inline-flex items-center gap-1">
                  {r.orderNumber ?? r.orderId.slice(0, 8)}
                  {r.exception && <TriangleAlert className="h-3.5 w-3.5 text-amber-500" aria-label="sự cố" />}
                </Link>
                <div className="text-xs text-muted-foreground truncate">{r.storeName ?? '—'}</div>
              </div>
              <div className="min-w-0">
                {MAIN_CHAIN.includes(stage) ? <StageBar stage={stage} /> : <div className="text-xs text-muted-foreground">{STAGE_LABELS[stage]}</div>}
                <div className="text-xs text-muted-foreground mt-1.5 truncate">
                  <span className="text-foreground font-medium">{STAGE_LABELS[stage]}</span>
                  {nx && <> → chờ {STAGE_LABELS[nx]}</>} · {when}
                </div>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${CHIP[st.tone]}`}>{st.text}</span>
            </div>
          );
        })}
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle/LifecycleTable.tsx"` → 0.
```bash
git add "app/(dashboard)/f/lifecycle/LifecycleTable.tsx"
git commit -m "feat(lifecycle): list vẽ lại — thanh công đoạn + hiện tại→kế tiếp + chip stale"
```

---

### Task 5: Detail UI `/f/lifecycle/[orderId]` — stepper + banner + timeline mới

**Files:**
- Modify: `app/(dashboard)/f/lifecycle/[orderId]/page.tsx`

**Interfaces:**
- Consumes: `getLifecycle` (full row + `syncedAt`, `shippedAt`, `deliveredAt`, `deadline`, `delayStatus`, `delayHours`); `buildTimeline(m, syncedAt)`, `nextStage`, `stageProgress`, `statusLabel`, `MAIN_CHAIN`, `STAGE_LABELS`, `fmtDuration`.

- [ ] **Step 1: Viết lại `[orderId]/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getLifecycle } from '@/features/lifecycle/queries';
import {
  buildTimeline, fmtDuration, STAGE_LABELS, MAIN_CHAIN, nextStage, stageProgress, statusLabel,
} from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleString('vi-VN') : '—';
const fmtDay = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const APPROX_NOTE: Record<'first_seen' | 'out_of_order', string> = {
  first_seen: 'mới ghi nhận',
  out_of_order: 'lệch thứ tự — dữ liệu nguồn không nhất quán',
};

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

  const stage = lc.currentStage as StageKey;
  const nx = nextStage(stage);
  const st = statusLabel(lc.delayStatus, lc.delayHours);
  const { index } = stageProgress(stage);
  const steps = buildTimeline(lc, lc.syncedAt);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{lc.orderNumber ?? orderId.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            {lc.storeName ?? '—'} · hiện tại <span className="text-foreground font-medium">{STAGE_LABELS[stage]}</span>
            {nx && <> → chờ <span className="text-foreground font-medium">{STAGE_LABELS[nx]}</span></>}
            {lc.exception && ' · ⚠ sự cố'}
          </p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>

      {MAIN_CHAIN.includes(stage) && (
        <Card><CardContent className="p-4">
          <div className="flex items-start">
            {MAIN_CHAIN.map((s, i) => (
              <div key={s} className="flex-1 flex flex-col items-center text-center">
                <div className="flex items-center w-full">
                  <span className={`h-[2px] flex-1 ${i === 0 ? 'opacity-0' : i <= index ? 'bg-foreground' : 'bg-border'}`} />
                  <span className={`mx-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${i < index ? 'bg-foreground border-foreground' : i === index ? 'border-foreground' : 'border-border bg-transparent'}`} />
                  <span className={`h-[2px] flex-1 ${i === MAIN_CHAIN.length - 1 ? 'opacity-0' : i < index ? 'bg-foreground' : 'bg-border'}`} />
                </div>
                <span className={`mt-1.5 text-[11px] ${i === index ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{STAGE_LABELS[s]}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4 text-sm">
        {lc.delayStatus === 'stale' ? (
          <p><span className="font-medium">Nghi mất tín hiệu giao.</span>{' '}
            <span className="text-muted-foreground">Đã bàn giao carrier {fmtDay(lc.shippedAt)}, tới nay {fmtDuration(lc.delayHours)} chưa nhận cập nhật “đã giao”. Nhiều khả năng đã giao xong nhưng tracking không cập nhật — cần kiểm tra carrier, không tính là trễ SLA.</span></p>
        ) : lc.deadline ? (
          <p>Deadline công đoạn hiện tại: <b>{fmt(lc.deadline)}</b>
            {lc.delayStatus === 'overdue' && <span className="text-red-600"> · {st.text}</span>}
            {lc.delayStatus === 'due_soon' && <span className="text-amber-600"> · sắp hạn</span>}
          </p>
        ) : <p className="text-muted-foreground">Không có deadline cho công đoạn hiện tại.</p>}
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Timeline · theo thời gian thật</div>
        <ol className="relative border-l ml-2 space-y-6">
          {steps.map((s) => (
            <li key={s.key} className="ml-4">
              <span className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full ${s.approx ? 'bg-background border-2 border-border' : 'bg-foreground'}`} />
              <div className="flex items-baseline justify-between gap-3">
                <span className={s.approx ? 'text-muted-foreground' : 'font-medium'}>{s.label}
                  {s.approxReason && <span className="ml-2 text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">≈ {APPROX_NOTE[s.approxReason]}</span>}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{s.approx ? `≈ ${fmtDay(s.at)}` : fmt(s.at)}</span>
              </div>
              {s.durationHrs != null && <div className="text-xs text-muted-foreground">+{fmtDuration(s.durationHrs)} từ mốc trước</div>}
            </li>
          ))}
          {steps.length === 0 && <li className="ml-4 text-sm text-muted-foreground">Chưa có mốc nào.</li>}
        </ol>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle/[orderId]/page.tsx"` → 0.
```bash
git add "app/(dashboard)/f/lifecycle/[orderId]/page.tsx"
git commit -m "feat(lifecycle): chi tiết vẽ lại — stepper + banner stale + timeline theo thời gian thật"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** stale classification (T1) ✓ · nextStage/stageProgress/statusLabel + timeline sanitize (T2) ✓ · stats loại stale (T3) ✓ · list redesign (T4) ✓ · detail redesign (T5) ✓ · không migration ✓.
- **Placeholder scan:** không TODO/TBD; mọi step có code thật.
- **Type consistency:** `DelayStatus`+`'stale'` (T1) dùng ở `statusLabel`/`delayTone` (T2), `stale` field trên `DurationRow` (T3) khớp query map; `buildTimeline(m, syncedAt)` đổi ở T2 và mọi call-site (detail T2 step5 + T5) truyền `syncedAt`; `StageKey` import từ `./derive` ở UI. `MAIN_CHAIN.length = 9` khớp test `stageProgress`.
- **Rủi ro:** `buildTimeline` đổi chữ ký → call-site cũ trong `[orderId]/page.tsx` sửa ngay ở T2 step 5 để tsc xanh trước khi T5 vẽ lại; `LifecycleTable` cũ dùng `delayTone`/`TONE` — T4 thay trọn file.
- **lucide-react:** app đã dùng (dependency trong package.json) — `AlertTriangle` chuẩn; nếu tên icon khác trong repo, implementer kiểm import hiện có.
