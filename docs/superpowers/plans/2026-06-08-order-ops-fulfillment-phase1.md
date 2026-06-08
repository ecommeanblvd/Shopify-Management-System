# Order Operations / Fulfillment — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi đơn về từ store, tạo bản ghi vận hành line-level, tự động đối chiếu tồn kho MEAN, hiển thị kệ/tầng để lấy (còn hàng) hoặc gắn cờ "cần đặt brand" (hết), và chạy trọn luồng pick → pack → ship với trừ tồn.

**Architecture:** Một module thuần `features/fulfillment/logic.ts` (checkStock, rollupOrderStatus, transition validation — test được, không DB). Server actions bọc transaction DB cho reserve/decrement + transitions. Bản ghi tạo khi sync đơn (hook vào `upsertOrder`) + backfill. UI dưới `/f/fulfillment`.

**Tech Stack:** Next.js (app router fork — đọc `node_modules/next/dist/docs/` trước khi viết route/action theo AGENTS.md), Drizzle + Postgres, Better-Auth + RBAC, Vitest, Tailwind.

**Spec:** [docs/superpowers/specs/2026-06-08-order-ops-fulfillment-phase1-design.md](../specs/2026-06-08-order-ops-fulfillment-phase1-design.md)

---

## File Structure

- `db/schema.ts` — **modify**: 2 enums + 4 bảng (`warehouseInventory`, `orderFulfillment`, `orderFulfillmentLines`, `orderFulfillmentEvents`).
- `db/migrations/NNNN_*.sql` — **generate**.
- `features/fulfillment/logic.ts` — **create**: thuần (`checkStock`, `rollupOrderStatus`, `canTransitionLine`, types).
- `features/fulfillment/logic.test.ts` — **create**.
- `features/fulfillment/queries.ts` — **create**: đọc dữ liệu cho UI (worklist, order detail, warehouse list).
- `features/fulfillment/actions.ts` — **create**: `checkStockForOrder`, `markLine`, `markOrder`.
- `features/fulfillment/warehouse-actions.ts` — **create**: `upsertWarehouseItem`, `adjustStock`.
- `features/fulfillment/ensure-fulfillment.ts` — **create**: `ensureFulfillmentForOrder(tx, orderId)` (idempotent) + `backfillFulfillmentRecords`.
- `features/shopify-orders/sync/upsert-order.ts` — **modify**: gọi `ensureFulfillmentForOrder` sau khi upsert lines.
- `lib/auth/rbac.ts` — **modify**: thêm 3 permission.
- `lib/nav.ts` + `lib/nav.test.ts` — **modify**: nav item.
- `app/(dashboard)/f/fulfillment/page.tsx` — **create**: worklist.
- `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` — **create**: chi tiết.
- `app/(dashboard)/f/fulfillment/warehouse/page.tsx` — **create**: quản lý kho.
- `components/fulfillment/*` — **create**: client components.

---

## Task 1: Schema + migration

**Files:**
- Modify: `db/schema.ts`
- Generate: `db/migrations/`

- [ ] **Step 1: Add enums + tables**

Append near the other order tables in `db/schema.ts` (after `shopifyOrderRefunds` / order block). (`pgEnum, uuid, text, integer, timestamp` đã import ở đầu file.)

