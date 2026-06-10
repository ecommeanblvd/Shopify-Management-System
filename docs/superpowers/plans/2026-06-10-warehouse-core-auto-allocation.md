# Warehouse Core & Auto-Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kho đa kho HN/SG với ledger append-only, staging đi-đơn tách khỏi tồn, và auto-allocation hai chiều (đơn về tự giữ hàng, hàng về tự cấp đơn chờ FIFO).

**Architecture:** Mở rộng nền hiện có — `warehouse_inventory` thêm chiều kho, bảng mới `inventory_movements` là nguồn sự thật cho mọi biến động (helper `applyMovement` duy nhất, row-lock). Disposition `allocate_to_order` thôi ghi tồn (staging = `goods_receipt_items` chưa ship). Allocator thuần FIFO được hook vào sync đơn và QC-pass nhập kho.

**Tech Stack:** Next.js app router, Drizzle ORM/Postgres, Vitest. Spec: `docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md`.

**Quy ước chạy lệnh:** test = `npx vitest run <file>`; migration = `npm run db:generate` rồi `npm run db:migrate`; typecheck = `npx tsc --noEmit`. Commit message kết thúc bằng `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Schema — đa kho + ledger

**Files:**
- Modify: `db/schema.ts` (bảng `warehouseInventory` ~dòng 1336; thêm enum + bảng mới ngay dưới)
- Modify: `features/fulfillment/warehouse-actions.ts` (onConflict target đổi)
- Modify: `features/receiving/actions.ts:167` (onConflict target đổi — giữ compile; hành vi đổi ở Task 4)

- [ ] **Step 1.1: Sửa `warehouseInventory` trong `db/schema.ts`** — thêm `warehouseCode`, đổi unique, thêm check:

```ts
export const warehouseInventory = pgTable('warehouse_inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: text('sku').notNull(),
  /** Kho vật lý chứa hàng: 'HN' | 'SG'. Tồn tách theo (sku, kho). */
  warehouseCode: text('warehouse_code').notNull().default('HN'),
  productTitle: text('product_title'),
  variantTitle: text('variant_title'),
  qtyOnHand: integer('qty_on_hand').notNull().default(0),
  qtyReserved: integer('qty_reserved').notNull().default(0),
  shelf: text('shelf'),
  floor: text('floor'),
  bin: text('bin'),
  note: text('note'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('warehouse_inventory_sku_warehouse_idx').on(t.sku, t.warehouseCode),
  check('warehouse_qty_on_hand_nonneg', sql`${t.qtyOnHand} >= 0`),
  check('warehouse_qty_reserved_nonneg', sql`${t.qtyReserved} >= 0`),
  check('warehouse_reserved_lte_on_hand', sql`${t.qtyReserved} <= ${t.qtyOnHand}`),
]);
```

LƯU Ý: bỏ `.unique()` trên `sku`; drizzle sẽ generate `DROP CONSTRAINT`/`CREATE UNIQUE INDEX` — kiểm file SQL sinh ra trước khi migrate.

- [ ] **Step 1.2: Thêm enum + bảng `inventoryMovements` ngay dưới `warehouseInventory`:**

```ts
export const inventoryMovementReasonEnum = pgEnum('inventory_movement_reason', [
  'receipt_po', 'receipt_consignment', 'receipt_return',
  'auto_allocate', 'release_allocation', 'pick',
  'manual_adjust', 'transfer_in', 'transfer_out', 'migration',
]);

/** Ledger append-only: MỌI biến động tồn đi qua applyMovement (ledger.ts),
 *  không UPDATE qty trực tiếp ở bất kỳ đâu khác. */
export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  warehouseInventoryId: uuid('warehouse_inventory_id')
    .references(() => warehouseInventory.id, { onDelete: 'cascade' }).notNull(),
  deltaOnHand: integer('delta_on_hand').notNull().default(0),
  deltaReserved: integer('delta_reserved').notNull().default(0),
  reason: inventoryMovementReasonEnum('reason').notNull(),
  /** 'receipt_item' | 'fulfillment_line' | 'order' | 'transfer' */
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  note: text('note'),
  /** user id hoặc 'system:allocator' */
  actor: text('actor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('inventory_movements_inv_idx').on(t.warehouseInventoryId, t.createdAt),
  index('inventory_movements_reason_idx').on(t.reason),
]);
```

- [ ] **Step 1.3: Sửa 2 chỗ onConflict đang target `sku` đơn:** trong `features/fulfillment/warehouse-actions.ts` (`upsertWarehouseItem`) và `features/receiving/actions.ts:167`, đổi:

```ts
target: [schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode],
```

(`upsertWarehouseItem` thêm field `warehouseCode: input.warehouseCode ?? 'HN'` vào values; interface `WarehouseItemInput` thêm `warehouseCode?: string`.)

- [ ] **Step 1.4: Generate + soát + migrate**

Run: `npm run db:generate` → mở file `db/migrations/00xx_*.sql` kiểm: có `ALTER TABLE ... DROP CONSTRAINT "warehouse_inventory_sku_unique"` (hoặc tương đương), `CREATE UNIQUE INDEX ... (sku, warehouse_code)`, check mới, bảng `inventory_movements`. Rồi `npm run db:migrate`.
Expected: `migrations applied successfully`.

- [ ] **Step 1.5: Typecheck + test toàn bộ**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (hành vi chưa đổi).

- [ ] **Step 1.6: Commit** — `feat(warehouse): multi-warehouse inventory + movements ledger schema`

---

### Task 2: Logic thuần — allocator + movement validation (TDD)

**Files:**
- Create: `features/warehouse/allocation-logic.ts`
- Test: `features/warehouse/allocation-logic.test.ts`

- [ ] **Step 2.1: Viết test TRƯỚC** (`allocation-logic.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { pickWarehouse, planAllocation, fifoOrder, validateMovement } from './allocation-logic';

