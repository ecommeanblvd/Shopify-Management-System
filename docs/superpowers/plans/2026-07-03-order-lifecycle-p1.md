# Order Lifecycle — Phase 1 (nền tảng dữ liệu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảng `lifecycle_sla` + `order_lifecycle` (snapshot vòng đời 1 dòng/đơn), logic thuần `deriveLifecycle` (stage machine + deadline + delay + first-seen stamps), cron `sync-lifecycle` đối chiếu tín hiệu nguồn + backfill.

**Architecture:** Kiến trúc A (spec §2): snapshot table + cron. Orchestrator batch-load tín hiệu từ 7 bảng nguồn (pattern `worklist-status-queries.ts`) → flatten thành `LifecycleSignals` → logic thuần derive → upsert. Không UI (P2), không thống kê (P3).

**Tech Stack:** Drizzle ORM (Postgres), Vitest, Railway cron (`dotenv -- tsx`), hand-authored migration.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-order-lifecycle-tracking-design.md` (§3 stage machine, §4 SLA, §5 data model).
- Migration **hand-authored** (không drizzle-kit generate). Migration kế tiếp = **0086**, journal idx **86**.
- Stage keys (text): `placed | production | qc | packed | shipped | in_transit | out_for_delivery | post_delivery | completed | refunded_full | cancelled`. Cờ `exception` là boolean riêng, KHÔNG phải stage.
- SLA keys (6): `placed_to_production | production | qc | pack | ship | deliver` — seed 24/240/48/48/24/168 giờ.
- First-seen stamps (`qcPassAt, inTransitAt, outForDeliveryAt, returnProcessingAt`, fallback của `shippedAt`/`deliveredAt`): cron chỉ SET khi prev đang null — KHÔNG ghi đè.
- Cửa sổ completed = deliveredAt + **30 ngày** (không phải SLA, không alert).
- KHÔNG đổi bảng nguồn nào; KHÔNG đụng `order_fulfillment.status` rollup cũ; KHÔNG thêm dependency.
- Áp mọi store; cron KHÔNG áp DB migration (deferred cho user như quy trình hiện tại — chỉ tsc/vitest/eslint khi build).
- Chạy trước push: `npx tsc --noEmit` + `npx vitest run` xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `db/schema.ts` (modify) | + `lifecycleSla` + `orderLifecycle` |
| `db/migrations/0086_order-lifecycle.sql` + journal | CREATE 2 bảng + seed 6 SLA |
| `features/lifecycle/derive.ts` (+test) | Types + `deriveLifecycle` thuần (stage/deadline/delay/stamps) |
| `features/lifecycle/sync.ts` | `loadSlaMap` + `syncOrderLifecycle` (batch signals → derive → upsert) |
| `scripts/cron/sync-lifecycle.ts` · `railway.cron-lifecycle.json` · `package.json` | Cron registration |

---

### Task 1: Schema + migration 0086 (2 bảng + seed SLA)

**Files:**
- Modify: `db/schema.ts` (append cuối file)
- Create: `db/migrations/0086_order-lifecycle.sql`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `schema.lifecycleSla`, `schema.orderLifecycle` (Drizzle tables).

- [ ] **Step 1: Append vào `db/schema.ts`**

```ts
// ---- Order Lifecycle (vòng đời đơn + SLA) ----------------------------------
/** SLA mặc định toàn hệ thống cho từng đoạn vòng đời (admin sửa trong UI P2).
 *  key: placed_to_production | production | qc | pack | ship | deliver. */
export const lifecycleSla = pgTable('lifecycle_sla', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  targetHours: integer('target_hours').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Snapshot vòng đời 1 dòng/đơn — cron sync-lifecycle đối chiếu tín hiệu nguồn
 *  và upsert. Các mốc first-seen (qc_pass/in_transit/out_for_delivery/
 *  return_processing) chỉ set khi đang null. */
export const orderLifecycle = pgTable('order_lifecycle', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  currentStage: text('current_stage').notNull().default('placed'),
  exception: boolean('exception').notNull().default(false),
  exceptionNote: text('exception_note'),
  // Mốc vòng đời (spec §3)
  placedAt: timestamp('placed_at'),
  productionStartAt: timestamp('production_start_at'),
  productionConfirmedAt: timestamp('production_confirmed_at'),
  productionEta: date('production_eta'),
  goodsReceivedAt: timestamp('goods_received_at'),
  qcPassAt: timestamp('qc_pass_at'),
  packedAt: timestamp('packed_at'),
  shippedAt: timestamp('shipped_at'),
  inTransitAt: timestamp('in_transit_at'),
  outForDeliveryAt: timestamp('out_for_delivery_at'),
  deliveredAt: timestamp('delivered_at'),
  returnProcessingAt: timestamp('return_processing_at'),
  refundedAt: timestamp('refunded_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  // Delay (spec §4)
  deadline: timestamp('deadline'),
  delayStatus: text('delay_status').notNull().default('on_track'), // on_track|due_soon|overdue
  delayHours: integer('delay_hours').notNull().default(0),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (t) => [
  index('order_lifecycle_stage_idx').on(t.currentStage),
  index('order_lifecycle_delay_idx').on(t.delayStatus),
  index('order_lifecycle_store_idx').on(t.storeId),
]);
```

- [ ] **Step 2: Migration** `db/migrations/0086_order-lifecycle.sql`

```sql
CREATE TABLE "lifecycle_sla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"target_hours" integer NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_sla_key_unique" UNIQUE("key")
);

CREATE TABLE "order_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"current_stage" text DEFAULT 'placed' NOT NULL,
	"exception" boolean DEFAULT false NOT NULL,
	"exception_note" text,
	"placed_at" timestamp,
	"production_start_at" timestamp,
	"production_confirmed_at" timestamp,
	"production_eta" date,
	"goods_received_at" timestamp,
	"qc_pass_at" timestamp,
	"packed_at" timestamp,
	"shipped_at" timestamp,
	"in_transit_at" timestamp,
	"out_for_delivery_at" timestamp,
	"delivered_at" timestamp,
	"return_processing_at" timestamp,
	"refunded_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"deadline" timestamp,
	"delay_status" text DEFAULT 'on_track' NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_lifecycle_order_id_unique" UNIQUE("order_id")
);