```typescript
export const fulfillmentLineStatusEnum = pgEnum('fulfillment_line_status', [
  'pending_check', 'in_stock', 'out_of_stock', 'picked', 'packed', 'shipped',
]);
export const fulfillmentOrderStatusEnum = pgEnum('fulfillment_order_status', [
  'received', 'checking', 'awaiting_brand', 'ready_to_pick', 'picking', 'packed', 'shipped',
]);

/** MEAN warehouse stock, keyed by SKU. Operator-managed (manual entry). */
export const warehouseInventory = pgTable('warehouse_inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: text('sku').notNull().unique(),
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
});

/** One ops record per Shopify order. status = rollup derived from lines. */
export const orderFulfillment = pgTable('order_fulfillment', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  status: fulfillmentOrderStatusEnum('status').notNull().default('received'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('order_fulfillment_status_idx').on(t.status)]);

/** Per order-line fulfillment state. */
export const orderFulfillmentLines = pgTable('order_fulfillment_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentId: uuid('fulfillment_id').references(() => orderFulfillment.id, { onDelete: 'cascade' }).notNull(),
  orderLineId: uuid('order_line_id').references(() => shopifyOrderLines.id, { onDelete: 'cascade' }).notNull().unique(),
  sku: text('sku'),
  qty: integer('qty').notNull(),
  status: fulfillmentLineStatusEnum('status').notNull().default('pending_check'),
  warehouseInventoryId: uuid('warehouse_inventory_id').references(() => warehouseInventory.id),
  allocatedQty: integer('allocated_qty').notNull().default(0),
  shipmentId: uuid('shipment_id').references(() => shipments.id),
  pickedAt: timestamp('picked_at'),
  packedAt: timestamp('packed_at'),
  shippedAt: timestamp('shipped_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('order_fulfillment_lines_ful_idx').on(t.fulfillmentId)]);

/** Audit log of status transitions. */
export const orderFulfillmentEvents = pgTable('order_fulfillment_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentId: uuid('fulfillment_id').references(() => orderFulfillment.id, { onDelete: 'cascade' }).notNull(),
  lineId: uuid('line_id'),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actor: text('actor'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate migration**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit generate`
Expected: new `db/migrations/NNNN_*.sql` with the 2 `CREATE TYPE` + 4 `CREATE TABLE`.

- [ ] **Step 3: Apply migration**

> Note (môi trường staging này): `drizzle-kit migrate` có thể treo do lệch tracking journal. Nếu treo: apply file SQL trực tiếp trong transaction rồi đăng ký 1 dòng vào `drizzle.__drizzle_migrations` (hash = sha256 file, created_at = `when` trong `meta/_journal.json`), như đã làm cho migration 0037. Sau đó `drizzle-kit migrate` chạy sạch.

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit migrate`
Verify: `psql "postgres://macos@localhost:5432/staging" -tA -c "select count(*) from warehouse_inventory;"` → `0`

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add db/schema.ts db/migrations/
git commit -m "feat(fulfillment): schema for order-ops + warehouse inventory"
```

---

## Task 2: Pure logic + tests (TDD)

**Files:**
- Create: `features/fulfillment/logic.ts`
- Test: `features/fulfillment/logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/fulfillment/logic.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  checkStock, rollupOrderStatus, canTransitionLine,
  type StockInfo, type LineStatus,
} from './logic';

describe('checkStock', () => {
  const stock = new Map<string, StockInfo>([
    ['A', { available: 5, warehouseInventoryId: 'w-a' }],
    ['B', { available: 1, warehouseInventoryId: 'w-b' }],
  ]);
  it('marks a line in_stock when available >= qty', () => {
    expect(checkStock({ sku: 'A', qty: 3 }, stock)).toEqual({ status: 'in_stock', warehouseInventoryId: 'w-a', allocatedQty: 3 });
  });
  it('marks out_of_stock when available < qty', () => {
    expect(checkStock({ sku: 'B', qty: 2 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
  it('marks out_of_stock when sku absent from warehouse', () => {
    expect(checkStock({ sku: 'Z', qty: 1 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
  it('marks out_of_stock when sku is null', () => {
    expect(checkStock({ sku: null, qty: 1 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
});

describe('rollupOrderStatus', () => {
  const roll = (statuses: LineStatus[]) => rollupOrderStatus(statuses);
  it('all shipped -> shipped', () => expect(roll(['shipped', 'shipped'])).toBe('shipped'));
  it('any out_of_stock (not all shipped) -> awaiting_brand', () => expect(roll(['in_stock', 'out_of_stock'])).toBe('awaiting_brand'));
  it('all in_stock -> ready_to_pick', () => expect(roll(['in_stock', 'in_stock'])).toBe('ready_to_pick'));
  it('some picked -> picking', () => expect(roll(['picked', 'in_stock'])).toBe('picking'));
  it('some packed (none out) -> packed', () => expect(roll(['packed', 'picked'])).toBe('packed'));
  it('still pending_check -> checking', () => expect(roll(['pending_check', 'in_stock'])).toBe('checking'));
  it('empty -> received', () => expect(roll([])).toBe('received'));
  it('out_of_stock dominates pending_check', () => expect(roll(['pending_check', 'out_of_stock'])).toBe('awaiting_brand'));
});

describe('canTransitionLine', () => {
  it('in_stock -> picked allowed', () => expect(canTransitionLine('in_stock', 'picked')).toBe(true));
  it('picked -> packed allowed', () => expect(canTransitionLine('picked', 'packed')).toBe(true));
  it('packed -> shipped allowed', () => expect(canTransitionLine('packed', 'shipped')).toBe(true));
  it('in_stock -> packed NOT allowed (must pick first)', () => expect(canTransitionLine('in_stock', 'packed')).toBe(false));
  it('out_of_stock -> picked NOT allowed', () => expect(canTransitionLine('out_of_stock', 'picked')).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run features/fulfillment/logic.test.ts`