describe('pickWarehouse', () => {
  it('chọn kho khả dụng nhiều hơn', () => {
    expect(pickWarehouse([{ code: 'HN', available: 1 }, { code: 'SG', available: 5 }])).toBe('SG');
  });
  it('hoà -> HN', () => {
    expect(pickWarehouse([{ code: 'SG', available: 3 }, { code: 'HN', available: 3 }])).toBe('HN');
  });
  it('không kho nào có hàng -> null', () => {
    expect(pickWarehouse([{ code: 'HN', available: 0 }, { code: 'SG', available: 0 }])).toBeNull();
  });
});

describe('planAllocation — đủ-hoặc-không (v1, không partial)', () => {
  it('đủ ở một kho -> cấp từ kho đó', () => {
    expect(planAllocation({ sku: 'A', qty: 2 }, [
      { code: 'HN', available: 1 }, { code: 'SG', available: 3 },
    ])).toEqual({ warehouseCode: 'SG', qty: 2 });
  });
  it('tổng 2 kho đủ nhưng mỗi kho thiếu -> null (không tách kiện v1)', () => {
    expect(planAllocation({ sku: 'A', qty: 4 }, [
      { code: 'HN', available: 2 }, { code: 'SG', available: 3 },
    ])).toBeNull();
  });
  it('qty 0 hoặc âm -> null', () => {
    expect(planAllocation({ sku: 'A', qty: 0 }, [{ code: 'HN', available: 9 }])).toBeNull();
  });
});