ALTER TABLE "order_lifecycle" ADD CONSTRAINT "order_lifecycle_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_lifecycle" ADD CONSTRAINT "order_lifecycle_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "order_lifecycle_stage_idx" ON "order_lifecycle" ("current_stage");
CREATE INDEX "order_lifecycle_delay_idx" ON "order_lifecycle" ("delay_status");
CREATE INDEX "order_lifecycle_store_idx" ON "order_lifecycle" ("store_id");

INSERT INTO "lifecycle_sla" ("key", "target_hours", "note") VALUES
	('placed_to_production', 24, 'Đặt hàng → push brand'),
	('production', 240, 'Push brand → hàng về kho (ưu tiên ETA brand nếu có)'),
	('qc', 48, 'Hàng về kho → QC pass'),
	('pack', 48, 'QC pass (hoặc placed nếu đủ kho) → packed'),
	('ship', 24, 'Packed → bàn giao carrier'),
	('deliver', 168, 'Shipped → delivered')
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 3: Journal entry** — append vào `entries` sau idx 85 (giữ JSON hợp lệ):

```json
    ,{
      "idx": 86,
      "version": "7",
      "when": 1783860000000,
      "tag": "0086_order-lifecycle",
      "breakpoints": true
    }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `node -e "JSON.parse(require('fs').readFileSync('db/migrations/meta/_journal.json','utf8'))"` → im lặng (JSON hợp lệ).
KHÔNG chạy migrate (deferred cho user).

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0086_order-lifecycle.sql db/migrations/meta/_journal.json
git commit -m "feat(lifecycle): schema lifecycle_sla + order_lifecycle + migration 0086 (seed 6 SLA)"
```

---

### Task 2: `deriveLifecycle` (thuần — trọng tâm P1)

**Files:**
- Create: `features/lifecycle/derive.ts`
- Test: `features/lifecycle/derive.test.ts`

**Interfaces:**
- Produces (dùng ở Task 3):
  - `type StageKey`, `type SlaKey`, `type DelayStatus`
  - `interface LifecycleSignals` (input flatten từ orchestrator)
  - `interface LifecyclePrev` (stamps đã có — null nếu đơn mới)
  - `interface LifecycleSnapshot` (giá trị ghi vào order_lifecycle)
  - `deriveLifecycle(sig: LifecycleSignals, prev: LifecyclePrev | null, sla: Record<SlaKey, number>, now: Date): LifecycleSnapshot`
  - `const DEFAULT_SLA: Record<SlaKey, number>` (24/240/48/48/24/168)