Expected: FAIL — cannot find module `./logic`.

- [ ] **Step 3: Implement `logic.ts`**

Create `features/fulfillment/logic.ts`:

```typescript
/**
 * Pure fulfillment logic — no DB. Stock check, order-status rollup, and
 * line transition validation. Unit-testable in isolation.
 */
export type LineStatus = 'pending_check' | 'in_stock' | 'out_of_stock' | 'picked' | 'packed' | 'shipped';
export type OrderStatus = 'received' | 'checking' | 'awaiting_brand' | 'ready_to_pick' | 'picking' | 'packed' | 'shipped';

export interface StockInfo {
  available: number; // qtyOnHand - qtyReserved
  warehouseInventoryId: string;
}

export interface CheckResult {
  status: 'in_stock' | 'out_of_stock';
  warehouseInventoryId: string | null;
  allocatedQty: number;
}

/** Decide a single line's stock status against a sku->stock map. */
export function checkStock(line: { sku: string | null; qty: number }, stock: Map<string, StockInfo>): CheckResult {
  if (line.sku == null) return { status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 };
  const info = stock.get(line.sku);
  if (info && info.available >= line.qty) {
    return { status: 'in_stock', warehouseInventoryId: info.warehouseInventoryId, allocatedQty: line.qty };
  }
  return { status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 };
}

/** Derive the order-level rollup status from its line statuses. */
export function rollupOrderStatus(lines: LineStatus[]): OrderStatus {
  if (lines.length === 0) return 'received';
  if (lines.every((s) => s === 'shipped')) return 'shipped';
  if (lines.some((s) => s === 'out_of_stock')) return 'awaiting_brand';
  if (lines.some((s) => s === 'pending_check')) return 'checking';
  // No out_of_stock / pending_check left: all in {in_stock, picked, packed, shipped}
  if (lines.some((s) => s === 'packed' || s === 'shipped')) return 'packed';
  if (lines.some((s) => s === 'picked')) return 'picking';
  return 'ready_to_pick';
}

const NEXT: Record<LineStatus, LineStatus | null> = {
  pending_check: null, out_of_stock: null,
  in_stock: 'picked', picked: 'packed', packed: 'shipped', shipped: null,
};

/** Is moving a line from -> to a valid forward step? */
export function canTransitionLine(from: LineStatus, to: LineStatus): boolean {
  return NEXT[from] === to;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run features/fulfillment/logic.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/logic.ts features/fulfillment/logic.test.ts
git commit -m "feat(fulfillment): pure stock-check, rollup, transition logic"
```

---

## Task 3: RBAC permissions

**Files:**
- Modify: `lib/auth/rbac.ts`

- [ ] **Step 1: Add to the `Permission` union**

After `| 'manage_mmp_products';` change the terminator and append:

```typescript
  | 'manage_mmp_products'
  | 'view_fulfillment'
  | 'manage_fulfillment'
  | 'manage_warehouse';
```

- [ ] **Step 2: Add to MATRIX**