describe('fifoOrder', () => {
  it('đơn về trước đứng trước; null processedAt xuống cuối', () => {
    const lines = [
      { id: 'b', orderProcessedAt: new Date('2026-06-02') },
      { id: 'c', orderProcessedAt: null },
      { id: 'a', orderProcessedAt: new Date('2026-06-01') },
    ];
    expect(fifoOrder(lines).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('validateMovement', () => {
  const inv = { qtyOnHand: 5, qtyReserved: 2 };
  it('hợp lệ: nhập kho', () => {
    expect(validateMovement(inv, { deltaOnHand: 3, deltaReserved: 0 })).toEqual({ ok: true });
  });
  it('chặn on-hand âm', () => {
    expect(validateMovement(inv, { deltaOnHand: -6, deltaReserved: 0 }).ok).toBe(false);
  });
  it('chặn reserved âm', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: -3 }).ok).toBe(false);
  });
  it('chặn reserved vượt on-hand', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: 4 }).ok).toBe(false);
  });
  it('chặn movement rỗng (cả hai delta = 0)', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: 0 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2.2: Chạy để thấy FAIL** — `npx vitest run features/warehouse/allocation-logic.test.ts` → fail (module chưa tồn tại).

- [ ] **Step 2.3: Implement `allocation-logic.ts`:**

```ts
/** Pure allocation logic — no DB. Spec §3:
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md */

export interface StockCandidate { code: string; available: number }

/** Kho khả dụng nhiều nhất; hoà -> HN trước (rồi alphabet cho kho tương lai). */
export function pickWarehouse(stocks: StockCandidate[]): string | null {
  const positive = stocks.filter((s) => s.available > 0);
  if (positive.length === 0) return null;
  positive.sort((a, b) =>
    b.available - a.available
    || (a.code === 'HN' ? -1 : b.code === 'HN' ? 1 : a.code.localeCompare(b.code)));
  return positive[0].code;
}

export interface AllocationPlan { warehouseCode: string; qty: number }

/** Đủ-hoặc-không tại MỘT kho (v1 không tách kiện giữa hai kho). */
export function planAllocation(
  line: { sku: string; qty: number },
  stocks: StockCandidate[],
): AllocationPlan | null {
  if (line.qty <= 0) return null;
  const code = pickWarehouse(stocks.filter((s) => s.available >= line.qty));
  return code ? { warehouseCode: code, qty: line.qty } : null;
}

/** FIFO theo thời điểm đơn về; thiếu mốc thời gian xếp cuối. */
export function fifoOrder<T extends { orderProcessedAt: Date | null }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.orderProcessedAt === null) return b.orderProcessedAt === null ? 0 : 1;
    if (b.orderProcessedAt === null) return -1;
    return a.orderProcessedAt.getTime() - b.orderProcessedAt.getTime();
  });
}

export interface MovementDelta { deltaOnHand: number; deltaReserved: number }

/** Bất biến tồn sau movement: on_hand ≥ 0, 0 ≤ reserved ≤ on_hand, delta ≠ rỗng. */
export function validateMovement(
  inv: { qtyOnHand: number; qtyReserved: number },
  d: MovementDelta,
): { ok: true } | { ok: false; error: string } {
  if (d.deltaOnHand === 0 && d.deltaReserved === 0) return { ok: false, error: 'Movement rỗng' };
  const onHand = inv.qtyOnHand + d.deltaOnHand;
  const reserved = inv.qtyReserved + d.deltaReserved;
  if (onHand < 0) return { ok: false, error: `on_hand âm (${onHand})` };
  if (reserved < 0) return { ok: false, error: `reserved âm (${reserved})` };
  if (reserved > onHand) return { ok: false, error: `reserved (${reserved}) vượt on_hand (${onHand})` };
  return { ok: true };
}
```

- [ ] **Step 2.4: Chạy lại test** → PASS. **Step 2.5: Commit** — `feat(warehouse): pure allocation + movement validation logic`

---

### Task 3: Ledger — `applyMovement`

**Files:**
- Create: `features/warehouse/ledger.ts`

(DB-bound; phần kiểm bất biến đã test thuần ở Task 2 — ledger chỉ là keo dán transaction, được phủ qua các action dùng nó.)

- [ ] **Step 3.1: Implement `ledger.ts`:**

```ts
/** Cổng DUY NHẤT chỉnh tồn kho: lock dòng tồn, kiểm bất biến, ghi movement,
 *  cập nhật tổng — tất cả trong transaction của caller. */
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import { validateMovement } from './allocation-logic';

type Tx = Parameters<Parameters<typeof import('@/db/client').db.transaction>[0]>[0];

export interface MovementDraft {
  sku: string;
  warehouseCode: string;
  deltaOnHand: number;
  deltaReserved: number;
  reason: 'receipt_po' | 'receipt_consignment' | 'receipt_return' | 'auto_allocate'
    | 'release_allocation' | 'pick' | 'manual_adjust' | 'transfer_in' | 'transfer_out' | 'migration';
  refType?: 'receipt_item' | 'fulfillment_line' | 'order' | 'transfer';
  refId?: string | null;
  note?: string | null;
  actor: string;
  /** Tự tạo dòng tồn nếu chưa có (nhập kho lần đầu cho SKU×kho). */
  createIfMissing?: { productTitle?: string | null; variantTitle?: string | null };
}

/** Trả về id dòng tồn đã chạm. Throw khi vi phạm bất biến. */
export async function applyMovement(tx: Tx, d: MovementDraft): Promise<string> {
  // Lock (hoặc tạo) dòng tồn — FOR UPDATE chặn hai allocator tranh nhau.
  let [inv] = await tx.select().from(schema.warehouseInventory)
    .where(and(eq(schema.warehouseInventory.sku, d.sku),
               eq(schema.warehouseInventory.warehouseCode, d.warehouseCode)))
    .for('update');
  if (!inv) {
    if (!d.createIfMissing) throw new Error(`Không có dòng tồn ${d.sku}@${d.warehouseCode}`);
    [inv] = await tx.insert(schema.warehouseInventory)
      .values({ sku: d.sku, warehouseCode: d.warehouseCode,
                productTitle: d.createIfMissing.productTitle ?? null,
                variantTitle: d.createIfMissing.variantTitle ?? null,
                updatedBy: d.actor })
      .onConflictDoNothing().returning();
    if (!inv) { // thua race tạo dòng — đọc lại có lock
      [inv] = await tx.select().from(schema.warehouseInventory)
        .where(and(eq(schema.warehouseInventory.sku, d.sku),
                   eq(schema.warehouseInventory.warehouseCode, d.warehouseCode)))
        .for('update');
    }
  }
  const v = validateMovement(inv, d);
  if (!v.ok) throw new Error(`Movement ${d.reason} ${d.sku}@${d.warehouseCode}: ${v.error}`);
  await tx.insert(schema.inventoryMovements).values({
    warehouseInventoryId: inv.id,
    deltaOnHand: d.deltaOnHand, deltaReserved: d.deltaReserved,
    reason: d.reason, refType: d.refType ?? null, refId: d.refId ?? null,
    note: d.note ?? null, actor: d.actor,
  });
  await tx.update(schema.warehouseInventory).set({
    qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${d.deltaOnHand}`,
    qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${d.deltaReserved}`,
    updatedBy: d.actor, updatedAt: sql`now()`,
  }).where(eq(schema.warehouseInventory.id, inv.id));
  return inv.id;
}
```

LƯU Ý kiểu `Tx`: nếu import-type trên gây khó chịu cho tsc, thay bằng kiểu transaction đã dùng sẵn trong `features/receiving/actions.ts` (tham số `tx` của `db.transaction`) — copy đúng pattern file đó.

- [ ] **Step 3.2:** `npx tsc --noEmit` → PASS. **Step 3.3: Commit** — `feat(warehouse): applyMovement ledger gate`

---

### Task 4: Allocator service + hook đơn mới

**Files:**
- Create: `features/warehouse/allocate.ts`
- Test: `features/warehouse/allocate.test.ts` (phần thuần: build candidates từ rows)
- Modify: `features/fulfillment/ensure-fulfillment.ts` (gọi allocator cuối hàm)

- [ ] **Step 4.1: Test phần thuần** — thêm vào `allocate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toCandidates } from './allocate';

describe('toCandidates', () => {
  it('gộp dòng tồn thành candidates available = onHand - reserved', () => {
    expect(toCandidates([
      { warehouseCode: 'HN', qtyOnHand: 5, qtyReserved: 2 },
      { warehouseCode: 'SG', qtyOnHand: 1, qtyReserved: 1 },
    ])).toEqual([{ code: 'HN', available: 3 }, { code: 'SG', available: 0 }]);
  });
});
```

Run → FAIL.

- [ ] **Step 4.2: Implement `allocate.ts`:**

```ts
/** Auto-allocation hai chiều (spec §4a/§4b). Best-effort: lỗi không được
 *  phá sync đơn — caller bọc try/catch như upsert-order vẫn làm. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { planAllocation, fifoOrder } from './allocation-logic';
import { applyMovement } from './ledger';
import { recomputeRollup } from '@/features/fulfillment/actions'; // nếu không export, copy helper rollup theo pattern receiving/actions.ts

const ACTOR = 'system:allocator';

export function toCandidates(
  rows: Array<{ warehouseCode: string; qtyOnHand: number; qtyReserved: number }>,
): Array<{ code: string; available: number }> {
  return rows.map((r) => ({ code: r.warehouseCode, available: r.qtyOnHand - r.qtyReserved }));
}

/** Đơn mới về: cấp kho cho từng dòng pending_check có SKU. */
export async function allocateOrder(orderId: string): Promise<void> {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return;
  const lines = await db.select()
    .from(schema.orderFulfillmentLines)
    .where(and(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
               eq(schema.orderFulfillmentLines.status, 'pending_check')));
  for (const line of lines) {
    if (!line.sku) continue; // SKU trống: để operator xử lý tay (spec §6)
    await allocateLine(line.id);
  }
}

/** Cấp MỘT dòng trong transaction riêng (lock theo SKU×kho qua applyMovement). */
async function allocateLine(lineId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, lineId)).for('update');
    if (!line || !line.sku) return false;
    if (line.status !== 'pending_check' && line.status !== 'out_of_stock') return false;

    const stocks = await tx.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.sku, line.sku)).for('update');
    const plan = planAllocation({ sku: line.sku, qty: line.qty }, toCandidates(stocks));

    if (!plan) {
      if (line.status === 'pending_check') {
        await tx.update(schema.orderFulfillmentLines)
          .set({ status: 'out_of_stock', updatedAt: sql`now()` })
          .where(eq(schema.orderFulfillmentLines.id, line.id));
        await tx.insert(schema.orderFulfillmentEvents).values({
          fulfillmentId: line.fulfillmentId, lineId: line.id,
          fromStatus: line.status, toStatus: 'out_of_stock',
          actor: ACTOR, note: 'Kho không đủ — chờ brand/nhập kho',
        });
        await recomputeRollup(tx, line.fulfillmentId);
      }
      return false;
    }

    const invId = await applyMovement(tx, {
      sku: line.sku, warehouseCode: plan.warehouseCode,
      deltaOnHand: 0, deltaReserved: plan.qty,
      reason: 'auto_allocate', refType: 'fulfillment_line', refId: line.id, actor: ACTOR,
    });
    await tx.update(schema.orderFulfillmentLines).set({
      status: 'in_stock', warehouseInventoryId: invId,
      allocatedQty: plan.qty, updatedAt: sql`now()`,
    }).where(eq(schema.orderFulfillmentLines.id, line.id));
    await tx.insert(schema.orderFulfillmentEvents).values({
      fulfillmentId: line.fulfillmentId, lineId: line.id,
      fromStatus: line.status, toStatus: 'in_stock',
      actor: ACTOR, note: `Auto-pick kho ${plan.warehouseCode}`,
    });
    await recomputeRollup(tx, line.fulfillmentId);
    return true;
  });
}

/** Hàng vừa nhập kho: cấp cho các dòng out_of_stock cùng SKU, đơn CŨ trước. */
export async function reallocateSku(sku: string): Promise<number> {
  const waiting = await db.select({
    lineId: schema.orderFulfillmentLines.id,
    orderProcessedAt: schema.shopifyOrders.processedAtShopify,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(eq(schema.orderFulfillmentLines.sku, sku),
               eq(schema.orderFulfillmentLines.status, 'out_of_stock')))
    .orderBy(asc(schema.shopifyOrders.processedAtShopify));
  let granted = 0;
  for (const w of fifoOrder(waiting.map((x) => ({ ...x, orderProcessedAt: x.orderProcessedAt })))) {
    if (await allocateLine(w.lineId)) granted++;
    else break; // hết hàng — các đơn sau chắc chắn cũng không đủ (cùng SKU, all-or-nothing)
  }
  return granted;
}
```

LƯU Ý `processedAtShopify` là cột text/timestamp tuỳ schema — kiểm `db/schema.ts` (`shopifyOrders.processedAtShopify`); nếu là text ISO thì map `new Date(x)` trước khi đưa vào `fifoOrder`. LƯU Ý `recomputeRollup`: helper hiện nằm trong `features/receiving/actions.ts` (private). Export nó từ một chỗ chung (`features/fulfillment/rollup.ts` — di chuyển hàm, 2 file cùng import) thay vì copy.

- [ ] **Step 4.3:** test pure pass; `npx tsc --noEmit` pass.

- [ ] **Step 4.4: Hook vào `ensure-fulfillment.ts`** — cuối `ensureFulfillmentForOrder` thêm:

```ts
  // Auto-allocation (spec §4a): best-effort — không phá sync khi lỗi.
  try {
    const { allocateOrder } = await import('@/features/warehouse/allocate');
    await allocateOrder(orderId);
  } catch (err) {
    console.error(`allocateOrder failed for ${orderId}:`, err);
  }
```

(dynamic import tránh cycle fulfillment ↔ warehouse.)

- [ ] **Step 4.5:** `npx vitest run` toàn bộ → PASS. **Step 4.6: Commit** — `feat(warehouse): two-way auto-allocator + order-sync hook`

---

### Task 5: Receiving đổi hành vi — staging tách kho + reallocate khi store

**Files:**
- Modify: `features/receiving/logic.ts` (`inventoryEffect`)
- Modify: `features/receiving/logic.test.ts`
- Modify: `features/receiving/actions.ts` (~dòng 150–190)

- [ ] **Step 5.1: Sửa test TRƯỚC** trong `logic.test.ts` — tìm describe của `inventoryEffect`, đổi expectation của `allocate_to_order`:

```ts
  it('allocate_to_order: KHÔNG đụng tồn kho (staging — spec C+ §2.3)', () => {
    expect(inventoryEffect('allocate_to_order', true))
      .toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: 'in_stock' });
  });
```

Run → FAIL (đang trả 1/1).

- [ ] **Step 5.2: Sửa `inventoryEffect` trong `logic.ts`:**

```ts
export function inventoryEffect(disposition: Disposition, hasSku: boolean): InvEffect {
  switch (disposition) {
    // Staging đi-đơn: kiện KHÔNG vào tồn kho (cross-dock) — chỉ chuyển
    // trạng thái dòng đơn. Spec 2026-06-10 warehouse-core §2.3.
    case 'allocate_to_order': return { onHandDelta: 0, reservedDelta: 0, lineStatus: 'in_stock' };
    case 'store': return { onHandDelta: hasSku ? 1 : 0, reservedDelta: 0, lineStatus: null };
    default: return { onHandDelta: 0, reservedDelta: 0, lineStatus: null };
  }
}
```

Run test file → PASS.

- [ ] **Step 5.3: Sửa `actions.ts` QC-pass:** thay block ghi tồn trực tiếp (~dòng 161–176) bằng `applyMovement` + reallocate:

```ts
    let inventoryRowId: string | null = null;
    if (hasSku && eff.onHandDelta !== 0) {
      // store: vào kho của PHIẾU nhập (goods_receipts.warehouse_code)
      const [r] = await tx.select({ wh: schema.goodsReceipts.warehouseCode })
        .from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, item.receiptId)).limit(1);
      const reasonBySource = {
        po: 'receipt_po', consignment: 'receipt_consignment', retail_for_order: 'receipt_po',
      } as const; // retail_for_order chỉ tới đây khi surplus-divert sang store
      inventoryRowId = await applyMovement(tx, {
        sku: item.sku!, warehouseCode: r?.wh ?? 'HN',
        deltaOnHand: eff.onHandDelta, deltaReserved: 0,
        reason: reasonBySource[receipt.sourceType as keyof typeof reasonBySource],
        refType: 'receipt_item', refId: item.id, actor: userId,
        createIfMissing: { productTitle: item.productTitle, variantTitle: item.variantTitle },
      });
    }
```

và dưới `if (disposition === 'allocate_to_order' && line)` giữ nguyên cập nhật line (giờ `inventoryRowId` luôn null cho nhánh này — đúng staging).

- [ ] **Step 5.4: Reallocate sau commit store:** cuối hàm action QC (sau `db.transaction` đóng), thêm:

```ts
  if (input.qcResult === 'pass' && itemSku) {
    try {
      const { reallocateSku } = await import('@/features/warehouse/allocate');
      await reallocateSku(itemSku);
    } catch (err) { console.error('reallocateSku failed:', err); }
  }
```

(`itemSku` hứng từ trong transaction ra biến ngoài; chỉ có ý nghĩa khi disposition = store — reallocate với SKU không dư hàng là no-op an toàn.)

- [ ] **Step 5.5:** `npx vitest run features/receiving` + `npx tsc --noEmit` → PASS. **Step 5.6: Commit** — `feat(receiving): staging keeps order-bound goods out of stock; store triggers reallocation`

---

### Task 6: Pick & nhả hàng qua ledger

**Files:**
- Modify: `features/fulfillment/actions.ts` (~dòng 81–95: decrement khi `picked`)
- Create: `features/warehouse/release.ts`
- Modify: `features/shopify-orders/sync/upsert-order.ts` (hook huỷ đơn)

- [ ] **Step 6.1: Pick:** trong `features/fulfillment/actions.ts`, thay khối trừ kho trực tiếp khi `next === 'picked'` bằng:

```ts
  if (next === 'picked' && l.warehouseInventoryId && l.allocatedQty > 0) {
    const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, wh: schema.warehouseInventory.warehouseCode })
      .from(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, l.warehouseInventoryId)).limit(1);
    if (inv) {
      await applyMovement(tx, {
        sku: inv.sku, warehouseCode: inv.wh,
        deltaOnHand: -l.allocatedQty, deltaReserved: -l.allocatedQty,
        reason: 'pick', refType: 'fulfillment_line', refId: l.id, actor: userId,
      });
    }
  }
```

(import `applyMovement`; giữ nguyên phần stamp `pickedAt`.)

- [ ] **Step 6.2: `release.ts`:**

```ts
/** Nhả reservation khi đơn huỷ / dòng biến mất, rồi đưa hàng cho đơn chờ kế. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { applyMovement } from './ledger';

export async function releaseOrderAllocations(orderId: string, actor = 'system:release'): Promise<void> {
  const released: string[] = [];
  await db.transaction(async (tx) => {
    const lines = await tx.select({
      id: schema.orderFulfillmentLines.id,
      sku: schema.orderFulfillmentLines.sku,
      allocatedQty: schema.orderFulfillmentLines.allocatedQty,
      invId: schema.orderFulfillmentLines.warehouseInventoryId,
      fulfillmentId: schema.orderFulfillmentLines.fulfillmentId,
      status: schema.orderFulfillmentLines.status,
    })
      .from(schema.orderFulfillmentLines)
      .innerJoin(schema.orderFulfillment,
        eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
      .where(and(eq(schema.orderFulfillment.orderId, orderId),
                 eq(schema.orderFulfillmentLines.status, 'in_stock')))
      .for('update');
    for (const l of lines) {
      if (!l.invId || l.allocatedQty <= 0 || !l.sku) continue;
      const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, wh: schema.warehouseInventory.warehouseCode })
        .from(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, l.invId)).limit(1);
      if (!inv) continue;
      await applyMovement(tx, {
        sku: inv.sku, warehouseCode: inv.wh,
        deltaOnHand: 0, deltaReserved: -l.allocatedQty,
        reason: 'release_allocation', refType: 'order', refId: orderId, actor,
      });
      await tx.update(schema.orderFulfillmentLines)
        .set({ warehouseInventoryId: null, allocatedQty: 0, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      released.push(l.sku);
    }
  });
  // Hàng vừa nhả → đơn chờ kế (ngoài transaction trên, mỗi SKU một lần)
  const { reallocateSku } = await import('./allocate');
  for (const sku of [...new Set(released)]) {
    try { await reallocateSku(sku); } catch (e) { console.error('reallocate after release:', e); }
  }
}
```

- [ ] **Step 6.3: Hook huỷ đơn** trong `upsert-order.ts`: tìm chỗ set `cancelledAtShopify` (grep `cancelled`); sau khi upsert phát hiện đơn chuyển sang cancelled (trước đó null), gọi best-effort:

```ts
      if (becameCancelled) {
        try {
          const { releaseOrderAllocations } = await import('@/features/warehouse/release');
          await releaseOrderAllocations(internalOrderId);
        } catch (err) { console.error('releaseOrderAllocations failed:', err); }
      }
```

(`becameCancelled` = payload.cancelledAt != null && bản ghi cũ chưa cancelled — lấy giá trị cũ trong cùng câu upsert/select hiện có của file.)

- [ ] **Step 6.4:** `npx vitest run` + `npx tsc --noEmit` → PASS. **Step 6.5: Commit** — `feat(warehouse): pick + cancel-release flow through the ledger`

---

### Task 7: Warehouse actions mới (điều chỉnh / chuyển kho) thay `adjustStock`

**Files:**
- Modify: `features/fulfillment/warehouse-actions.ts`

- [ ] **Step 7.1: Thay `adjustStock` + thêm `transferStock`:**

```ts
export async function adjustStock(input: {
  sku: string; warehouseCode: string; delta: number; note: string;
}): Promise<void> {
  const userId = await requireWarehouse();
  if (!input.note?.trim()) throw new Error('Điều chỉnh tay bắt buộc ghi lý do');
  if (!input.delta) throw new Error('Delta phải khác 0');
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      sku: input.sku.trim(), warehouseCode: input.warehouseCode,
      deltaOnHand: input.delta, deltaReserved: 0,
      reason: 'manual_adjust', note: input.note.trim(), actor: userId,
      createIfMissing: {},
    });
  });
  if (input.delta > 0) { // hàng mới xuất hiện -> thử cấp đơn chờ
    try {
      const { reallocateSku } = await import('@/features/warehouse/allocate');
      await reallocateSku(input.sku.trim());
    } catch (e) { console.error(e); }
  }
  revalidatePath('/f/fulfillment/warehouse');
}

export async function transferStock(input: {
  sku: string; from: string; to: string; qty: number; note?: string | null;
}): Promise<void> {
  const userId = await requireWarehouse();
  if (input.qty <= 0) throw new Error('Số lượng chuyển phải > 0');
  if (input.from === input.to) throw new Error('Kho nguồn trùng kho đích');
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      sku: input.sku.trim(), warehouseCode: input.from,
      deltaOnHand: -input.qty, deltaReserved: 0,
      reason: 'transfer_out', refType: 'transfer', note: input.note ?? null, actor: userId,
    });
    await applyMovement(tx, {
      sku: input.sku.trim(), warehouseCode: input.to,
      deltaOnHand: input.qty, deltaReserved: 0,
      reason: 'transfer_in', refType: 'transfer', note: input.note ?? null, actor: userId,
      createIfMissing: {},
    });
  });
  revalidatePath('/f/fulfillment/warehouse');
}
```

(Tìm mọi caller `adjustStock` cũ — grep — và cập nhật chữ ký.)

- [ ] **Step 7.2:** typecheck + full test → PASS. **Step 7.3: Commit** — `feat(warehouse): manual adjust + HN/SG transfer via ledger`

---

### Task 8: Migration dữ liệu một lần (dry-run trước)

**Files:**
- Create: `scripts/migrate-warehouse-staging.ts`

- [ ] **Step 8.1: Viết script** (chạy `npx dotenv -- npx tsx scripts/migrate-warehouse-staging.ts [--apply]`):

```ts
/** Một lần: (1) gỡ khỏi tồn phần hàng đi-đơn từng cộng vào (giờ là staging),
 *  (2) backfill allocator FIFO cho đơn đang chờ. Mặc định DRY-RUN. */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

async function main() {
  const apply = process.argv.includes('--apply');
  // (1) các dòng đơn in_stock có warehouseInventoryId mà nguồn là kiện
  // retail_for_order (allocate_to_order) -> từng +1/+1 vào kho: gỡ ra.
  const staged = await db.execute(sql`
    select l.id line_id, l.allocated_qty, l.warehouse_inventory_id inv_id,
           i.sku, i.warehouse_code
    from order_fulfillment_lines l
    join goods_receipt_items g on g.fulfillment_line_id = l.id and g.disposition = 'allocate_to_order'
    join warehouse_inventory i on i.id = l.warehouse_inventory_id
    where l.status in ('in_stock','picked')`);
  console.log('Dòng staging từng cộng vào kho:', staged.rows.length);
  if (apply) {
    for (const r of staged.rows as any[]) {
      await db.transaction(async (tx) => {
        const { applyMovement } = await import('@/features/warehouse/ledger');
        await applyMovement(tx, {
          sku: r.sku, warehouseCode: r.warehouse_code,
          deltaOnHand: -r.allocated_qty, deltaReserved: -r.allocated_qty,
          reason: 'migration', refType: 'fulfillment_line', refId: r.line_id,
          note: 'Gỡ staging khỏi tồn (spec 2026-06-10 §2.3)', actor: 'system:migration',
        });
        await tx.update(schema.orderFulfillmentLines)
          .set({ warehouseInventoryId: null })
          .where(eq(schema.orderFulfillmentLines.id, r.line_id));
      });
    }
  }
  // (2) backfill allocator cho mọi dòng pending_check/out_of_stock, FIFO
  const waiting = await db.execute(sql`
    select distinct f.order_id from order_fulfillment f
    join order_fulfillment_lines l on l.fulfillment_id = f.id
    join shopify_orders o on o.id = f.order_id
    where l.status in ('pending_check','out_of_stock') and o.cancelled_at_shopify is null
    order by 1`);
  console.log('Đơn chờ allocator:', waiting.rows.length);
  if (apply) {
    const { allocateOrder } = await import('@/features/warehouse/allocate');
    for (const r of waiting.rows as any[]) await allocateOrder(r.order_id);
  }
  console.log(apply ? 'ÁP DỤNG XONG' : 'DRY-RUN — thêm --apply để chạy thật');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

LƯU Ý: kiểm tên cột `cancelled_at_shopify` trong schema trước (grep `cancelledAtShopify`); FIFO của (2) dựa trên `allocateOrder` chạy theo thứ tự order_id — sửa `order by` thành `o.processed_at_shopify asc` cho đúng FIFO.

- [ ] **Step 8.2: Dry-run, soát số liệu, rồi `--apply`.** Sau apply: kiểm vài SKU bằng query tổng on_hand/reserved vs ledger sum.
- [ ] **Step 8.3: Commit script** — `chore(warehouse): one-off staging/backfill migration script`

---

### Task 9: UI trang Kho

**Files:**
- Modify: `app/(dashboard)/f/fulfillment/warehouse/page.tsx`
- Create: `components/fulfillment/WarehouseBoard.tsx` (client: tabs + bảng + drawer + form)
- Create: `features/warehouse/queries.ts`

- [ ] **Step 9.1: `queries.ts`:**

```ts
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listInventory() {
  return db.select().from(schema.warehouseInventory)
    .orderBy(schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode);
}

export async function listMovements(warehouseInventoryId: string, limit = 50) {
  return db.select().from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.warehouseInventoryId, warehouseInventoryId))
    .orderBy(desc(schema.inventoryMovements.createdAt)).limit(limit);
}
```

- [ ] **Step 9.2: `WarehouseBoard.tsx`** — client component theo đúng pattern bảng + filter của `components/shipping-reconcile/ReconcileTable.tsx`: tabs `HN / SG / Tất cả`; cột SKU · tên · on-hand · reserved · **khả dụng** (on-hand − reserved, in đậm) · vị trí; click dòng mở drawer lịch sử movement (gọi server action bọc `listMovements`, hiển thị: lúc · lý do (label tiếng Việt) · Δon-hand · Δreserved · note · actor); 2 nút mở form **Điều chỉnh** (sku, kho, delta, lý do bắt buộc → `adjustStock`) và **Chuyển kho** (sku, từ→đến, qty → `transferStock`). Nhãn lý do:

```ts
const REASON_LABEL: Record<string, string> = {
  receipt_po: 'Nhập PO', receipt_consignment: 'Nhập ký gửi', receipt_return: 'Nhập hàng trả',
  auto_allocate: 'Giữ cho đơn', release_allocation: 'Nhả giữ', pick: 'Xuất pick đơn',
  manual_adjust: 'Điều chỉnh tay', transfer_in: 'Chuyển kho đến', transfer_out: 'Chuyển kho đi',
  migration: 'Migration',
};
```

- [ ] **Step 9.3: `page.tsx`** giữ guard quyền hiện có, load `listInventory()` → render `WarehouseBoard`.
- [ ] **Step 9.4:** `npm run build` → PASS. **Step 9.5: Commit** — `feat(warehouse): per-warehouse stock board with movement history`

---

### Task 10: UI Khu chờ đi đơn (staging)

**Files:**
- Create: `app/(dashboard)/f/fulfillment/staging/page.tsx`
- Create: `features/warehouse/staging-queries.ts`
- Modify: `app/(dashboard)/f/fulfillment/page.tsx` (thêm link/tile "Khu chờ đi đơn")

- [ ] **Step 10.1: `staging-queries.ts`:**

```ts
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Kiện đang nằm khu chờ: allocate_to_order + dòng đơn chưa shipped. */
export async function listStaging() {
  return db.select({
    itemId: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    productTitle: schema.goodsReceiptItems.productTitle,
    photoKey: schema.goodsReceiptItems.photoKey,
    receivedAt: schema.goodsReceiptItems.createdAt,
    orderId: schema.goodsReceiptItems.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    lineStatus: schema.orderFulfillmentLines.status,
    fulfillmentStatus: schema.orderFulfillment.status,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.orderFulfillmentLines,
      eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(eq(schema.goodsReceiptItems.disposition, 'allocate_to_order'),
               ne(schema.orderFulfillmentLines.status, 'shipped')));
}
```

- [ ] **Step 10.2: `staging/page.tsx`** — server component (guard `view_receiving`): nhóm kết quả theo đơn; mỗi đơn: số đơn (link sang `/f/fulfillment/[orderId]`), kiện đã về (mã + SKU), trạng thái đơn, tuổi chờ (`now − min(receivedAt)` ngày); badge xanh **"Sẵn sàng đi"** khi `fulfillmentStatus ∈ {ready_to_pick, picking, packed}`. Bảng sort: sẵn-sàng trước, rồi tuổi giảm dần.
- [ ] **Step 10.3: Dòng đơn hiện nguồn** — trong trang `/f/fulfillment/[orderId]` (component bảng dòng hiện có): cột "Nguồn" = `Kho ${warehouseCode}` (join qua `warehouseInventoryId`) | `Khu chờ` (tồn tại receipt item allocate_to_order gắn line) | `Chờ brand` (status brand_*) | `—`.
- [ ] **Step 10.4:** `npm run build` → PASS. **Step 10.5: Commit** — `feat(warehouse): staging board + line source labels`

---

### Task 11: Tổng kiểm & đẩy

- [ ] **Step 11.1:** `npx vitest run` (toàn bộ) + `npx tsc --noEmit` + `npx eslint features/warehouse features/receiving features/fulfillment components/fulfillment` → PASS sạch.
- [ ] **Step 11.2:** Chạy lại `scripts/migrate-warehouse-staging.ts` dry-run xác nhận 0 việc tồn (đã apply ở Task 8).
- [ ] **Step 11.3:** Smoke thật trên DB: tạo 1 movement điều chỉnh +1 cho SKU test ở SG → kiểm ledger + tồn; chuyển kho 1 đơn vị SG→HN; xoá lại bằng điều chỉnh −1 (ghi chú "smoke test").
- [ ] **Step 11.4:** `git push origin main` — Railway tự deploy.

---

## Self-review (đã chạy)

- **Spec coverage:** §2.1→T1, §2.2→T1, §2.3→T5+T8, §3→T2, ledger §3→T3, §4a→T4, §4b→T5, §4c→T5, §4d→T6, §4e→T6, §4f→T7, §5.1→T9, §5.2–5.3→T10, §6 backfill→T8, §7→T2/T5 test-first. Đủ.
- **Type consistency:** `applyMovement(tx, MovementDraft)` thống nhất T3–T8; `toCandidates` chỉ T4; `planAllocation` T2↔T4 cùng chữ ký.
- **Placeholder:** không còn TBD; các LƯU Ý đều chỉ rõ việc kiểm tra cụ thể (tên cột, export rollup).