- [ ] **Step 1: Write the failing test** `features/lifecycle/derive.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { deriveLifecycle, DEFAULT_SLA, type LifecycleSignals } from './derive';

const NOW = new Date('2026-07-03T10:00:00Z');
const H = 3600_000;
const d = (h: number) => new Date(NOW.getTime() - h * H);

/** Signals mặc định: đơn mới đặt, chưa có gì. */
function sig(over: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    placedAt: d(1), cancelledAt: null, financialStatus: 'paid',
    mmpSentAt: null, brandConfirmedAt: null, brandEta: null,
    brandRequestCount: 0, brandDeliveredCount: 0, brandDeliveredMaxAt: null,
    larkQc: null, larkDispatch: null,
    packedMinAt: null, labelMinAt: null, hasTracking: false,
    packs: 0, packsDelivered: 0, packsException: 0,
    anyInTransit: false, anyOutForDelivery: false, shipDeliveredMaxAt: null,
    refundFirstAt: null,
    ...over,
  };
}
const run = (s: LifecycleSignals, prev: Parameters<typeof deriveLifecycle>[1] = null) =>
  deriveLifecycle(s, prev, DEFAULT_SLA, NOW);

describe('stage machine — thứ tự ưu tiên', () => {
  it('đơn mới → placed, deadline = placedAt + placed_to_production', () => {
    const r = run(sig());
    expect(r.currentStage).toBe('placed');
    expect(r.deadline).toEqual(new Date(d(1).getTime() + 24 * H));
    expect(r.delayStatus).toBe('on_track');
  });
  it('đã push brand → production', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1 }));
    expect(r.currentStage).toBe('production');
    expect(r.productionStartAt).toEqual(d(5));
  });
  it('mọi brand request delivered → goodsReceivedAt = max, stage qc', () => {
    const r = run(sig({ mmpSentAt: d(50), brandRequestCount: 2, brandDeliveredCount: 2, brandDeliveredMaxAt: d(10) }));
    expect(r.currentStage).toBe('qc');
    expect(r.goodsReceivedAt).toEqual(d(10));
  });
  it('mới delivered 1/2 request → vẫn production (kiện chậm nhất)', () => {
    const r = run(sig({ mmpSentAt: d(50), brandRequestCount: 2, brandDeliveredCount: 1, brandDeliveredMaxAt: d(10) }));
    expect(r.currentStage).toBe('production');
    expect(r.goodsReceivedAt).toBeNull();
  });
  it('packed → stage packed (đơn đủ kho: bỏ qua production/qc)', () => {
    const r = run(sig({ packedMinAt: d(3) }));
    expect(r.currentStage).toBe('packed');
    expect(r.packedAt).toEqual(d(3));
  });
  it('có label → shipped', () => {
    const r = run(sig({ packedMinAt: d(5), labelMinAt: d(2), hasTracking: true, packs: 1 }));
    expect(r.currentStage).toBe('shipped');
    expect(r.shippedAt).toEqual(d(2));
  });
  it('anyInTransit → in_transit (stamp inTransitAt = now lần đầu)', () => {
    const r = run(sig({ packedMinAt: d(5), labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.inTransitAt).toEqual(NOW);
  });
  it('anyOutForDelivery → out_for_delivery', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true, anyOutForDelivery: true }));
    expect(r.currentStage).toBe('out_for_delivery');
    expect(r.outForDeliveryAt).toEqual(NOW);
  });
  it('tất cả pack delivered → post_delivery, deliveredAt = max ship', () => {
    const r = run(sig({ labelMinAt: d(48), hasTracking: true, packs: 2, packsDelivered: 2, shipDeliveredMaxAt: d(5) }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.deliveredAt).toEqual(d(5));
  });
  it('delivered 1/2 pack → CHƯA post_delivery', () => {
    const r = run(sig({ labelMinAt: d(48), hasTracking: true, packs: 2, packsDelivered: 1, anyInTransit: true, shipDeliveredMaxAt: d(5) }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.deliveredAt).toBeNull();
  });
  it('Lark Delivery Completed (không có ship data) → post_delivery, stamp deliveredAt = now', () => {
    const r = run(sig({ larkDispatch: 'Delivery Completed' }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.deliveredAt).toEqual(NOW);
  });
});

describe('terminal + cửa sổ 30 ngày', () => {
  it('delivered quá 30 ngày, không return → completed, completedAt = deliveredAt+30d', () => {
    const del = d(31 * 24);
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: del }));
    expect(r.currentStage).toBe('completed');
    expect(r.completedAt).toEqual(new Date(del.getTime() + 30 * 24 * H));
  });
  it('quá 30 ngày nhưng đang Return-Processing → vẫn post_delivery', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(31 * 24), larkDispatch: 'Return-Processing' }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.returnProcessingAt).toEqual(NOW);
  });
  it('financialStatus refunded → refunded_full (terminal, thắng mọi stage)', () => {
    const r = run(sig({ financialStatus: 'refunded', refundFirstAt: d(2), packs: 1, packsDelivered: 1, shipDeliveredMaxAt: d(5), hasTracking: true }));
    expect(r.currentStage).toBe('refunded_full');
    expect(r.refundedAt).toEqual(d(2));
  });
  it('cancelledAt → cancelled (thắng cả refunded)', () => {
    const r = run(sig({ cancelledAt: d(1), financialStatus: 'refunded' }));
    expect(r.currentStage).toBe('cancelled');
    expect(r.cancelledAt).toEqual(d(1));
  });
});

describe('exception flag', () => {
  it('pack exception → exception=true, stage giữ nguyên', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, packsException: 1, anyInTransit: true }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.exception).toBe(true);
  });
  it('Return-Processing TRƯỚC delivered → exception', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true, larkDispatch: 'Return-Processing' }));
    expect(r.exception).toBe(true);
  });
  it('Return-Processing SAU delivered → KHÔNG exception (là post_delivery sub-state)', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(5), larkDispatch: 'Return-Processing' }));
    expect(r.exception).toBe(false);
    expect(r.currentStage).toBe('post_delivery');
  });
  it('hết exception → cờ tự hạ', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }),
      { qcPassAt: null, inTransitAt: d(3), outForDeliveryAt: null, returnProcessingAt: null, shippedAt: d(2), deliveredAt: null, completedAt: null });
    expect(r.exception).toBe(false);
  });
});

describe('first-seen stamps — không ghi đè', () => {
  it('inTransitAt giữ giá trị prev (không stamp lại now)', () => {
    const prev = { qcPassAt: null, inTransitAt: d(20), outForDeliveryAt: null, returnProcessingAt: null, shippedAt: d(22), deliveredAt: null, completedAt: null };
    const r = run(sig({ labelMinAt: d(22), hasTracking: true, packs: 1, anyInTransit: true }), prev);
    expect(r.inTransitAt).toEqual(d(20));
  });
  it('qcPassAt stamp lần đầu khi larkQc=pass, giữ ở lần sau', () => {
    const first = run(sig({ mmpSentAt: d(50), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(30), larkQc: 'pass' }));
    expect(first.qcPassAt).toEqual(NOW);
    const again = run(sig({ mmpSentAt: d(50), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(30), larkQc: 'pass' }),
      { ...first, completedAt: null });
    expect(again.qcPassAt).toEqual(NOW);
  });
});

describe('deadline + delay', () => {
  it('production dùng ETA brand khi có (deadline = cuối ngày ETA UTC)', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1, brandEta: '2026-07-10' }));
    expect(r.deadline).toEqual(new Date('2026-07-10T23:59:59.000Z'));
  });
  it('production không ETA → mmpSentAt + 240h', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1 }));
    expect(r.deadline).toEqual(new Date(d(5).getTime() + 240 * H));
  });
  it('overdue: quá deadline → delayHours = số giờ trễ (ceil)', () => {
    const r = run(sig({ placedAt: d(30) })); // deadline = placed+24h → trễ 6h
    expect(r.delayStatus).toBe('overdue');
    expect(r.delayHours).toBe(6);
  });
  it('due_soon: đã dùng ≥80% thời gian', () => {
    const r = run(sig({ placedAt: d(20) })); // 20/24 ≈ 83%
    expect(r.delayStatus).toBe('due_soon');
    expect(r.delayHours).toBe(0);
  });
  it('on_track khi <80%', () => {
    expect(run(sig({ placedAt: d(10) })).delayStatus).toBe('on_track');
  });
  it('qc: chưa pass → deadline goodsReceived+48h; đã pass → qcPassAt+pack 48h', () => {
    const base = sig({ mmpSentAt: d(90), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(10) });
    expect(run(base).deadline).toEqual(new Date(d(10).getTime() + 48 * H));
    const passed = run({ ...base, larkQc: 'pass' });
    expect(passed.deadline).toEqual(new Date(NOW.getTime() + 48 * H)); // qcPassAt=NOW + pack
  });
  it('shipped/in_transit/OFD chung deadline shippedAt + 168h', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }));
    expect(r.deadline).toEqual(new Date(d(2).getTime() + 168 * H));
  });
  it('post_delivery/terminal → không deadline, on_track', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(5) }));
    expect(r.deadline).toBeNull();
    expect(r.delayStatus).toBe('on_track');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lifecycle/derive.test.ts`
