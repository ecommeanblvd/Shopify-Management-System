# Customer Returns Intake + QC (Sub-project F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal customer-returns intake module: record returned goods against a Shopify order, QC per-line (pass/fail quantities), restock passed units into warehouse inventory, and display Shopify's refund status with a reconciliation flag — without ever pushing refunds to Shopify.

**Architecture:** Dedicated tables `customerReturns` + `customerReturnLines` (Approach A). Pure logic in `features/returns/logic.ts` (unit-tested), DB reads in `queries.ts`, server actions in `actions.ts`. QC pass increments `warehouseInventory.qtyOnHand` via the same upsert pattern as Phase A receiving. Refund status is read-only from the already-synced `shopifyOrderRefunds` table. New top-level route `/f/returns` (mirrors C1 transfers) and new permission `warehouse.returns`.

**Tech Stack:** Next.js (app router, server actions), Drizzle ORM (PostgreSQL), Better Auth + RBAC compat shim, Vitest for pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-06-10-order-ops-phaseF2-customer-returns-intake-design.md`

---

## File Structure

- `db/schema.ts` — MODIFY: add `customerReturnStatusEnum`, `customerReturns`, `customerReturnLines` (append after the C1 transfers block).
- `db/migrations/00XX_*.sql` — CREATE (generated): enum + 2 tables.
- `features/returns/logic.ts` — CREATE: pure functions (code, validation, restock delta, refund flag).
- `features/returns/logic.test.ts` — CREATE: vitest unit tests for the pure logic.
- `features/returns/queries.ts` — CREATE: `listReturns`, `getReturnWithLines`, `searchOrdersForReturn`, `getOrderLinesForReturn`.
- `features/returns/actions.ts` — CREATE: `createReturn`, `submitReturnQc`, `cancelReturn`.
- `lib/auth/permissions.ts` — MODIFY: add `warehouse.returns` catalog entry.
- `lib/auth/rbac.ts` — MODIFY: add `view_returns`/`manage_returns` to the `Permission` union.
- `lib/auth/permission-map.ts` — MODIFY: add `OLD_TO_NEW` entries + add to `OPERATOR_OLD`.
- `lib/nav.ts` — MODIFY: add `/f/returns` nav entry.
- `app/(dashboard)/f/returns/page.tsx` — CREATE: list + create flow (server component).
- `app/(dashboard)/f/returns/[id]/page.tsx` — CREATE: QC detail (server component).
- `components/returns/ReturnsPanel.tsx` — CREATE: list table + create form (client).
- `components/returns/ReturnQcPanel.tsx` — CREATE: per-line QC form + refund panel (client).

---

## Task 1: Schema + migration

**Files:**
- Modify: `db/schema.ts` (append after `inventoryTransferLines` block, end of the C1 section)
- Generate: `db/migrations/*.sql`

- [ ] **Step 1: Add the enum and tables to `db/schema.ts`**

Append this block at the end of `db/schema.ts` (after the `inventoryTransferLines` table). All helpers used (`pgEnum`, `pgTable`, `uuid`, `text`, `integer`, `timestamp`, `index`, `check`, `sql`) are already imported and used elsewhere in this file.

```ts
// ─────────────────────────────────────────────────────────────────────
// Customer Returns Intake + QC (sub-project F2)
// ─────────────────────────────────────────────────────────────────────

export const customerReturnStatusEnum = pgEnum('customer_return_status', ['open', 'completed', 'cancelled']);

/** One intake record per physical return delivery, tied to a Shopify order. */
export const customerReturns = pgTable('customer_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  warehouseCode: text('warehouse_code').notNull().default('HN'),
  status: customerReturnStatusEnum('status').notNull().default('open'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  receivedBy: text('received_by').references(() => user.id, { onDelete: 'set null' }),
  qcDoneAt: timestamp('qc_done_at'),
  qcDoneBy: text('qc_done_by').references(() => user.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('customer_returns_order_idx').on(t.orderId),
  index('customer_returns_status_idx').on(t.status),
]);

/** Per order-line return + QC outcome. passQty restocks; failQty does not. */
export const customerReturnLines = pgTable('customer_return_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  returnId: uuid('return_id').references(() => customerReturns.id, { onDelete: 'cascade' }).notNull(),
  shopifyLineId: text('shopify_line_id').notNull(),
  sku: text('sku'),
  productTitle: text('product_title'),
  variantTitle: text('variant_title'),
  returnedQty: integer('returned_qty').notNull(),
  passQty: integer('pass_qty').notNull().default(0),
  failQty: integer('fail_qty').notNull().default(0),
  failReason: text('fail_reason'),
  restockedQty: integer('restocked_qty').notNull().default(0),
  warehouseInventoryId: uuid('warehouse_inventory_id').references(() => warehouseInventory.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('customer_return_lines_return_idx').on(t.returnId),
  check('customer_return_lines_returned_qty_pos', sql`${t.returnedQty} > 0`),
  check('customer_return_lines_pass_qty_nonneg', sql`${t.passQty} >= 0`),
  check('customer_return_lines_fail_qty_nonneg', sql`${t.failQty} >= 0`),
]);
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: drizzle-kit writes a new `db/migrations/00XX_*.sql` containing `CREATE TYPE "public"."customer_return_status"`, `CREATE TABLE "customer_returns"`, `CREATE TABLE "customer_return_lines"`, the two FKs to `user`, the FK to `shopify_orders` (cascade), the FK to `warehouse_inventory`, the two indexes, and the three CHECK constraints.

- [ ] **Step 3: Inspect the generated SQL**

Run: `ls -t db/migrations/*.sql | head -1 | xargs cat`
Expected: confirm the enum + both tables + FKs + checks are present and reference the correct columns. Do NOT hand-edit unless a FK/check is missing.

- [ ] **Step 4: Apply the migration (requires DATABASE_URL)**

Run: `npm run db:migrate`
Expected: migration applies with no error. If `DATABASE_URL` is not set in this environment, skip the apply and note it — the generated SQL is the deliverable for this task.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(returns): customer_returns + customer_return_lines schema (F2)"
```

---

## Task 2: Pure logic + tests (TDD)

**Files:**
- Create: `features/returns/logic.ts`
- Test: `features/returns/logic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `features/returns/logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nextReturnCode,
  validateReturnDraft,
  validateReturnQc,
  restockEffect,
  refundReconcileFlag,
} from './logic';

describe('nextReturnCode', () => {
  it('formats per-order code', () => {
    expect(nextReturnCode('1042', 1)).toBe('CR-1042-1');
    expect(nextReturnCode('1042', 3)).toBe('CR-1042-3');
  });
});

describe('validateReturnDraft', () => {
  const ok = { orderId: 'o1', lines: [{ shopifyLineId: 'l1', returnedQty: 2 }] };
  it('accepts valid input', () => {
    expect(validateReturnDraft(ok).ok).toBe(true);
  });
  it('rejects missing order', () => {
    expect(validateReturnDraft({ ...ok, orderId: '' }).ok).toBe(false);
  });
  it('rejects empty lines', () => {
    expect(validateReturnDraft({ ...ok, lines: [] }).ok).toBe(false);
  });
  it('rejects non-positive qty', () => {
    expect(validateReturnDraft({ ...ok, lines: [{ shopifyLineId: 'l1', returnedQty: 0 }] }).ok).toBe(false);
  });
  it('rejects duplicate line ids', () => {
    expect(validateReturnDraft({ orderId: 'o1', lines: [
      { shopifyLineId: 'l1', returnedQty: 1 },
      { shopifyLineId: 'l1', returnedQty: 1 },
    ] }).ok).toBe(false);
  });
});

describe('validateReturnQc', () => {
  it('accepts pass+fail equal to returned', () => {
    expect(validateReturnQc([{ returnedQty: 3, passQty: 2, failQty: 1 }]).ok).toBe(true);
  });
  it('accepts pass+fail below returned (uninspected remainder)', () => {
    expect(validateReturnQc([{ returnedQty: 3, passQty: 1, failQty: 0 }]).ok).toBe(true);
  });
  it('rejects pass+fail above returned', () => {
    expect(validateReturnQc([{ returnedQty: 2, passQty: 2, failQty: 1 }]).ok).toBe(false);
  });
  it('rejects negative quantities', () => {
    expect(validateReturnQc([{ returnedQty: 2, passQty: -1, failQty: 0 }]).ok).toBe(false);
  });
  it('rejects empty input', () => {
    expect(validateReturnQc([]).ok).toBe(false);
  });
});

describe('restockEffect', () => {
  it('restocks passQty when there is a sku', () => {
    expect(restockEffect({ sku: 'ABC', passQty: 2 })).toEqual({ onHandDelta: 2 });
  });
  it('does not restock without a sku', () => {
    expect(restockEffect({ sku: null, passQty: 2 })).toEqual({ onHandDelta: 0 });
  });
});

describe('refundReconcileFlag', () => {
  it('refunded when shopify has a refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 2, shopifyRefundCount: 1 })).toBe('refunded');
  });
  it('awaiting_refund when goods passed but no refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 2, shopifyRefundCount: 0 })).toBe('awaiting_refund');
  });
  it('none when nothing passed and no refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 0, shopifyRefundCount: 0 })).toBe('none');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run features/returns/logic.test.ts`
Expected: FAIL — cannot resolve `./logic` / functions not defined.

- [ ] **Step 3: Implement the pure logic**

Create `features/returns/logic.ts`:

```ts
/** Pure customer-returns logic — no DB. Code format, draft + QC validation,
 *  restock delta, and refund reconciliation flag. */

export type CustomerReturnStatus = 'open' | 'completed' | 'cancelled';

/** Human code per order, e.g. nextReturnCode('1042', 1) => 'CR-1042-1'. */
export function nextReturnCode(orderNumber: string, seq: number): string {
  return `CR-${orderNumber}-${seq}`;
}

export interface ReturnDraftLineInput { shopifyLineId: string; returnedQty: number; }
export interface ValidateReturnDraftInput { orderId: string; lines: ReturnDraftLineInput[]; }

export function validateReturnDraft(input: ValidateReturnDraftInput): { ok: true } | { ok: false; error: string } {
  if (!input.orderId) return { ok: false, error: 'Thiếu đơn hàng' };
  if (input.lines.length === 0) return { ok: false, error: 'Cần ít nhất một dòng hàng' };
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!l.shopifyLineId) return { ok: false, error: 'Thiếu dòng đơn hàng' };
    if (seen.has(l.shopifyLineId)) return { ok: false, error: 'Dòng đơn hàng bị trùng' };
    seen.add(l.shopifyLineId);
    if (!(l.returnedQty > 0)) return { ok: false, error: 'Số lượng trả phải lớn hơn 0' };
  }
  return { ok: true };
}

export interface QcLineInput { returnedQty: number; passQty: number; failQty: number; }

export function validateReturnQc(lines: QcLineInput[]): { ok: true } | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: 'Không có dòng để QC' };
  for (const l of lines) {
    if (l.passQty < 0 || l.failQty < 0) return { ok: false, error: 'Số lượng QC không được âm' };
    if (l.passQty + l.failQty > l.returnedQty) return { ok: false, error: 'Pass + fail vượt số lượng trả' };
  }
  return { ok: true };
}

/** On-hand restock delta for a QC'd line. Stock only moves when there's a SKU. */
export function restockEffect(line: { sku: string | null; passQty: number }): { onHandDelta: number } {
  return { onHandDelta: line.sku ? line.passQty : 0 };
}

export type RefundReconcileFlag = 'refunded' | 'awaiting_refund' | 'none';

/** Compare internal QC-passed goods against Shopify's refund record. */
export function refundReconcileFlag(input: { totalPassQty: number; shopifyRefundCount: number }): RefundReconcileFlag {
  if (input.shopifyRefundCount > 0) return 'refunded';
  if (input.totalPassQty > 0) return 'awaiting_refund';
  return 'none';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run features/returns/logic.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add features/returns/logic.ts features/returns/logic.test.ts
git commit -m "feat(returns): pure code/validation/restock/reconcile logic with tests (F2)"
```

---

## Task 3: Permission + nav wiring

**Files:**
- Modify: `lib/auth/permissions.ts`
- Modify: `lib/auth/rbac.ts`
- Modify: `lib/auth/permission-map.ts`
- Modify: `lib/nav.ts`

- [ ] **Step 1: Add the catalog entry in `lib/auth/permissions.ts`**

Find the line:

```ts
  { key: 'warehouse.transfers', label: 'Kho — Chuyển kho', actions: ['view', 'create', 'edit'] },
```

Add directly after it:

```ts
  { key: 'warehouse.returns', label: 'Kho — Hàng hoàn', actions: ['view', 'create', 'edit'] },
```

- [ ] **Step 2: Extend the `Permission` union in `lib/auth/rbac.ts`**

Find:

```ts
  | 'view_transfers'
  | 'manage_transfers';
```

Replace with:

```ts
  | 'view_transfers'
  | 'manage_transfers'
  | 'view_returns'
  | 'manage_returns';
```

- [ ] **Step 3: Add the legacy→new mapping in `lib/auth/permission-map.ts`**

Find:

```ts
  view_transfers: ['warehouse.transfers:view'],
  manage_transfers: ['warehouse.transfers:view', 'warehouse.transfers:create', 'warehouse.transfers:edit'],
};
```

Replace with:

```ts
  view_transfers: ['warehouse.transfers:view'],
  manage_transfers: ['warehouse.transfers:view', 'warehouse.transfers:create', 'warehouse.transfers:edit'],
  view_returns: ['warehouse.returns:view'],
  manage_returns: ['warehouse.returns:view', 'warehouse.returns:create', 'warehouse.returns:edit'],
};
```

- [ ] **Step 4: Grant the new permission to the operator role in `lib/auth/permission-map.ts`**

Find inside `OPERATOR_OLD`:

```ts
  'view_transfers', 'manage_transfers',
];
```

Replace with:

```ts
  'view_transfers', 'manage_transfers',
  'view_returns', 'manage_returns',
];
```

(Admin already gets every key via `allPermissionKeys()` in `SYSTEM_ROLE_SEEDS`; viewer intentionally does not get returns.)

- [ ] **Step 5: Add the nav entry in `lib/nav.ts`**

First add `Undo2` to the lucide import at the top of the file (append it to the existing destructured import from `lucide-react`). Then find:

```ts
  { href: '/f/transfers', label: 'Chuyển kho', icon: ArrowLeftRight, requires: 'view_transfers' },
```

Add directly after it:

```ts
  { href: '/f/returns', label: 'Hàng hoàn', icon: Undo2, requires: 'view_returns' },
```

- [ ] **Step 6: Run the permission/nav tests**

Run: `npx vitest run lib/auth/permission-map.test.ts lib/auth/rbac.test.ts lib/nav.test.ts`
Expected: PASS. If a test asserts an exact catalog/permission count or snapshots the nav list, update that expected number/snapshot to include the new `warehouse.returns` keys and the `/f/returns` nav item, then re-run until green.

- [ ] **Step 7: Re-seed roles so the DB picks up the new permission (requires DATABASE_URL)**

Run: `npx tsx scripts/seed-roles.ts`
Expected: roles re-seeded; operator now holds `warehouse.returns:*`. If `DATABASE_URL` is unset here, note that this must be run in the target environment before operators can use the page.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/rbac.ts lib/auth/permission-map.ts lib/nav.ts
git commit -m "feat(returns): warehouse.returns permission + nav (F2)"
```

---

## Task 4: Queries

**Files:**
- Create: `features/returns/queries.ts`

- [ ] **Step 1: Write the queries file**

Create `features/returns/queries.ts`:

```ts
import { eq, desc, and, ne, ilike, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refundReconcileFlag, type RefundReconcileFlag } from './logic';

export interface ReturnListRow {
  id: string;
  code: string;
  status: string;
  orderId: string;
  orderNumber: string;
  receivedAt: Date;
  totalPassQty: number;
  refundCount: number;
  refundTotal: string;
  refundFlag: RefundReconcileFlag;
}

/** Returns newest first, with order number, restocked total, and refund badge. */
export async function listReturns(): Promise<ReturnListRow[]> {
  const rows = await db.select({
    id: schema.customerReturns.id,
    code: schema.customerReturns.code,
    status: schema.customerReturns.status,
    orderId: schema.customerReturns.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    receivedAt: schema.customerReturns.receivedAt,
  })
    .from(schema.customerReturns)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.customerReturns.orderId))
    .orderBy(desc(schema.customerReturns.createdAt));

  if (rows.length === 0) return [];
  const returnIds = rows.map((r) => r.id);
  const orderIds = [...new Set(rows.map((r) => r.orderId))];

  const lines = await db.select({
    returnId: schema.customerReturnLines.returnId,
    passQty: schema.customerReturnLines.passQty,
  }).from(schema.customerReturnLines).where(inArray(schema.customerReturnLines.returnId, returnIds));

  const refunds = await db.select({
    orderId: schema.shopifyOrderRefunds.orderId,
    amount: schema.shopifyOrderRefunds.amount,
  }).from(schema.shopifyOrderRefunds).where(inArray(schema.shopifyOrderRefunds.orderId, orderIds));

  return rows.map((r) => {
    const totalPassQty = lines.filter((l) => l.returnId === r.id).reduce((s, l) => s + l.passQty, 0);
    const orderRefunds = refunds.filter((x) => x.orderId === r.orderId);
    const refundCount = orderRefunds.length;
    const refundTotal = orderRefunds.reduce((s, x) => s + Number(x.amount), 0).toFixed(2);
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      receivedAt: r.receivedAt as Date,
      totalPassQty,
      refundCount,
      refundTotal,
      refundFlag: refundReconcileFlag({ totalPassQty, shopifyRefundCount: refundCount }),
    };
  });
}