In `admin` array add: `'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',`
In `operator` array add: `'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',`
In `viewer` array add: `'view_fulfillment',`

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/auth/rbac.ts
git commit -m "feat(fulfillment): RBAC permissions"
```

---

## Task 4: ensureFulfillment + backfill + sync hook

**Files:**
- Create: `features/fulfillment/ensure-fulfillment.ts`
- Modify: `features/shopify-orders/sync/upsert-order.ts`

- [ ] **Step 1: Implement `ensure-fulfillment.ts`**

Create `features/fulfillment/ensure-fulfillment.ts`:

```typescript
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Idempotently create the order_fulfillment record + one line per order line.
 * Safe to call on every sync — only inserts what's missing. Does NOT touch
 * lines that already progressed. Auto-runs the initial stock check.
 */
export async function ensureFulfillmentForOrder(orderId: string): Promise<void> {
  const existing = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (existing.length > 0) return; // already created — leave as-is

  const lines = await db.select({ id: schema.shopifyOrderLines.id, sku: schema.shopifyOrderLines.sku, qty: schema.shopifyOrderLines.quantity })
    .from(schema.shopifyOrderLines)
    .where(eq(schema.shopifyOrderLines.orderId, orderId));
  if (lines.length === 0) return;

  const [ful] = await db.insert(schema.orderFulfillment)
    .values({ orderId, status: 'received' }).returning({ id: schema.orderFulfillment.id });

  await db.insert(schema.orderFulfillmentLines).values(
    lines.map((l) => ({ fulfillmentId: ful.id, orderLineId: l.id, sku: l.sku, qty: l.qty, status: 'pending_check' as const })),
  );
  // Initial stock check (defined in actions.ts) is invoked by the caller or
  // lazily on first view; see checkStockForOrder.
}

/** One-time backfill for orders that predate this feature. */
export async function backfillFulfillmentRecords(): Promise<number> {
  const orders = await db.select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderFulfillment, eq(schema.orderFulfillment.orderId, schema.shopifyOrders.id))
    .where(sql`${schema.orderFulfillment.id} is null and ${schema.shopifyOrders.cancelledAtShopify} is null`);
  for (const o of orders) await ensureFulfillmentForOrder(o.id);
  return orders.length;
}
```

- [ ] **Step 2: Hook into `upsertOrder`**

Read `features/shopify-orders/sync/upsert-order.ts`. After the order + its lines are upserted (end of the upsert, before returning), add:

```typescript
import { ensureFulfillmentForOrder } from '@/features/fulfillment/ensure-fulfillment';
// ...after lines upserted, with the resolved internal order id `orderId`:
await ensureFulfillmentForOrder(orderId);
```

Match the actual local variable name for the internal order UUID (read the function to confirm). Skip for cancelled orders if the function already early-returns on cancel.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add features/fulfillment/ensure-fulfillment.ts features/shopify-orders/sync/upsert-order.ts
git commit -m "feat(fulfillment): create ops records on order sync + backfill"
```

---

## Task 5: Server actions (stock check, transitions, warehouse)

**Files:**
- Create: `features/fulfillment/actions.ts`
- Create: `features/fulfillment/warehouse-actions.ts`

- [ ] **Step 1: Implement `actions.ts`**

Create `features/fulfillment/actions.ts`:

```typescript
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { checkStock, rollupOrderStatus, canTransitionLine, type StockInfo, type LineStatus } from './logic';

async function require(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

async function recomputeRollup(fulfillmentId: string): Promise<void> {
  const lines = await db.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await db.update(schema.orderFulfillment)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

/** Run/re-run stock check for a single order. Reserves stock for in_stock lines. */
export async function checkStockForOrder(orderId: string): Promise<void> {
  await require('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');

  const lines = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  // Only (re)check lines not yet picked.
  const checkable = lines.filter((l) => l.status === 'pending_check' || l.status === 'out_of_stock' || l.status === 'in_stock');
  const skus = [...new Set(checkable.map((l) => l.sku).filter((s): s is string => !!s))];

  await db.transaction(async (tx) => {
    const inv = skus.length
      ? await tx.select().from(schema.warehouseInventory).where(inArray(schema.warehouseInventory.sku, skus))
      : [];
    const stock = new Map<string, StockInfo>(
      inv.map((w) => [w.sku, { available: w.qtyOnHand - w.qtyReserved, warehouseInventoryId: w.id }]),
    );
    for (const l of checkable) {
      // release any prior reservation before re-evaluating
      if (l.status === 'in_stock' && l.warehouseInventoryId && l.allocatedQty > 0) {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} - ${l.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId));
        const cur = stock.get(l.sku!); if (cur) cur.available += l.allocatedQty;
      }
      const res = checkStock({ sku: l.sku, qty: l.qty }, stock);
      if (res.status === 'in_stock') {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${res.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, res.warehouseInventoryId!));
        const cur = stock.get(l.sku!); if (cur) cur.available -= res.allocatedQty;
      }
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: res.status, warehouseInventoryId: res.warehouseInventoryId, allocatedQty: res.allocatedQty, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
    }
  });
  await recomputeRollup(ful.id);
  revalidatePath('/f/fulfillment');
  revalidatePath(`/f/fulfillment/${orderId}`);
}

/** Advance one line: in_stock->picked (decrement stock) ->packed->shipped. */
export async function markLine(lineId: string, next: LineStatus): Promise<void> {
  const actor = await require('manage_fulfillment');
  const [l] = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.id, lineId)).limit(1);
  if (!l) throw new Error('Line not found');
  if (!canTransitionLine(l.status as LineStatus, next)) throw new Error(`Invalid transition ${l.status} -> ${next}`);

  await db.transaction(async (tx) => {
    if (next === 'picked' && l.warehouseInventoryId && l.allocatedQty > 0) {
      await tx.update(schema.warehouseInventory)
        .set({
          qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} - ${l.allocatedQty}`,
          qtyReserved: sql`${schema.warehouseInventory.qtyReserved} - ${l.allocatedQty}`,
        })
        .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId));
    }
    const stamp = next === 'picked' ? { pickedAt: sql`now()` } : next === 'packed' ? { packedAt: sql`now()` } : { shippedAt: sql`now()` };
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: next, updatedAt: sql`now()`, ...stamp })
      .where(eq(schema.orderFulfillmentLines.id, lineId));
    await tx.insert(schema.orderFulfillmentEvents)
      .values({ fulfillmentId: l.fulfillmentId, lineId, fromStatus: l.status, toStatus: next, actor });
  });
  await recomputeRollup(l.fulfillmentId);
  revalidatePath('/f/fulfillment');
}

/** Apply `next` to every line of an order that can legally advance to it. */
export async function markOrder(orderId: string, next: LineStatus): Promise<void> {
  await require('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');
  const lines = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  for (const l of lines) {
    if (canTransitionLine(l.status as LineStatus, next)) await markLine(l.id, next);
  }
}
```

- [ ] **Step 2: Implement `warehouse-actions.ts`**

Create `features/fulfillment/warehouse-actions.ts`:

```typescript
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

async function requireWarehouse(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_warehouse')) throw new Error('Forbidden');
  return session.user.id;
}

export interface WarehouseItemInput {
  sku: string; productTitle?: string | null; variantTitle?: string | null;
  qtyOnHand: number; shelf?: string | null; floor?: string | null; bin?: string | null; note?: string | null;
}

export async function upsertWarehouseItem(input: WarehouseItemInput): Promise<void> {
  const userId = await requireWarehouse();
  await db.insert(schema.warehouseInventory)
    .values({ ...input, sku: input.sku.trim(), updatedBy: userId })
    .onConflictDoUpdate({
      target: schema.warehouseInventory.sku,
      set: {
        productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
        qtyOnHand: input.qtyOnHand, shelf: input.shelf ?? null, floor: input.floor ?? null,
        bin: input.bin ?? null, note: input.note ?? null, updatedBy: userId, updatedAt: sql`now()`,
      },
    });
  revalidatePath('/f/fulfillment/warehouse');
}