Expected: FAIL — "Cannot find module './derive'".

- [ ] **Step 3: Implement** `features/lifecycle/derive.ts`

```ts
/**
 * THUẦN (không I/O): suy ra snapshot vòng đời đơn từ tín hiệu nguồn đã flatten
 * (spec §3 stage machine + §4 SLA/delay). Orchestrator `sync.ts` lo query/upsert.
 *
 * Nguyên tắc:
 *  - Stage = mốc xa nhất đã đạt (đơn nhiều kiện: theo kiện chậm nhất).
 *  - First-seen stamps (qcPass/inTransit/outForDelivery/returnProcessing, fallback
 *    shipped/delivered): chỉ set khi prev null — không ghi đè.
 *  - exception là CỜ, không phải stage; tự hạ khi hết tín hiệu xấu.
 *  - completed = deliveredAt + 30 ngày, không có Return-Processing đang chạy.
 */

export type StageKey =
  | 'placed' | 'production' | 'qc' | 'packed' | 'shipped'
  | 'in_transit' | 'out_for_delivery' | 'post_delivery'
  | 'completed' | 'refunded_full' | 'cancelled';

export type SlaKey = 'placed_to_production' | 'production' | 'qc' | 'pack' | 'ship' | 'deliver';
export type DelayStatus = 'on_track' | 'due_soon' | 'overdue';

export const DEFAULT_SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};

const H = 3600_000;
const COMPLETED_WINDOW_MS = 30 * 24 * H;
/** Lark dispatch coi là sự cố khi CHƯA delivered. */
const EXCEPTION_DISPATCH = ['Return-Processing', 'Package Lost', 'Delivery Attempt Failed'];

export interface LifecycleSignals {
  placedAt: Date | null;
  cancelledAt: Date | null;
  financialStatus: string | null;
  mmpSentAt: Date | null;
  brandConfirmedAt: Date | null;
  brandEta: string | null; // 'YYYY-MM-DD' (max các request)
  brandRequestCount: number;
  brandDeliveredCount: number;
  brandDeliveredMaxAt: Date | null;
  larkQc: string | null;
  larkDispatch: string | null;
  packedMinAt: Date | null;
  labelMinAt: Date | null;
  hasTracking: boolean;
  packs: number;
  packsDelivered: number;
  packsException: number;
  anyInTransit: boolean;
  anyOutForDelivery: boolean;
  shipDeliveredMaxAt: Date | null;
  refundFirstAt: Date | null;
}

/** Stamps đã có từ snapshot trước (giữ first-seen). */
export interface LifecyclePrev {
  qcPassAt: Date | null;
  inTransitAt: Date | null;
  outForDeliveryAt: Date | null;
  returnProcessingAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
}

export interface LifecycleSnapshot {
  currentStage: StageKey;
  exception: boolean;
  exceptionNote: string | null;
  placedAt: Date | null;
  productionStartAt: Date | null;
  productionConfirmedAt: Date | null;
  productionEta: string | null;
  goodsReceivedAt: Date | null;
  qcPassAt: Date | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  inTransitAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  returnProcessingAt: Date | null;
  refundedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  deadline: Date | null;
  delayStatus: DelayStatus;
  delayHours: number;
}

export function deriveLifecycle(
  sig: LifecycleSignals,
  prev: LifecyclePrev | null,
  sla: Record<SlaKey, number>,
  now: Date,
): LifecycleSnapshot {
  // --- Mốc (kèm first-seen từ prev) ---
  const goodsReceivedAt =
    sig.brandRequestCount > 0 && sig.brandDeliveredCount === sig.brandRequestCount
      ? sig.brandDeliveredMaxAt : null;
  const qcPassAt = prev?.qcPassAt ?? (sig.larkQc === 'pass' ? now : null);
  const packedAt = sig.packedMinAt;
  const shippedAt = sig.labelMinAt ?? prev?.shippedAt ?? (sig.hasTracking ? now : null);
  const inTransitAt = prev?.inTransitAt ?? (sig.anyInTransit ? now : null);
  const outForDeliveryAt = prev?.outForDeliveryAt ?? (sig.anyOutForDelivery ? now : null);
  const allPacksDelivered = sig.packs > 0 && sig.packsDelivered === sig.packs;
  const larkDelivered = sig.larkDispatch === 'Delivery Completed';
  const deliveredAt = allPacksDelivered
    ? sig.shipDeliveredMaxAt
    : prev?.deliveredAt ?? (larkDelivered ? now : null);
  const returning = sig.larkDispatch === 'Return-Processing';
  const returnProcessingAt = prev?.returnProcessingAt ?? (returning && deliveredAt ? now : null);

  // --- Terminal + stage (ưu tiên giảm dần) ---
  let currentStage: StageKey;
  let completedAt: Date | null = prev?.completedAt ?? null;
  if (sig.cancelledAt) currentStage = 'cancelled';
  else if (sig.financialStatus === 'refunded') currentStage = 'refunded_full';
  else if (deliveredAt && now.getTime() >= deliveredAt.getTime() + COMPLETED_WINDOW_MS && !returning) {
    currentStage = 'completed';
    completedAt = completedAt ?? new Date(deliveredAt.getTime() + COMPLETED_WINDOW_MS);
  } else if (deliveredAt) currentStage = 'post_delivery';
  else if (outForDeliveryAt) currentStage = 'out_for_delivery';
  else if (inTransitAt) currentStage = 'in_transit';
  else if (shippedAt) currentStage = 'shipped';
  else if (packedAt) currentStage = 'packed';
  else if (goodsReceivedAt || qcPassAt) currentStage = 'qc';
  else if (sig.mmpSentAt) currentStage = 'production';
  else currentStage = 'placed';

  // --- Exception (cờ, tự hạ) ---
  const badDispatch = !deliveredAt && sig.larkDispatch != null && EXCEPTION_DISPATCH.includes(sig.larkDispatch);
  const exception = sig.packsException > 0 || badDispatch;
  const exceptionNote = exception
    ? (sig.packsException > 0 ? `${sig.packsException} kiện exception` : sig.larkDispatch)
    : null;

  // --- Deadline theo stage (spec §4) ---
  let anchor: Date | null = null;
  let deadline: Date | null = null;
  if (currentStage === 'placed' && sig.placedAt) {
    anchor = sig.placedAt;
    deadline = new Date(anchor.getTime() + sla.placed_to_production * H);
  } else if (currentStage === 'production' && sig.mmpSentAt) {
    anchor = sig.mmpSentAt;
    deadline = sig.brandEta
      ? new Date(`${sig.brandEta}T23:59:59.000Z`)
      : new Date(anchor.getTime() + sla.production * H);
  } else if (currentStage === 'qc') {
    if (!qcPassAt && goodsReceivedAt) {
      anchor = goodsReceivedAt;
      deadline = new Date(anchor.getTime() + sla.qc * H);
    } else if (qcPassAt) {
      anchor = qcPassAt;
      deadline = new Date(anchor.getTime() + sla.pack * H);
    }
  } else if (currentStage === 'packed' && packedAt) {
    anchor = packedAt;
    deadline = new Date(anchor.getTime() + sla.ship * H);
  } else if ((currentStage === 'shipped' || currentStage === 'in_transit' || currentStage === 'out_for_delivery') && shippedAt) {
    anchor = shippedAt;
    deadline = new Date(anchor.getTime() + sla.deliver * H);
  }
  // post_delivery / terminal: không deadline.

  // --- Delay ---
  let delayStatus: DelayStatus = 'on_track';
  let delayHours = 0;
  if (deadline && anchor) {
    if (now.getTime() > deadline.getTime()) {
      delayStatus = 'overdue';
      delayHours = Math.ceil((now.getTime() - deadline.getTime()) / H);
    } else {
      const ratio = (now.getTime() - anchor.getTime()) / (deadline.getTime() - anchor.getTime());
      if (ratio >= 0.8) delayStatus = 'due_soon';
    }
  }

  return {
    currentStage, exception, exceptionNote,
    placedAt: sig.placedAt,
    productionStartAt: sig.mmpSentAt,
    productionConfirmedAt: sig.brandConfirmedAt,
    productionEta: sig.brandEta,
    goodsReceivedAt, qcPassAt, packedAt, shippedAt, inTransitAt, outForDeliveryAt,
    deliveredAt, returnProcessingAt,
    refundedAt: sig.refundFirstAt,
    completedAt, cancelledAt: sig.cancelledAt,
    deadline, delayStatus, delayHours,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lifecycle/derive.test.ts`