/** Full return detail: header, lines, and the order's Shopify refunds. */
export async function getReturnWithLines(id: string) {
  const [ret] = await db.select({
    id: schema.customerReturns.id,
    code: schema.customerReturns.code,
    status: schema.customerReturns.status,
    orderId: schema.customerReturns.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    warehouseCode: schema.customerReturns.warehouseCode,
    receivedAt: schema.customerReturns.receivedAt,
    qcDoneAt: schema.customerReturns.qcDoneAt,
    note: schema.customerReturns.note,
  })
    .from(schema.customerReturns)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.customerReturns.orderId))
    .where(eq(schema.customerReturns.id, id))
    .limit(1);
  if (!ret) return null;

  const lines = await db.select()
    .from(schema.customerReturnLines)
    .where(eq(schema.customerReturnLines.returnId, id))
    .orderBy(schema.customerReturnLines.createdAt);

  const refunds = await db.select({
    amount: schema.shopifyOrderRefunds.amount,
    refundedAt: schema.shopifyOrderRefunds.refundedAt,
    reason: schema.shopifyOrderRefunds.reason,
  }).from(schema.shopifyOrderRefunds).where(eq(schema.shopifyOrderRefunds.orderId, ret.orderId));

  const totalPassQty = lines.reduce((s, l) => s + l.passQty, 0);
  return {
    ...ret,
    lines,
    refunds,
    refundFlag: refundReconcileFlag({ totalPassQty, shopifyRefundCount: refunds.length }),
  };
}