export async function adjustStock(sku: string, delta: number): Promise<void> {
  const userId = await requireWarehouse();
  await db.update(schema.warehouseInventory)
    .set({ qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${delta}`, updatedBy: userId, updatedAt: sql`now()` })
    .where(eq(schema.warehouseInventory.sku, sku.trim()));
  revalidatePath('/f/fulfillment/warehouse');
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add features/fulfillment/actions.ts features/fulfillment/warehouse-actions.ts
git commit -m "feat(fulfillment): stock-check / transition / warehouse server actions"
```

---

## Task 6: Read queries

**Files:**
- Create: `features/fulfillment/queries.ts`

- [ ] **Step 1: Implement `queries.ts`**

Create `features/fulfillment/queries.ts` with three read helpers (no mutations). Use joins to `shopifyOrders` (order number, store), `orderFulfillmentLines`, and `warehouseInventory` (shelf/floor for in_stock lines).

```typescript
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listFulfillmentWorklist() {
  const rows = await db.select({
    orderId: schema.orderFulfillment.orderId,
    status: schema.orderFulfillment.status,
    updatedAt: schema.orderFulfillment.updatedAt,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    createdAtShopify: schema.shopifyOrders.createdAtShopify,
  })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));
  return rows;
}

export interface FulfillmentLineView {
  id: string; sku: string | null; qty: number; status: string;
  productTitle: string | null; variantTitle: string | null;
  shelf: string | null; floor: string | null; bin: string | null;
}

export async function getFulfillmentDetail(orderId: string) {
  const [ful] = await db.select().from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return null;
  const lines = await db.select({
    id: schema.orderFulfillmentLines.id, sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status,
    productTitle: schema.shopifyOrderLines.productTitle, variantTitle: schema.shopifyOrderLines.variantTitle,
    shelf: schema.warehouseInventory.shelf, floor: schema.warehouseInventory.floor, bin: schema.warehouseInventory.bin,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.id, schema.orderFulfillmentLines.orderLineId))
    .leftJoin(schema.warehouseInventory, eq(schema.warehouseInventory.id, schema.orderFulfillmentLines.warehouseInventoryId))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  return { fulfillment: ful, lines };
}

export async function listWarehouse() {
  return db.select().from(schema.warehouseInventory).orderBy(schema.warehouseInventory.sku);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add features/fulfillment/queries.ts
git commit -m "feat(fulfillment): read queries for worklist/detail/warehouse"
```

---

## Task 7: Nav item

**Files:**
- Modify: `lib/nav.ts`, `lib/nav.test.ts`

- [ ] **Step 1: Add nav item**

Add `ClipboardList` to the lucide import in `lib/nav.ts`, then after the `/f/orders` entry add:

```typescript
  { href: '/f/fulfillment', label: 'Vận hành đơn', icon: ClipboardList, requires: 'view_fulfillment' },
```

- [ ] **Step 2: Add test in `lib/nav.test.ts`**

Inside `describe('NAV structure', ...)`:

```typescript
  it('includes fulfillment gated by view_fulfillment', () => {
    const item = NAV.find((n) => n.href === '/f/fulfillment');
    expect(item).toBeDefined();
    expect(item!.requires).toBe('view_fulfillment');
  });
```

- [ ] **Step 3: Run nav tests + commit**

```bash
npx vitest run lib/nav.test.ts
git add lib/nav.ts lib/nav.test.ts
git commit -m "feat(fulfillment): nav item"
```

---

## Task 8: Warehouse management page

**Files:**
- Create: `app/(dashboard)/f/fulfillment/warehouse/page.tsx`
- Create: `components/fulfillment/WarehouseTable.tsx`

- [ ] **Step 1: Server page (auth + data)**

Create `app/(dashboard)/f/fulfillment/warehouse/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWarehouse } from '@/features/fulfillment/queries';
import { WarehouseTable } from '@/components/fulfillment/WarehouseTable';

export const dynamic = 'force-dynamic';

export default async function WarehousePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');
  const items = await listWarehouse();
  const canManage = hasPermission(role, 'manage_warehouse');
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Kho MEAN</h1>
      <WarehouseTable items={items} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: Client table with add/edit form**

Create `components/fulfillment/WarehouseTable.tsx` — a table of SKU / tên / tồn (onHand−reserved) / kệ / tầng / bin, with an inline form calling `upsertWarehouseItem` and `adjustStock`. Use `useState` for the form, `useTransition` for pending. Mirror the styling of `components/shipping-reconcile/ReconcileTable.tsx` (border-border, text-sm, font-mono tabular-nums). Guard editing controls behind `canManage`.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/f/fulfillment/warehouse/page.tsx" components/fulfillment/WarehouseTable.tsx
git commit -m "feat(fulfillment): warehouse management page"
```

---

## Task 9: Worklist + order detail pages

**Files:**
- Create: `app/(dashboard)/f/fulfillment/page.tsx`
- Create: `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`
- Create: `components/fulfillment/WorklistTable.tsx`
- Create: `components/fulfillment/OrderDetailPanel.tsx`

- [ ] **Step 1: Worklist server page**

Create `app/(dashboard)/f/fulfillment/page.tsx` (auth gate `view_fulfillment`, redirect like above), calls `listFulfillmentWorklist()`, renders `WorklistTable`.

- [ ] **Step 2: WorklistTable (client)**

Create `components/fulfillment/WorklistTable.tsx`: filter by status (select), table of order# (link to `/f/fulfillment/[orderId]`), store, ngày tạo, trạng thái (badge by status). Vietnamese status labels:
`received:'Mới nhận', checking:'Đang kiểm', awaiting_brand:'Cần đặt brand', ready_to_pick:'Chờ lấy', picking:'Đang lấy', packed:'Đã đóng gói', shipped:'Đã giao carrier'`.

- [ ] **Step 3: Order detail server page**

Create `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`: auth gate, `getFulfillmentDetail(orderId)` (404/redirect if null), render `OrderDetailPanel`. Note this fork's params API — read `node_modules/next/dist/docs/` for the `params` shape (may be a Promise) before writing.

- [ ] **Step 4: OrderDetailPanel (client)**

Create `components/fulfillment/OrderDetailPanel.tsx`: per-line table — SKU, tên, qty, trạng thái; if `status==='in_stock'|'picked'|'packed'|'shipped'` show **Kệ {shelf} · Tầng {floor}{bin?}**; if `out_of_stock` show badge "Cần đặt brand" (đỏ). Action buttons per line by current status: in_stock→"Đã lấy" (markLine picked), picked→"Đóng gói" (packed), packed→"Giao carrier" (shipped). Header buttons: "Check lại tồn" (`checkStockForOrder`), "Lấy cả đơn"/"Đóng gói cả đơn"/"Giao cả đơn" (`markOrder`). Use `useTransition`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/f/fulfillment/page.tsx" "app/(dashboard)/f/fulfillment/[orderId]/page.tsx" components/fulfillment/WorklistTable.tsx components/fulfillment/OrderDetailPanel.tsx
git commit -m "feat(fulfillment): worklist + order detail pages"
```

---

## Task 10: Backfill trigger + full verification

**Files:**
- Modify: warehouse page (add a one-time backfill button, admin) OR a small script.

- [ ] **Step 1: Expose backfill**

Add a server action wrapper `runBackfillFulfillment()` in `features/fulfillment/actions.ts` that calls `require('manage_fulfillment')` then `backfillFulfillmentRecords()`, and a button on the worklist page (operator+). Alternatively run once via tsx:
`DATABASE_URL="postgres://macos@localhost:5432/staging" npx tsx -r tsconfig-paths/register -e "import('@/features/fulfillment/ensure-fulfillment').then(m=>m.backfillFulfillmentRecords()).then(n=>{console.log('backfilled',n);process.exit(0)})"`

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` (expect 0) and `npm run lint` (expect 0 errors; escape Vietnamese quotes for `react/no-unescaped-entities`).

- [ ] **Step 3: Tests**

Run: `npx vitest run features/fulfillment lib/nav.test.ts`
Expected: all PASS.

- [ ] **Step 4: Manual smoke (staging + dev server)**

`DATABASE_URL="postgres://macos@localhost:5432/staging" npx next dev`. Add a warehouse SKU matching a real order line; load `/f/fulfillment`, open an order; confirm in-stock lines show kệ/tầng and out-of-stock show "Cần đặt brand"; mark a line picked → warehouse onHand decrements; rollup status updates.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore(fulfillment): backfill trigger + verification" || echo "nothing to commit"
```