Expected: PASS (24 tests). Nếu 1 case lệch, sửa IMPLEMENTATION cho khớp hành vi test (test là spec).

- [ ] **Step 5: Verify tsc + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add features/lifecycle/derive.ts features/lifecycle/derive.test.ts
git commit -m "feat(lifecycle): deriveLifecycle thuần (stage machine + SLA delay + first-seen stamps) + test"
```

---

### Task 3: Orchestrator `sync.ts` (batch signals → derive → upsert)

**Files:**
- Create: `features/lifecycle/sync.ts`

**Interfaces:**
- Consumes: `deriveLifecycle`, `DEFAULT_SLA`, types (Task 2); `schema.orderLifecycle`, `schema.lifecycleSla` (Task 1); bảng nguồn: `shopifyOrders`, `mmpOrderPushes`, `brandOrderRequests`, `orderFulfillment`+`orderFulfillmentLines`, `shipments`, `shopifyOrderRefunds`, `larkOrderStatus`.
- Produces: `syncOrderLifecycle(opts?: { sinceDays?: number }): Promise<{ scanned: number; upserted: number; errors: string[] }>`; `loadSlaMap(): Promise<Record<SlaKey, number>>`.

- [ ] **Step 1: Implement** `features/lifecycle/sync.ts`

```ts
/**
 * Orchestrator vòng đời đơn: batch-load tín hiệu nguồn (pattern
 * worklist-status-queries), flatten → deriveLifecycle (thuần) → upsert
 * order_lifecycle. Chạy bởi cron sync-lifecycle; lần đầu = backfill tự nhiên.
 * Lỗi 1 đơn không abort batch.
 */