export interface OrderSearchRow {
  id: string;
  orderNumber: string;
  financialStatus: string;
  processedAt: Date;
}

/** Order picker for creating a return — match by order number. */
export async function searchOrdersForReturn(q: string): Promise<OrderSearchRow[]> {
  const term = `%${q.trim()}%`;
  const rows = await db.select({
    id: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    financialStatus: schema.shopifyOrders.financialStatus,
    processedAt: schema.shopifyOrders.processedAtShopify,
  })
    .from(schema.shopifyOrders)
    .where(ilike(schema.shopifyOrders.shopifyOrderNumber, term))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(20);
  return rows.map((r) => ({ ...r, processedAt: r.processedAt as Date }));
}

export interface OrderLineForReturn {
  shopifyLineId: string;
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  alreadyReturned: number;
  returnableQty: number;
}

/** Order lines + how many units are already on non-cancelled returns (over-return guard). */
export async function getOrderLinesForReturn(orderId: string): Promise<OrderLineForReturn[]> {
  const lines = await db.select({
    shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
    sku: schema.shopifyOrderLines.sku,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    quantity: schema.shopifyOrderLines.quantity,
  }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));

  const prior = await db.select({
    shopifyLineId: schema.customerReturnLines.shopifyLineId,
    returnedQty: schema.customerReturnLines.returnedQty,
  })
    .from(schema.customerReturnLines)
    .innerJoin(schema.customerReturns, eq(schema.customerReturns.id, schema.customerReturnLines.returnId))
    .where(and(eq(schema.customerReturns.orderId, orderId), ne(schema.customerReturns.status, 'cancelled')));

  return lines.map((l) => {
    const already = prior
      .filter((p) => p.shopifyLineId === l.shopifyLineId)
      .reduce((s, p) => s + p.returnedQty, 0);
    return { ...l, alreadyReturned: already, returnableQty: l.quantity - already };
  });
}
```

- [ ] **Step 2: Typecheck the queries file**

Run: `npx tsc --noEmit`
Expected: no errors referencing `features/returns/queries.ts`. (Pre-existing unrelated errors elsewhere, if any, are out of scope — but there should be none introduced by this file.)

- [ ] **Step 3: Commit**

```bash
git add features/returns/queries.ts
git commit -m "feat(returns): list/detail/picker queries with refund reconcile (F2)"
```

---

## Task 5: Server actions

**Files:**
- Create: `features/returns/actions.ts`

- [ ] **Step 1: Write the actions file**

Create `features/returns/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { nextReturnCode, validateReturnDraft, validateReturnQc, restockEffect } from './logic';

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreateReturnInput {
  orderId: string;
  note?: string | null;
  lines: { shopifyLineId: string; returnedQty: number }[];
}

/** Create an 'open' return record for an order, snapshotting line sku/titles. */
export async function createReturn(input: CreateReturnInput): Promise<string> {
  const userId = await requirePerm('manage_returns');
  const v = validateReturnDraft(input);
  if (!v.ok) throw new Error(v.error);

  const id = await db.transaction(async (tx) => {
    const [order] = await tx.select({
      id: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    }).from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, input.orderId)).limit(1);
    if (!order) throw new Error('Đơn hàng không tồn tại');

    // per-order sequence = number of existing returns (any status) + 1
    const existing = await tx.select({ id: schema.customerReturns.id })
      .from(schema.customerReturns).where(eq(schema.customerReturns.orderId, input.orderId));
    const code = nextReturnCode(order.orderNumber, existing.length + 1);

    const orderLines = await tx.select({
      shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
      sku: schema.shopifyOrderLines.sku,
      productTitle: schema.shopifyOrderLines.productTitle,
      variantTitle: schema.shopifyOrderLines.variantTitle,
    }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, input.orderId));

    const [ret] = await tx.insert(schema.customerReturns).values({
      code, orderId: input.orderId, note: input.note ?? null, receivedBy: userId,
    }).returning({ id: schema.customerReturns.id });

    await tx.insert(schema.customerReturnLines).values(input.lines.map((l) => {
      const ol = orderLines.find((o) => o.shopifyLineId === l.shopifyLineId);
      return {
        returnId: ret.id,
        shopifyLineId: l.shopifyLineId,
        sku: ol?.sku ?? null,
        productTitle: ol?.productTitle ?? null,
        variantTitle: ol?.variantTitle ?? null,
        returnedQty: l.returnedQty,
      };
    }));
    return ret.id;
  });

  try { await recordAudit({ userId, action: 'return_create', target: id, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
  return id;
}

export interface SubmitReturnQcInput {
  returnId: string;
  lines: { lineId: string; passQty: number; failQty: number; failReason?: string | null }[];
}

/** Record QC outcomes, restock passed units to warehouse inventory, mark completed. */
export async function submitReturnQc(input: SubmitReturnQcInput): Promise<void> {
  const userId = await requirePerm('manage_returns');

  await db.transaction(async (tx) => {
    const [ret] = await tx.select().from(schema.customerReturns)
      .where(eq(schema.customerReturns.id, input.returnId)).limit(1);
    if (!ret) throw new Error('Phiếu không tồn tại');
    if (ret.status !== 'open') throw new Error('Phiếu đã QC hoặc đã huỷ');

    const lines = await tx.select().from(schema.customerReturnLines)
      .where(eq(schema.customerReturnLines.returnId, input.returnId));

    const merged = input.lines.map((qc) => {
      const line = lines.find((l) => l.id === qc.lineId);
      if (!line) throw new Error('Dòng QC không thuộc phiếu');
      return { line, qc };
    });

    const v = validateReturnQc(merged.map((m) => ({
      returnedQty: m.line.returnedQty, passQty: m.qc.passQty, failQty: m.qc.failQty,
    })));
    if (!v.ok) throw new Error(v.error);

    for (const { line, qc } of merged) {
      const eff = restockEffect({ sku: line.sku, passQty: qc.passQty });
      let inventoryRowId: string | null = line.warehouseInventoryId;
      if (line.sku && eff.onHandDelta > 0) {
        const [inv] = await tx.insert(schema.warehouseInventory)
          .values({
            sku: line.sku, productTitle: line.productTitle, variantTitle: line.variantTitle,
            qtyOnHand: eff.onHandDelta, updatedBy: userId,
          })
          .onConflictDoUpdate({
            target: schema.warehouseInventory.sku,
            set: {
              qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${eff.onHandDelta}`,
              updatedBy: userId, updatedAt: sql`now()`,
            },
          })
          .returning({ id: schema.warehouseInventory.id });
        inventoryRowId = inv.id;
      }
      await tx.update(schema.customerReturnLines).set({
        passQty: qc.passQty, failQty: qc.failQty, failReason: qc.failReason ?? null,
        restockedQty: eff.onHandDelta, warehouseInventoryId: inventoryRowId, updatedAt: sql`now()`,
      }).where(eq(schema.customerReturnLines.id, line.id));
    }

    await tx.update(schema.customerReturns).set({
      status: 'completed', qcDoneAt: sql`now()`, qcDoneBy: userId, updatedAt: sql`now()`,
    }).where(eq(schema.customerReturns.id, input.returnId));
  });

  try { await recordAudit({ userId, action: 'return_qc', target: input.returnId, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
  revalidatePath(`/f/returns/${input.returnId}`);
}

/** Cancel an 'open' return. Completed returns cannot be cancelled (stock applied). */
export async function cancelReturn(returnId: string): Promise<void> {
  const userId = await requirePerm('manage_returns');
  await db.transaction(async (tx) => {
    const [ret] = await tx.select().from(schema.customerReturns)
      .where(eq(schema.customerReturns.id, returnId)).limit(1);
    if (!ret) throw new Error('Phiếu không tồn tại');
    if (ret.status !== 'open') throw new Error('Chỉ huỷ được phiếu đang mở');
    await tx.update(schema.customerReturns).set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(eq(schema.customerReturns.id, returnId));
  });
  try { await recordAudit({ userId, action: 'return_cancel', target: returnId, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `features/returns/actions.ts`. Confirm `recordAudit`, `auth`, `getRole`, `hasPermission` import paths resolve (they match `features/transfers/actions.ts`).

- [ ] **Step 3: Commit**

```bash
git add features/returns/actions.ts
git commit -m "feat(returns): createReturn + submitReturnQc (restock) + cancelReturn (F2)"
```

---

## Task 6: UI — list/create page + QC detail page

**Files:**
- Create: `app/(dashboard)/f/returns/page.tsx`
- Create: `app/(dashboard)/f/returns/[id]/page.tsx`
- Create: `components/returns/ReturnsPanel.tsx`
- Create: `components/returns/ReturnQcPanel.tsx`

- [ ] **Step 1: Create the list page server component**

Create `app/(dashboard)/f/returns/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listReturns } from '@/features/returns/queries';
import { searchOrdersForReturn, getOrderLinesForReturn } from '@/features/returns/queries';
import { ReturnsPanel } from '@/components/returns/ReturnsPanel';

export const dynamic = 'force-dynamic';

export default async function ReturnsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_returns')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Hàng hoàn.</div>;
  }
  const returns = await listReturns();
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Undo2 className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Hàng hoàn</h1>
        <p className="text-sm text-muted-foreground">Ghi nhận hàng khách trả về + QC. Trạng thái refund đồng bộ từ Shopify.</p>
      </header>
      <ReturnsPanel
        returns={returns.map((r) => ({
          id: r.id, code: r.code, status: r.status, orderNumber: r.orderNumber,
          receivedAt: r.receivedAt as Date, totalPassQty: r.totalPassQty,
          refundCount: r.refundCount, refundTotal: r.refundTotal, refundFlag: r.refundFlag,
        }))}
        canManage={hasPermission(role, 'manage_returns')}
        searchOrders={async (q: string) => { 'use server'; return searchOrdersForReturn(q); }}
        loadOrderLines={async (orderId: string) => { 'use server'; return getOrderLinesForReturn(orderId); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the list + create-flow client component**

Create `components/returns/ReturnsPanel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createReturn } from '@/features/returns/actions';

type ReturnRow = {
  id: string; code: string; status: string; orderNumber: string;
  receivedAt: Date; totalPassQty: number;
  refundCount: number; refundTotal: string; refundFlag: 'refunded' | 'awaiting_refund' | 'none';
};
type OrderHit = { id: string; orderNumber: string; financialStatus: string };
type OrderLine = {
  shopifyLineId: string; sku: string | null; productTitle: string; variantTitle: string | null;
  quantity: number; alreadyReturned: number; returnableQty: number;
};

interface Props {
  returns: ReturnRow[];
  canManage: boolean;
  searchOrders: (q: string) => Promise<OrderHit[]>;
  loadOrderLines: (orderId: string) => Promise<OrderLine[]>;
}

const STATUS_LABEL: Record<string, string> = { open: 'Đang mở', completed: 'Đã QC', cancelled: 'Đã huỷ' };
const FLAG_LABEL: Record<string, string> = { refunded: 'Đã refund', awaiting_refund: 'Chờ refund', none: '—' };
const FLAG_CLASS: Record<string, string> = {
  refunded: 'text-emerald-600',
  awaiting_refund: 'text-amber-600 font-medium',
  none: 'text-muted-foreground',
};

export function ReturnsPanel({ returns, canManage, searchOrders, loadOrderLines }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({}); // shopifyLineId -> qty string
  const [note, setNote] = useState('');

  const doSearch = () => startTransition(async () => { setHits(await searchOrders(query)); });
  const pickOrder = (o: OrderHit) => startTransition(async () => {
    setOrder(o); setHits([]); setPicked({});
    setLines(await loadOrderLines(o.id));
  });
  const handleCreate = () => startTransition(async () => {
    if (!order) return;
    const payloadLines = Object.entries(picked)
      .map(([shopifyLineId, qty]) => ({ shopifyLineId, returnedQty: Number(qty) }))
      .filter((l) => l.returnedQty > 0);
    if (payloadLines.length === 0) return;
    const id = await createReturn({ orderId: order.id, note: note || null, lines: payloadLines });
    setOrder(null); setLines([]); setPicked({}); setNote(''); setQuery('');
    router.push(`/f/returns/${id}`);
  });

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Tạo phiếu hoàn</h2>
          {!order ? (
            <>
              <div className="flex items-center gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm số đơn Shopify…"
                  className="flex-1 border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
                <button onClick={doSearch} disabled={isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-sm">Tìm</button>
              </div>
              {hits.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {hits.map((o) => (
                    <li key={o.id}>
                      <button onClick={() => pickOrder(o)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50">
                        #{o.orderNumber} · {o.financialStatus}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Đơn #{order.orderNumber}</span>
                <button onClick={() => { setOrder(null); setLines([]); setPicked({}); }}
                  className="text-xs text-muted-foreground underline">Chọn đơn khác</button>
              </div>
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.shopifyLineId} className="flex items-center gap-3 text-sm">
                    <div className="flex-1">
                      <div>{l.productTitle}{l.variantTitle ? ` · ${l.variantTitle}` : ''}</div>
                      <div className="text-xs text-muted-foreground">
                        SKU {l.sku ?? '—'} · đặt {l.quantity} · đã hoàn {l.alreadyReturned} · còn {l.returnableQty}
                      </div>
                    </div>
                    <input
                      type="number" min={0} max={l.returnableQty}
                      value={picked[l.shopifyLineId] ?? ''}
                      onChange={(e) => setPicked((p) => ({ ...p, [l.shopifyLineId]: e.target.value }))}
                      placeholder="0"
                      className="w-20 border border-input bg-input/30 rounded-md px-2 py-1 text-sm"
                      disabled={l.returnableQty <= 0}
                    />
                  </div>
                ))}
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú"
                className="w-full border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
              <button onClick={handleCreate} disabled={isPending}
                className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
                Tạo phiếu
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Mã</th>
              <th className="text-left px-3 py-2">Đơn</th>
              <th className="text-left px-3 py-2">Ngày nhận</th>
              <th className="text-left px-3 py-2">Trạng thái</th>
              <th className="text-right px-3 py-2">Restock</th>
              <th className="text-left px-3 py-2">Refund</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {returns.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Chưa có phiếu hoàn.</td></tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/f/returns/${r.id}`} className="font-medium underline">{r.code}</Link>
                </td>
                <td className="px-3 py-2">#{r.orderNumber}</td>
                <td className="px-3 py-2">{new Date(r.receivedAt).toLocaleDateString('vi-VN')}</td>
                <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-3 py-2 text-right">{r.totalPassQty}</td>
                <td className={`px-3 py-2 ${FLAG_CLASS[r.refundFlag]}`}>
                  {FLAG_LABEL[r.refundFlag]}{r.refundCount > 0 ? ` · ${r.refundTotal}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the QC detail page server component**

Create `app/(dashboard)/f/returns/[id]/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getReturnWithLines } from '@/features/returns/queries';
import { ReturnQcPanel } from '@/components/returns/ReturnQcPanel';

export const dynamic = 'force-dynamic';

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_returns')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Hàng hoàn.</div>;
  }
  const ret = await getReturnWithLines(id);
  if (!ret) notFound();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Hàng hoàn · Đơn #{ret.orderNumber}</div>
        <h1 className="text-3xl font-semibold tracking-tight">{ret.code}</h1>
      </header>
      <ReturnQcPanel
        returnId={ret.id}
        status={ret.status}
        refundFlag={ret.refundFlag}
        refunds={ret.refunds.map((r) => ({ amount: r.amount, refundedAt: r.refundedAt as Date, reason: r.reason }))}
        lines={ret.lines.map((l) => ({
          id: l.id, shopifyLineId: l.shopifyLineId, sku: l.sku, productTitle: l.productTitle,
          variantTitle: l.variantTitle, returnedQty: l.returnedQty, passQty: l.passQty,
          failQty: l.failQty, failReason: l.failReason, restockedQty: l.restockedQty,
        }))}
        canManage={hasPermission(role, 'manage_returns')}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create the QC client component**

Create `components/returns/ReturnQcPanel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitReturnQc, cancelReturn } from '@/features/returns/actions';

type Line = {
  id: string; shopifyLineId: string; sku: string | null; productTitle: string;
  variantTitle: string | null; returnedQty: number; passQty: number; failQty: number;
  failReason: string | null; restockedQty: number;
};
type Refund = { amount: string; refundedAt: Date; reason: string | null };

interface Props {
  returnId: string;
  status: string;
  refundFlag: 'refunded' | 'awaiting_refund' | 'none';
  refunds: Refund[];
  lines: Line[];
  canManage: boolean;
}

const FLAG_LABEL: Record<string, string> = { refunded: 'Đã refund trên Shopify', awaiting_refund: 'Đã nhận + QC pass nhưng Shopify chưa refund', none: 'Chưa có refund' };
const FLAG_CLASS: Record<string, string> = { refunded: 'text-emerald-600', awaiting_refund: 'text-amber-600 font-medium', none: 'text-muted-foreground' };

export function ReturnQcPanel({ returnId, status, refundFlag, refunds, lines, canManage }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState(lines.map((l) => ({
    lineId: l.id, passQty: String(l.passQty), failQty: String(l.failQty), failReason: l.failReason ?? '',
  })));
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<{ passQty: string; failQty: string; failReason: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const isOpen = status === 'open';

  const submit = () => startTransition(async () => {
    setError(null);
    try {
      await submitReturnQc({
        returnId,
        lines: rows.map((r) => ({
          lineId: r.lineId, passQty: Number(r.passQty || 0), failQty: Number(r.failQty || 0),
          failReason: r.failReason || null,
        })),
      });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Lỗi không xác định'); }
  });

  const cancel = () => startTransition(async () => {
    setError(null);
    try { await cancelReturn(returnId); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Lỗi không xác định'); }
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4 space-y-1">
        <div className="text-sm font-semibold">Đối chiếu refund</div>
        <div className={`text-sm ${FLAG_CLASS[refundFlag]}`}>{FLAG_LABEL[refundFlag]}</div>
        {refunds.length > 0 && (
          <ul className="text-xs text-muted-foreground pt-1 space-y-0.5">
            {refunds.map((r, i) => (
              <li key={i}>{new Date(r.refundedAt).toLocaleDateString('vi-VN')} · {r.amount}{r.reason ? ` · ${r.reason}` : ''}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Sản phẩm</th>
              <th className="text-right px-3 py-2">Trả về</th>
              <th className="text-right px-3 py-2">Đạt</th>
              <th className="text-right px-3 py-2">Hư</th>
              <th className="text-left px-3 py-2">Lý do hư</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  <div>{l.productTitle}{l.variantTitle ? ` · ${l.variantTitle}` : ''}</div>
                  <div className="text-xs text-muted-foreground">SKU {l.sku ?? '—'}{l.restockedQty > 0 ? ` · đã restock ${l.restockedQty}` : ''}</div>
                </td>
                <td className="px-3 py-2 text-right">{l.returnedQty}</td>
                <td className="px-3 py-2 text-right">
                  {isOpen && canManage ? (
                    <input type="number" min={0} max={l.returnedQty} value={rows[i].passQty}
                      onChange={(e) => setRow(i, { passQty: e.target.value })}
                      className="w-16 border border-input bg-input/30 rounded-md px-2 py-1 text-sm text-right" />
                  ) : l.passQty}
                </td>
                <td className="px-3 py-2 text-right">
                  {isOpen && canManage ? (
                    <input type="number" min={0} max={l.returnedQty} value={rows[i].failQty}
                      onChange={(e) => setRow(i, { failQty: e.target.value })}
                      className="w-16 border border-input bg-input/30 rounded-md px-2 py-1 text-sm text-right" />
                  ) : l.failQty}
                </td>
                <td className="px-3 py-2">
                  {isOpen && canManage ? (
                    <input value={rows[i].failReason} onChange={(e) => setRow(i, { failReason: e.target.value })}
                      placeholder="—" className="w-full border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                  ) : (l.failReason ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {isOpen && canManage && (
        <div className="flex items-center gap-2">
          <button onClick={submit} disabled={isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
            Hoàn tất QC (restock)
          </button>
          <button onClick={cancel} disabled={isPending}
            className="rounded-md border border-border px-4 py-1.5 text-sm">Huỷ phiếu</button>
        </div>
      )}
      {status === 'completed' && <div className="text-sm text-emerald-600">Đã hoàn tất QC.</div>}
      {status === 'cancelled' && <div className="text-sm text-muted-foreground">Phiếu đã huỷ.</div>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors in the new files. Common gotchas to verify: the server-action props (`searchOrders`/`loadOrderLines`) are passed as inline `'use server'` closures from the server page, the `params` prop is a Promise (Next.js current convention — see `app/(dashboard)/f/fulfillment/[orderId]` for reference), and `Undo2` is imported from `lucide-react`.

- [ ] **Step 6: Commit**

```bash
git add app/(dashboard)/f/returns components/returns
git commit -m "feat(returns): /f/returns list + create flow + QC detail page (F2)"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit-test suite**

Run: `npm test`
Expected: PASS, including `features/returns/logic.test.ts` and the permission/nav tests. Fix any failure before continuing.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by F2 files.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/f/returns` and `/f/returns/[id]` appear in the route list.

- [ ] **Step 4: Manual smoke (requires DATABASE_URL + a synced store with orders)**

Verify in a running dev server (`npm run dev`):
1. `/f/returns` loads; "Tạo phiếu hoàn" → search an order number → pick → enter `returnedQty` on a line → "Tạo phiếu" → redirected to detail.
2. On detail, enter `passQty=2` → "Hoàn tất QC" → status becomes "Đã QC"; check `warehouse_inventory.qty_on_hand` for that SKU increased by 2 and `customer_return_lines.restocked_qty = 2`.
3. Re-submitting QC on the completed return is rejected ("Phiếu đã QC hoặc đã huỷ") — no double restock.
4. If the order has no Shopify refund, the list + detail show the `awaiting_refund` flag (amber); if it does, `refunded` (green).
5. Over-return guard: creating a second return for the same line shows reduced "còn" (returnable) quantity.

- [ ] **Step 5: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test(returns): verification fixes for F2"
```

---

## Self-Review Notes (coverage vs spec)

- §2 data model → Task 1 (enum + 2 tables, all columns/indexes/checks).
- §3 flow (create / QC+restock / cancel) → Task 5 actions; idempotency via `status !== 'open'` guard.
- §4 pure logic (all 5 functions) → Task 2 with tests.
- §5 queries (list/detail/picker/over-return) → Task 4.
- §6 actions + gates → Task 5 (`manage_returns` gate on all mutations; collapses spec's create:/edit: into the project's single-legacy-perm convention, matching transfers).
- §7 permission/nav/UI → Task 3 (permission+nav) + Task 6 (pages/components).
- §8 testing → Task 2 (pure) + Task 7 (suite/build/manual).
- Restock keyed by `sku` via `onConflictDoUpdate` — identical pattern to `features/receiving/actions.ts`.
- Refund is read-only from `shopifyOrderRefunds` — no Shopify writes anywhere (spec §0/§1 honored).