import { and, eq, gte, inArray, notInArray, or, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  deriveLifecycle, DEFAULT_SLA,
  type LifecyclePrev, type LifecycleSignals, type SlaKey,
} from './derive';

const TERMINAL = ['completed', 'refunded_full', 'cancelled'];

export async function loadSlaMap(): Promise<Record<SlaKey, number>> {
  const rows = await db.select().from(schema.lifecycleSla);
  const map = { ...DEFAULT_SLA };
  for (const r of rows) if (r.key in map) map[r.key as SlaKey] = r.targetHours;
  return map;
}

export async function syncOrderLifecycle(
  opts?: { sinceDays?: number },
): Promise<{ scanned: number; upserted: number; errors: string[] }> {
  const sinceDays = opts?.sinceDays ?? 120;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600_000);
  const now = new Date();
  const sla = await loadSlaMap();
  const errors: string[] = [];

  // Đơn cần sync: tạo ≤ cutoff VÀ (chưa có snapshot HOẶC snapshot chưa terminal).
  const orders = await db.select({
    id: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    placedAt: schema.shopifyOrders.createdAtShopify,
    cancelledAt: schema.shopifyOrders.cancelledAtShopify,
    financialStatus: schema.shopifyOrders.financialStatus,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(
      gte(schema.shopifyOrders.createdAtShopify, cutoff),
      or(isNull(schema.orderLifecycle.id), notInArray(schema.orderLifecycle.currentStage, TERMINAL)),
    ));
  if (orders.length === 0) return { scanned: 0, upserted: 0, errors };
  const orderIds = orders.map((o) => o.id);

  // --- Batch aggregations (GROUP BY orderId) ---
  const pushes = await db.select({ orderId: schema.mmpOrderPushes.orderId, sentAt: schema.mmpOrderPushes.sentAt })
    .from(schema.mmpOrderPushes)
    .where(and(eq(schema.mmpOrderPushes.status, 'sent'), inArray(schema.mmpOrderPushes.orderId, orderIds)));

  const brandAgg = await db.select({
    orderId: schema.brandOrderRequests.orderId,
    total: sql<number>`count(*)`,
    delivered: sql<number>`count(*) filter (where ${schema.brandOrderRequests.deliveredAt} is not null)`,
    deliveredMax: sql<string | null>`max(${schema.brandOrderRequests.deliveredAt})`,
    confirmedMax: sql<string | null>`max(${schema.brandOrderRequests.confirmedAt})`,
    etaMax: sql<string | null>`max(${schema.brandOrderRequests.expectedDeliveryDate})`,
  }).from(schema.brandOrderRequests)
    .where(inArray(schema.brandOrderRequests.orderId, orderIds))
    .groupBy(schema.brandOrderRequests.orderId);

  const packAgg = await db.select({
    orderId: schema.orderFulfillment.orderId,
    packedMin: sql<string | null>`min(${schema.orderFulfillmentLines.packedAt})`,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .where(inArray(schema.orderFulfillment.orderId, orderIds))
    .groupBy(schema.orderFulfillment.orderId);

  const shipAgg = await db.select({
    orderId: schema.shipments.orderId,
    packs: sql<number>`count(*)`,
    delivered: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'delivered')`,
    exception: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'exception')`,
    inTransit: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} in ('in_transit','out_for_delivery'))`,
    outForDelivery: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'out_for_delivery')`,
    withTracking: sql<number>`count(*) filter (where ${schema.shipments.trackingNumber} is not null)`,
    labelMin: sql<string | null>`min(${schema.shipments.labelCreatedAt})`,
    deliveredMax: sql<string | null>`max(${schema.shipments.deliveredAt})`,
    packedFallbackMin: sql<string | null>`min(${schema.shipments.createdAt})`,
  }).from(schema.shipments)
    .where(inArray(schema.shipments.orderId, orderIds))
    .groupBy(schema.shipments.orderId);

  const refundAgg = await db.select({
    orderId: schema.shopifyOrderRefunds.orderId,
    firstAt: sql<string | null>`min(${schema.shopifyOrderRefunds.refundedAt})`,
  }).from(schema.shopifyOrderRefunds)
    .where(inArray(schema.shopifyOrderRefunds.orderId, orderIds))
    .groupBy(schema.shopifyOrderRefunds.orderId);

  const lark = await db.select({
    orderId: schema.larkOrderStatus.orderId,
    qc: schema.larkOrderStatus.qcStatus,
    dispatch: schema.larkOrderStatus.dispatchStatus,
    eta: schema.larkOrderStatus.expectedDeliveryDate,
  }).from(schema.larkOrderStatus).where(inArray(schema.larkOrderStatus.orderId, orderIds));

  const prevRows = await db.select().from(schema.orderLifecycle)
    .where(inArray(schema.orderLifecycle.orderId, orderIds));

  const ts = (v: string | Date | null | undefined): Date | null =>
    v == null ? null : v instanceof Date ? v : new Date(v);
  const pushMap = new Map(pushes.map((r) => [r.orderId, r.sentAt]));
  const brandMap = new Map(brandAgg.map((r) => [r.orderId, r]));
  const packMap = new Map(packAgg.map((r) => [r.orderId, r]));
  const shipMap = new Map(shipAgg.map((r) => [r.orderId, r]));
  const refundMap = new Map(refundAgg.map((r) => [r.orderId, r.firstAt]));
  const larkMap = new Map(lark.map((r) => [r.orderId, r]));
  const prevMap = new Map(prevRows.map((r) => [r.orderId, r]));

  let upserted = 0;
  for (const o of orders) {
    try {
      const b = brandMap.get(o.id);
      const s = shipMap.get(o.id);
      const lk = larkMap.get(o.id);
      const n = (v: unknown) => Number(v ?? 0);

      const signals: LifecycleSignals = {
        placedAt: o.placedAt,
        cancelledAt: o.cancelledAt,
        financialStatus: o.financialStatus,
        mmpSentAt: pushMap.get(o.id) ?? null,
        brandConfirmedAt: ts(b?.confirmedMax),
        brandEta: b?.etaMax ?? lk?.eta ?? null,
        brandRequestCount: n(b?.total),
        brandDeliveredCount: n(b?.delivered),
        brandDeliveredMaxAt: ts(b?.deliveredMax),
        larkQc: lk?.qc ?? null,
        larkDispatch: lk?.dispatch ?? null,
        packedMinAt: ts(packMap.get(o.id)?.packedMin) ?? ts(s?.packedFallbackMin),
        labelMinAt: ts(s?.labelMin),
        hasTracking: n(s?.withTracking) > 0,
        packs: n(s?.packs),
        packsDelivered: n(s?.delivered),
        packsException: n(s?.exception),
        anyInTransit: n(s?.inTransit) > 0,
        anyOutForDelivery: n(s?.outForDelivery) > 0,
        shipDeliveredMaxAt: ts(s?.deliveredMax),
        refundFirstAt: ts(refundMap.get(o.id)),
      };
      const p = prevMap.get(o.id);
      const prev: LifecyclePrev | null = p ? {
        qcPassAt: p.qcPassAt, inTransitAt: p.inTransitAt, outForDeliveryAt: p.outForDeliveryAt,
        returnProcessingAt: p.returnProcessingAt, shippedAt: p.shippedAt,
        deliveredAt: p.deliveredAt, completedAt: p.completedAt,
      } : null;

      const snap = deriveLifecycle(signals, prev, sla, now);
      await db.insert(schema.orderLifecycle)
        .values({ orderId: o.id, storeId: o.storeId, ...snap, syncedAt: now })
        .onConflictDoUpdate({
          target: schema.orderLifecycle.orderId,
          set: { ...snap, syncedAt: now },
        });
      upserted += 1;
    } catch (e) {
      errors.push(`${o.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { scanned: orders.length, upserted, errors };
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit` → exit 0. Nếu lỗi tên cột (vd `orderFulfillmentLines.fulfillmentId`, `brandOrderRequests.orderId`), mở `db/schema.ts` xác nhận tên thật và sửa sync.ts cho khớp — KHÔNG đổi schema nguồn. Nếu Drizzle từ chối `notInArray` với leftJoin-null, thay điều kiện bằng `or(isNull(schema.orderLifecycle.id), sql\`${schema.orderLifecycle.currentStage} not in ('completed','refunded_full','cancelled')\`)`.

- [ ] **Step 3: Commit**

```bash
git add features/lifecycle/sync.ts
git commit -m "feat(lifecycle): syncOrderLifecycle — batch signals → derive → upsert"
```

---

### Task 4: Cron registration `sync-lifecycle`

**Files:**
- Create: `scripts/cron/sync-lifecycle.ts`
- Create: `railway.cron-lifecycle.json`
- Modify: `package.json` (script `cron:sync-lifecycle`)

**Interfaces:**
- Consumes: `syncOrderLifecycle` (Task 3).

- [ ] **Step 1: Cron script** `scripts/cron/sync-lifecycle.ts` (mirror shape `scripts/cron/track-shipments.ts` — đọc file đó xác nhận style):

```ts
/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-lifecycle`
 *
 * Đối chiếu tín hiệu nguồn → upsert order_lifecycle (stage + mốc + SLA delay).
 * Lần chạy đầu = backfill đơn ≤120 ngày. Lỗi từng đơn không abort batch.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */
import { syncOrderLifecycle } from '@/features/lifecycle/sync';

async function main(): Promise<void> {
  const s = await syncOrderLifecycle();
  process.stdout.write(
    `sync-lifecycle: scanned ${s.scanned}, upserted ${s.upserted}, errors ${s.errors.length}\n`,
  );
  for (const e of s.errors.slice(0, 10)) process.stderr.write(`  ${e}\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`sync-lifecycle: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
```

- [ ] **Step 2: Railway config** `railway.cron-lifecycle.json` (copy `railway.cron-track.json`, đổi mỗi startCommand):

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": { "startCommand": "npm run cron:sync-lifecycle" }
}
```

- [ ] **Step 3: package.json** — thêm cạnh các `cron:*` hiện có (giữ JSON hợp lệ):

```json
    "cron:sync-lifecycle": "dotenv -- tsx scripts/cron/sync-lifecycle.ts",
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` → im lặng.

- [ ] **Step 5: Commit**

```bash
git add scripts/cron/sync-lifecycle.ts railway.cron-lifecycle.json package.json
git commit -m "feat(lifecycle): cron sync-lifecycle (đối chiếu + backfill snapshot vòng đời)"
```

---

## Self-Review

**1. Spec coverage (P1 = §5 + §10 dòng P1):**
- §5.1 `lifecycle_sla` + seed 6 key → Task 1. ✔
- §5.2 `order_lifecycle` đủ cột (16 mốc + delay + exception + index) → Task 1. ✔
- §5.3 `deriveLifecycle(signals, prev, slaMap, now)` thuần + first-seen + multi-pack + skip rules + exception + completed 30d + delay 3 mức + ETA brand → Task 2 (24 test). ✔
- §5.4 cron quét đơn chưa terminal ≤120 ngày, batch GROUP BY, backfill tự nhiên, lỗi 1 đơn không abort → Task 3 + 4. ✔
- KHÔNG UI/thống kê — đúng scope P1. ✔ Migration deferred (user áp) — ghi ở constraints. ✔

**2. Placeholder scan:** không TBD/TODO; mọi step có code/lệnh đầy đủ. Các NOTE Task 3 Step 2 / Task 4 Step 1 là kiểm-chứng-thực-tế tên cột/style với file thật, kèm fallback cụ thể — không phải placeholder.

**3. Type consistency:**
- `LifecycleSignals`/`LifecyclePrev`/`LifecycleSnapshot`/`SlaKey` (Task 2) khớp cách dùng Task 3 (`deriveLifecycle(signals, prev, sla, now)`, spread `...snap` vào upsert — tên field snapshot = tên cột camelCase Task 1). ✔
- `DEFAULT_SLA` 6 key = SLA keys Task 1 seed. ✔
- Stage keys trong derive = danh sách Global Constraints = TERMINAL list Task 3. ✔
- `syncOrderLifecycle` trả `{scanned, upserted, errors}` khớp cron Task 4. ✔
- `productionEta` là `date` (string 'YYYY-MM-DD') ở cả schema (Task 1), snapshot (Task 2 — string | null), signals `brandEta`. ✔

## Execution Handoff (điền sau khi lưu plan)
