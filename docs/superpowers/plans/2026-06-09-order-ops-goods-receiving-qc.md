# Goods Receiving & QC (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-unit goods-receiving + QC layer to the order-ops module that, on QC pass, feeds the existing SKU-aggregate inventory (consignment/PO → stock; retail-for-order → allocate to the waiting order line), and on QC fail reopens the brand request.

**Architecture:** Two new tables (`goods_receipts` header + `goods_receipt_items` per physical unit) drive a receiving flow. Pure logic (`features/receiving/logic.ts`) decides disposition + inventory deltas; server actions apply them inside a transaction reusing Phase 1's `warehouse_inventory` reserve mechanics and `orderFulfillmentEvents` audit. Photos go to the existing vendor-neutral S3 helper. New `warehouse.receiving` / `warehouse.qc` permission scopes gate the UI.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM + Postgres, Vitest, existing `lib/storage/s3.ts`, existing RBAC (`lib/auth/permissions.ts` CATALOG + `permission-map.ts` seeds).

---

## File Structure

- `db/schema.ts` — 3 enums + `goodsReceipts` + `goodsReceiptItems` (MODIFY) + migration (CREATE).
- `lib/auth/permissions.ts` — add `warehouse.receiving` + `warehouse.qc` scopes (MODIFY).
- `lib/auth/rbac.ts` — add legacy `Permission` union members (MODIFY).
- `lib/auth/permission-map.ts` — `OLD_TO_NEW` mappings + add to `OPERATOR_OLD` (MODIFY).
- `lib/nav.ts` — Receiving nav entry (MODIFY).
- `features/receiving/logic.ts` + `logic.test.ts` — pure decision/validation/seq helpers (CREATE).
- `features/receiving/queries.ts` — list receipts, awaiting-goods worklist, receipt detail (+signed URLs) (CREATE).
- `features/receiving/actions.ts` — createReceipt, addReceiptItem, uploadReceiptImage, recordQc (CREATE).
- `app/(dashboard)/f/fulfillment/receiving/page.tsx` + `[id]/page.tsx` (CREATE).
- `.env.example` — `S3_*` vars (MODIFY).

---

## Task 1: Schema — receiving tables + migration

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add enums**

In `db/schema.ts`, right after `fulfillmentOrderStatusEnum` (search for `fulfillmentOrderStatusEnum = pgEnum`), add:

```ts
export const receiptSourceTypeEnum = pgEnum('receipt_source_type', ['retail_for_order', 'consignment', 'po']);
export const qcResultEnum = pgEnum('qc_result', ['pending', 'pass', 'fail']);
export const receiptItemDispositionEnum = pgEnum('receipt_item_disposition', ['pending', 'allocate_to_order', 'store', 'return_to_brand']);
```

- [ ] **Step 2: Add the two tables**

Immediately after `orderFulfillmentEvents` (end of the fulfillment block, ~line 1367), add:

```ts
/** A receiving session/document: one delivery of one source type from a vendor. */
export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  warehouseCode: text('warehouse_code').notNull().default('HN'),
  sourceType: receiptSourceTypeEnum('source_type').notNull(),
  vendor: text('vendor'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  receivedBy: text('received_by').references(() => user.id, { onDelete: 'set null' }),
  handoverDocKey: text('handover_doc_key'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('goods_receipts_source_idx').on(t.sourceType)]);

/** One physical unit received. QC + disposition are per-unit. */
export const goodsReceiptItems = pgTable('goods_receipt_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  receiptId: uuid('receipt_id').references(() => goodsReceipts.id, { onDelete: 'cascade' }).notNull(),
  unitCode: text('unit_code').notNull().unique(),
  sku: text('sku'),
  productTitle: text('product_title'),
  variantTitle: text('variant_title'),
  photoKey: text('photo_key'),
  qcResult: qcResultEnum('qc_result').notNull().default('pending'),
  qcFailReason: text('qc_fail_reason'),
  qcFailPhotoKey: text('qc_fail_photo_key'),
  qcCheckedBy: text('qc_checked_by').references(() => user.id, { onDelete: 'set null' }),
  qcCheckedAt: timestamp('qc_checked_at'),
  disposition: receiptItemDispositionEnum('disposition').notNull().default('pending'),
  vendorReturnDocKey: text('vendor_return_doc_key'),
  brandRequestId: uuid('brand_request_id').references(() => brandOrderRequests.id, { onDelete: 'set null' }),
  fulfillmentLineId: uuid('fulfillment_line_id').references(() => orderFulfillmentLines.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'set null' }),
  domPrice: numeric('dom_price'),
  domPriceCurrency: text('dom_price_currency'),
  globalPrice: numeric('global_price'),
  globalPriceCurrency: text('global_price_currency'),
  weightKg: numeric('weight_kg'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('goods_receipt_items_receipt_idx').on(t.receiptId),
  index('goods_receipt_items_qc_idx').on(t.qcResult),
  index('goods_receipt_items_line_idx').on(t.fulfillmentLineId),
]);
```

`pgEnum`, `pgTable`, `uuid`, `text`, `timestamp`, `numeric`, `index` are already imported; `user`, `brandOrderRequests`, `orderFulfillmentLines`, `shopifyOrders` are already in scope. Verify before writing.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Generate migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/00XX_*.sql` containing `CREATE TYPE ... receipt_source_type`, `qc_result`, `receipt_item_disposition`, and `CREATE TABLE "goods_receipts"` + `"goods_receipt_items"` with the unique constraints on `code` and `unit_code`.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(receiving): goods_receipts + goods_receipt_items schema"
```

---

## Task 2: Permissions + nav

**Files:**
- Modify: `lib/auth/permissions.ts`, `lib/auth/rbac.ts`, `lib/auth/permission-map.ts`, `lib/nav.ts`

- [ ] **Step 1: Add scopes to the CATALOG**

In `lib/auth/permissions.ts`, in the `CATALOG` array, add after the `fulfillment.warehouse` entry:

```ts
  { key: 'warehouse.receiving', label: 'Kho — Nhập hàng', actions: ['view', 'create', 'edit'] },
  { key: 'warehouse.qc', label: 'Kho — QC', actions: ['view', 'create', 'edit'] },
```

- [ ] **Step 2: Add legacy Permission union members**

In `lib/auth/rbac.ts`, in the `Permission` union type, add these members (after `'manage_warehouse'`):

```ts
  | 'view_receiving'
  | 'manage_receiving'
  | 'view_qc'
  | 'manage_qc'
```

- [ ] **Step 3: Map legacy → new keys and grant to operator**

In `lib/auth/permission-map.ts`, add to `OLD_TO_NEW` (after the `manage_warehouse` line):

```ts
  view_receiving: ['warehouse.receiving:view'],
  manage_receiving: ['warehouse.receiving:view', 'warehouse.receiving:create', 'warehouse.receiving:edit'],
  view_qc: ['warehouse.qc:view'],
  manage_qc: ['warehouse.qc:view', 'warehouse.qc:create', 'warehouse.qc:edit'],
```

Then add `'view_receiving', 'manage_receiving', 'view_qc', 'manage_qc'` to the end of the `OPERATOR_OLD` array. (Admin already gets every key via `allPermissionKeys()`.)

- [ ] **Step 4: Add the nav entry**

In `lib/nav.ts`, add to the `NAV` array after the `/f/fulfillment` entry:

```ts
  { href: '/f/fulfillment/receiving', label: 'Nhập kho & QC', icon: PackageCheck, requires: 'view_receiving' },
```

Add `PackageCheck` to the `lucide-react` import at the top of `lib/nav.ts`.

- [ ] **Step 5: Typecheck + run RBAC tests**

Run: `npm run typecheck && npx vitest run lib/auth lib/nav.test.ts`
Expected: PASS (existing `permissions.test.ts`, `permission-map.test.ts`, `rbac.test.ts`, `nav.test.ts` still green — admin gets the new keys via `allPermissionKeys()`, operator via the expanded `OPERATOR_OLD`).

- [ ] **Step 6: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/rbac.ts lib/auth/permission-map.ts lib/nav.ts
git commit -m "feat(receiving): warehouse.receiving + warehouse.qc permissions and nav"
```

---

## Task 3: Pure receiving logic + tests

**Files:**
- Create: `features/receiving/logic.ts`
- Test: `features/receiving/logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/receiving/logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  decideDisposition, validateQc, inventoryEffect, nextSeqCode, parseSeq,
} from './logic';

describe('decideDisposition', () => {
  it('pass + retail_for_order => allocate_to_order', () => {
    expect(decideDisposition('retail_for_order', 'pass')).toBe('allocate_to_order');
  });
  it('pass + consignment/po => store', () => {
    expect(decideDisposition('consignment', 'pass')).toBe('store');
    expect(decideDisposition('po', 'pass')).toBe('store');
  });
  it('fail => return_to_brand for any source', () => {
    expect(decideDisposition('retail_for_order', 'fail')).toBe('return_to_brand');
    expect(decideDisposition('consignment', 'fail')).toBe('return_to_brand');
  });
  it('pending => pending', () => {
    expect(decideDisposition('po', 'pending')).toBe('pending');
  });
});

describe('validateQc', () => {
  it('fail requires reason and photo', () => {
    expect(validateQc({ qcResult: 'fail', qcFailReason: '', qcFailPhotoKey: '' }).ok).toBe(false);
    expect(validateQc({ qcResult: 'fail', qcFailReason: 'sai màu', qcFailPhotoKey: null }).ok).toBe(false);
    expect(validateQc({ qcResult: 'fail', qcFailReason: 'sai màu', qcFailPhotoKey: 'k/1.jpg' }).ok).toBe(true);
  });
  it('pass is always valid', () => {
    expect(validateQc({ qcResult: 'pass' }).ok).toBe(true);
  });
});

describe('inventoryEffect', () => {
  it('allocate_to_order with sku reserves and sets line in_stock', () => {
    expect(inventoryEffect('allocate_to_order', true)).toEqual({ onHandDelta: 1, reservedDelta: 1, lineStatus: 'in_stock' });
  });
  it('allocate_to_order without sku still sets line in_stock, no stock change', () => {
    expect(inventoryEffect('allocate_to_order', false)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: 'in_stock' });
  });
  it('store with sku increments on-hand only', () => {
    expect(inventoryEffect('store', true)).toEqual({ onHandDelta: 1, reservedDelta: 0, lineStatus: null });
  });
  it('return_to_brand and pending touch nothing', () => {
    expect(inventoryEffect('return_to_brand', true)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: null });
    expect(inventoryEffect('pending', true)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: null });
  });
});

describe('seq codes', () => {
  it('formats with 5-digit padding', () => {
    expect(nextSeqCode('WH', 4)).toBe('WH-00005');
    expect(nextSeqCode('GRN', 0)).toBe('GRN-00001');
  });
  it('parses a code back to its number, 0 for invalid/null', () => {
    expect(parseSeq('WH', 'WH-00005')).toBe(5);
    expect(parseSeq('WH', null)).toBe(0);
    expect(parseSeq('WH', 'GRN-00005')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/receiving/logic.test.ts`
Expected: FAIL — cannot resolve `./logic`.

- [ ] **Step 3: Implement the pure logic**

Create `features/receiving/logic.ts`:

```ts
/** Pure receiving logic — no DB. Disposition decision, QC validation, the
 *  inventory delta + resulting line status, and sequential code formatting. */

export type SourceType = 'retail_for_order' | 'consignment' | 'po';
export type QcResult = 'pending' | 'pass' | 'fail';
export type Disposition = 'pending' | 'allocate_to_order' | 'store' | 'return_to_brand';

/** Map (source, QC outcome) to the warehouse disposition. */
export function decideDisposition(sourceType: SourceType, qc: QcResult): Disposition {
  if (qc === 'fail') return 'return_to_brand';
  if (qc !== 'pass') return 'pending';
  return sourceType === 'retail_for_order' ? 'allocate_to_order' : 'store';
}

export interface QcInput { qcResult: QcResult; qcFailReason?: string | null; qcFailPhotoKey?: string | null; }

/** QC fail must carry a reason and a photo (evidence for the brand return). */
export function validateQc(input: QcInput): { ok: true } | { ok: false; error: string } {
  if (input.qcResult === 'fail') {
    if (!input.qcFailReason || input.qcFailReason.trim() === '') return { ok: false, error: 'QC fail cần lý do' };
    if (!input.qcFailPhotoKey || input.qcFailPhotoKey.trim() === '') return { ok: false, error: 'QC fail cần ảnh lỗi' };
  }
  return { ok: true };
}

export interface InvEffect { onHandDelta: number; reservedDelta: number; lineStatus: 'in_stock' | null; }

/** Stock deltas + resulting fulfillment-line status for a disposition.
 *  Stock is only touched when there's a SKU to key the aggregate row by.
 *  (The 'return_to_brand' reopen-to-brand_requested is applied by the caller,
 *  since it depends on whether the item is linked to a fulfillment line.) */
export function inventoryEffect(disposition: Disposition, hasSku: boolean): InvEffect {
  switch (disposition) {
    case 'allocate_to_order': return { onHandDelta: hasSku ? 1 : 0, reservedDelta: hasSku ? 1 : 0, lineStatus: 'in_stock' };
    case 'store': return { onHandDelta: hasSku ? 1 : 0, reservedDelta: 0, lineStatus: null };
    default: return { onHandDelta: 0, reservedDelta: 0, lineStatus: null };
  }
}

/** Next human code, e.g. nextSeqCode('WH', 4) => 'WH-00005'. */
export function nextSeqCode(prefix: string, maxSeq: number): string {
  return `${prefix}-${String(maxSeq + 1).padStart(5, '0')}`;
}

/** Parse the numeric suffix of a code for the given prefix; 0 if null/mismatch. */
export function parseSeq(prefix: string, code: string | null): number {
  if (!code) return 0;
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(code);
  return m ? parseInt(m[1], 10) : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/receiving/logic.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add features/receiving/logic.ts features/receiving/logic.test.ts
git commit -m "feat(receiving): pure disposition/QC/inventory-effect logic with tests"
```

---

## Task 4: Queries

**Files:**
- Create: `features/receiving/queries.ts`

DB-backed (verified end-to-end later, not unit-tested). Keep thin.

- [ ] **Step 1: Implement queries**

Create `features/receiving/queries.ts`:

```ts
import { eq, desc, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl, isStorageConfigured } from '@/lib/storage/s3';

/** Receipts list, newest first. */
export async function listReceipts() {
  return db.select({
    id: schema.goodsReceipts.id,
    code: schema.goodsReceipts.code,
    warehouseCode: schema.goodsReceipts.warehouseCode,
    sourceType: schema.goodsReceipts.sourceType,
    vendor: schema.goodsReceipts.vendor,
    receivedAt: schema.goodsReceipts.receivedAt,
  })
    .from(schema.goodsReceipts)
    .orderBy(desc(schema.goodsReceipts.receivedAt));
}

/** Lines confirmed by a brand and still awaiting physical goods (worklist for
 *  receiving "retail_for_order" items). */
export async function listAwaitingGoods() {
  return db.select({
    lineId: schema.orderFulfillmentLines.id,
    orderId: schema.brandOrderRequests.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandRequestId: schema.brandOrderRequests.id,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .where(and(
      eq(schema.orderFulfillmentLines.status, 'brand_confirmed'),
      eq(schema.brandOrderRequests.confirmStatus, 'confirmed'),
    ))
    .orderBy(schema.brandOrderRequests.expectedDeliveryDate);
}

async function signed(key: string | null): Promise<string | null> {
  if (!key || !isStorageConfigured()) return null;
  return getSignedDownloadUrl(key);
}

/** A receipt header + its items, with signed URLs resolved for any image keys. */
export async function getReceiptDetail(receiptId: string) {
  const [receipt] = await db.select().from(schema.goodsReceipts)
    .where(eq(schema.goodsReceipts.id, receiptId)).limit(1);
  if (!receipt) return null;
  const items = await db.select().from(schema.goodsReceiptItems)
    .where(eq(schema.goodsReceiptItems.receiptId, receiptId))
    .orderBy(schema.goodsReceiptItems.unitCode);
  const itemsWithUrls = await Promise.all(items.map(async (it) => ({
    ...it,
    photoUrl: await signed(it.photoKey),
    qcFailPhotoUrl: await signed(it.qcFailPhotoKey),
  })));
  const handoverUrl = await signed(receipt.handoverDocKey);
  return { receipt: { ...receipt, handoverUrl }, items: itemsWithUrls };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add features/receiving/queries.ts
git commit -m "feat(receiving): receipt list, awaiting-goods worklist, detail queries"
```

---

## Task 5: Server actions

**Files:**
- Create: `features/receiving/actions.ts`

- [ ] **Step 1: Implement actions**

Create `features/receiving/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql, and, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { rollupOrderStatus, type LineStatus } from '@/features/fulfillment/logic';
import { recordAudit } from '@/lib/logging/audit';
import { putObject } from '@/lib/storage/s3';
import { decideDisposition, validateQc, inventoryEffect, nextSeqCode, parseSeq, type SourceType, type QcResult } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment).set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

/** Upload an image to S3 under a receipts/ prefix; returns the object key. */
export async function uploadReceiptImage(formData: FormData): Promise<string> {
  await requirePerm('manage_receiving');
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('No file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Deterministic-enough key: receipts/<receiptId-or-tmp>/<unitCode-or-rand>/<name>.
  const scope = String(formData.get('scope') ?? 'tmp');
  const key = `receipts/${scope}/${Date.now()}-${safe}`;
  await putObject(key, bytes, file.type || 'application/octet-stream');
  return key;
}

export interface CreateReceiptInput {
  sourceType: SourceType; vendor?: string | null; warehouseCode?: string | null;
  handoverDocKey?: string | null; note?: string | null;
}

/** Create a receipt header with an auto-generated GRN code. Returns its id. */
export async function createReceipt(input: CreateReceiptInput): Promise<string> {
  const userId = await requirePerm('manage_receiving');
  const id = await db.transaction(async (tx) => {
    const [last] = await tx.select({ code: schema.goodsReceipts.code })
      .from(schema.goodsReceipts).orderBy(desc(schema.goodsReceipts.code)).limit(1);
    const code = nextSeqCode('GRN', parseSeq('GRN', last?.code ?? null));
    const [row] = await tx.insert(schema.goodsReceipts).values({
      code, sourceType: input.sourceType, vendor: input.vendor ?? null,
      warehouseCode: input.warehouseCode?.trim() || 'HN',
      handoverDocKey: input.handoverDocKey ?? null, note: input.note ?? null, receivedBy: userId,
    }).returning({ id: schema.goodsReceipts.id });
    return row.id;
  });
  await recordAudit({ userId, action: 'receiving_create', target: id, result: 'success' });
  revalidatePath('/f/fulfillment/receiving');
  return id;
}

export interface AddReceiptItemInput {
  receiptId: string;
  sku?: string | null; productTitle?: string | null; variantTitle?: string | null; photoKey?: string | null;
  // present for retail_for_order items chosen from the awaiting-goods worklist
  brandRequestId?: string | null; fulfillmentLineId?: string | null; orderId?: string | null;
  domPrice?: string | null; domPriceCurrency?: string | null;
  globalPrice?: string | null; globalPriceCurrency?: string | null; weightKg?: string | null;
}

/** Add one physical unit (auto WH unit code) to a receipt. Returns its id. */
export async function addReceiptItem(input: AddReceiptItemInput): Promise<string> {
  const userId = await requirePerm('manage_receiving');
  const id = await db.transaction(async (tx) => {
    const [last] = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode })
      .from(schema.goodsReceiptItems).orderBy(desc(schema.goodsReceiptItems.unitCode)).limit(1);
    const unitCode = nextSeqCode('WH', parseSeq('WH', last?.unitCode ?? null));
    const [row] = await tx.insert(schema.goodsReceiptItems).values({
      receiptId: input.receiptId, unitCode,
      sku: input.sku?.trim() || null, productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
      photoKey: input.photoKey ?? null,
      brandRequestId: input.brandRequestId ?? null, fulfillmentLineId: input.fulfillmentLineId ?? null, orderId: input.orderId ?? null,
      domPrice: input.domPrice ?? null, domPriceCurrency: input.domPriceCurrency ?? null,
      globalPrice: input.globalPrice ?? null, globalPriceCurrency: input.globalPriceCurrency ?? null, weightKg: input.weightKg ?? null,
    }).returning({ id: schema.goodsReceiptItems.id });
    return row.id;
  });
  await recordAudit({ userId, action: 'receiving_add_item', target: id, result: 'success' });
  revalidatePath(`/f/fulfillment/receiving/${input.receiptId}`);
  return id;
}

export interface RecordQcInput {
  itemId: string; qcResult: QcResult;
  qcFailReason?: string | null; qcFailPhotoKey?: string | null; vendorReturnDocKey?: string | null;
}

/** Record a QC result and apply its disposition: pass-for-order allocates to the
 *  order line; pass-for-stock increments on-hand; fail reopens the brand request. */
export async function recordQc(input: RecordQcInput): Promise<void> {
  const userId = await requirePerm('manage_qc');
  const v = validateQc(input);
  if (!v.ok) throw new Error(v.error);

  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.id, input.itemId)).limit(1);
    if (!item) throw new Error('Item not found');
    if (item.qcResult !== 'pending') throw new Error('Đơn vị này đã QC');
    const [receipt] = await tx.select({ sourceType: schema.goodsReceipts.sourceType })
      .from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, item.receiptId)).limit(1);
    if (!receipt) throw new Error('Receipt not found');

    let disposition = decideDisposition(receipt.sourceType as SourceType, input.qcResult);

    // Resolve the linked line (for retail_for_order pass/fail handling).
    const line = item.fulfillmentLineId
      ? (await tx.select().from(schema.orderFulfillmentLines)
          .where(eq(schema.orderFulfillmentLines.id, item.fulfillmentLineId)).limit(1))[0]
      : undefined;

    // Surplus guard: a pass meant to allocate, but the line is no longer
    // awaiting goods (already satisfied) → divert this good unit to stock.
    const ALLOCATABLE = new Set(['brand_confirmed', 'brand_requested', 'out_of_stock', 'pending_check']);
    if (disposition === 'allocate_to_order' && (!line || !ALLOCATABLE.has(line.status))) {
      disposition = 'store';
    }

    const hasSku = !!item.sku;
    const eff = inventoryEffect(disposition, hasSku);

    // Persist the item's QC outcome + disposition.
    await tx.update(schema.goodsReceiptItems).set({
      qcResult: input.qcResult, qcFailReason: input.qcFailReason ?? null, qcFailPhotoKey: input.qcFailPhotoKey ?? null,
      vendorReturnDocKey: input.vendorReturnDocKey ?? null, disposition,
      qcCheckedBy: userId, qcCheckedAt: sql`now()`, updatedAt: sql`now()`,
    }).where(eq(schema.goodsReceiptItems.id, item.id));

    // Apply stock deltas to the SKU-aggregate row (upsert, create if missing).
    let inventoryRowId: string | null = null;
    if (hasSku && (eff.onHandDelta !== 0 || eff.reservedDelta !== 0)) {
      const [inv] = await tx.insert(schema.warehouseInventory)
        .values({ sku: item.sku!, productTitle: item.productTitle, variantTitle: item.variantTitle,
                  qtyOnHand: eff.onHandDelta, qtyReserved: eff.reservedDelta, updatedBy: userId })
        .onConflictDoUpdate({
          target: schema.warehouseInventory.sku,
          set: {
            qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${eff.onHandDelta}`,
            qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${eff.reservedDelta}`,
            updatedBy: userId, updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.warehouseInventory.id });
      inventoryRowId = inv.id;
    }

    // Apply the line outcome.
    if (disposition === 'allocate_to_order' && line) {
      await tx.update(schema.orderFulfillmentLines).set({
        status: 'in_stock', warehouseInventoryId: inventoryRowId, allocatedQty: line.qty, updatedAt: sql`now()`,
      }).where(eq(schema.orderFulfillmentLines.id, line.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: line.status, toStatus: 'in_stock',
        actor: userId, note: `Nhận hàng ${item.unitCode} QC pass`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    } else if (disposition === 'return_to_brand' && line) {
      await tx.update(schema.orderFulfillmentLines).set({ status: 'brand_requested', updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, line.id));
      await tx.update(schema.brandOrderRequests).set({
        confirmStatus: 'awaiting', expectedDeliveryDate: null,
        note: sql`coalesce(${schema.brandOrderRequests.note}, '') || ${'\nQC fail: ' + (input.qcFailReason ?? '')}`,
        updatedAt: sql`now()`,
      }).where(eq(schema.brandOrderRequests.fulfillmentLineId, line.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: line.status, toStatus: 'brand_requested',
        actor: userId, note: `QC fail ${item.unitCode}: ${input.qcFailReason ?? ''}`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    }
  });

  await recordAudit({ userId, action: 'receiving_qc', target: input.itemId, requestSummary: `result=${input.qcResult}`, result: 'success' });
  revalidatePath('/f/fulfillment/receiving');
  revalidatePath('/f/fulfillment');
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If TS flags `line.status` typing in the `Set.has` call, cast with `line.status as string`.)

- [ ] **Step 3: Run logic + auth regression**

Run: `npx vitest run features/receiving lib/auth`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/receiving/actions.ts
git commit -m "feat(receiving): receipt + QC server actions (allocate/store/reopen-brand)"
```

---

## Task 6: UI pages

**Files:**
- Create: `app/(dashboard)/f/fulfillment/receiving/page.tsx`
- Create: `app/(dashboard)/f/fulfillment/receiving/[id]/page.tsx`

- [ ] **Step 1: Receiving list + awaiting-goods + new-receipt page**

Create `app/(dashboard)/f/fulfillment/receiving/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PackageCheck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listReceipts, listAwaitingGoods } from '@/features/receiving/queries';
import { createReceipt, addReceiptItem } from '@/features/receiving/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  retail_for_order: 'Retail (đi đơn)', consignment: 'Consignment (ký gửi)', po: 'PO',
};

async function newReceiptAction(formData: FormData) {
  'use server';
  const sourceType = String(formData.get('sourceType') ?? 'consignment') as 'retail_for_order' | 'consignment' | 'po';
  const vendor = String(formData.get('vendor') ?? '').trim() || null;
  const id = await createReceipt({ sourceType, vendor });
  redirect(`/f/fulfillment/receiving/${id}`);
}

async function receiveForOrderAction(formData: FormData) {
  'use server';
  // Create a single-item retail_for_order receipt straight from the worklist.
  const receiptId = await createReceipt({ sourceType: 'retail_for_order', vendor: String(formData.get('brandSlug') ?? '') || null });
  await addReceiptItem({
    receiptId,
    sku: String(formData.get('sku') ?? '') || null,
    brandRequestId: String(formData.get('brandRequestId') ?? '') || null,
    fulfillmentLineId: String(formData.get('lineId') ?? '') || null,
    orderId: String(formData.get('orderId') ?? '') || null,
  });
  redirect(`/f/fulfillment/receiving/${receiptId}`);
}

export default async function ReceivingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Nhập kho & QC.</div>;
  }
  const canReceive = hasPermission(role, 'manage_receiving');
  const [receipts, awaiting] = await Promise.all([listReceipts(), listAwaitingGoods()]);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <PackageCheck className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Nhập kho &amp; QC</h1>
      </header>

      {canReceive && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="text-sm font-semibold">Phiếu nhập mới</h2>
            <form action={newReceiptAction} className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Loại nguồn</label>
                <select name="sourceType" className="border border-input bg-input/30 rounded-md px-2 py-2 text-sm">
                  <option value="consignment">Consignment (ký gửi)</option>
                  <option value="po">PO</option>
                  <option value="retail_for_order">Retail (đi đơn)</option>
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Vendor</label>
                <input name="vendor" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" placeholder="Tên brand/nhà cung cấp" />
              </div>
              <Button type="submit" size="sm" className="h-9">Tạo phiếu</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Chờ hàng về ({awaiting.length})</div>
          <ul className="divide-y divide-border">
            {awaiting.map((a) => (
              <li key={a.lineId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.orderNumber} · {a.sku ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{a.brandSlug ?? '—'} · SL {a.qty} · giao dự kiến {a.expectedDeliveryDate ?? '—'}</div>
                </div>
                {canReceive && (
                  <form action={receiveForOrderAction}>
                    <input type="hidden" name="brandRequestId" value={a.brandRequestId} />
                    <input type="hidden" name="lineId" value={a.lineId} />
                    <input type="hidden" name="orderId" value={a.orderId} />
                    <input type="hidden" name="sku" value={a.sku ?? ''} />
                    <input type="hidden" name="brandSlug" value={a.brandSlug ?? ''} />
                    <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">Nhận hàng</Button>
                  </form>
                )}
              </li>
            ))}
            {awaiting.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Không có dòng nào chờ hàng.</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Phiếu nhập ({receipts.length})</div>
          <ul className="divide-y divide-border">
            {receipts.map((r) => (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                <Link href={`/f/fulfillment/receiving/${r.id}`} className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.code} · {r.vendor ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{r.warehouseCode} · {String(r.receivedAt).slice(0, 10)}</div>
                </Link>
                <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</Badge>
              </li>
            ))}
            {receipts.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Chưa có phiếu nhập.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Receipt detail page (add items + QC)**

Create `app/(dashboard)/f/fulfillment/receiving/[id]/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getReceiptDetail } from '@/features/receiving/queries';
import { addReceiptItem, recordQc, uploadReceiptImage } from '@/features/receiving/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

async function addItemAction(receiptId: string, formData: FormData) {
  'use server';
  await addReceiptItem({
    receiptId,
    sku: String(formData.get('sku') ?? '') || null,
    productTitle: String(formData.get('productTitle') ?? '') || null,
  });
}

async function passAction(formData: FormData) {
  'use server';
  await recordQc({ itemId: String(formData.get('itemId')), qcResult: 'pass' });
}

async function failAction(formData: FormData) {
  'use server';
  let key: string | null = null;
  const file = formData.get('failPhoto');
  if (file instanceof File && file.size > 0) {
    const fd = new FormData(); fd.set('file', file); fd.set('scope', String(formData.get('itemId')));
    key = await uploadReceiptImage(fd);
  }
  await recordQc({
    itemId: String(formData.get('itemId')),
    qcResult: 'fail',
    qcFailReason: String(formData.get('reason') ?? ''),
    qcFailPhotoKey: key,
  });
}

const QC_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = { pass: 'default', fail: 'secondary', pending: 'outline' };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const canReceive = hasPermission(role, 'manage_receiving');
  const canQc = hasPermission(role, 'manage_qc');
  const detail = await getReceiptDetail(id);
  if (!detail) notFound();
  const { receipt, items } = detail;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{receipt.code}</h1>
        <p className="text-sm text-muted-foreground">{receipt.sourceType} · {receipt.vendor ?? '—'} · {receipt.warehouseCode}</p>
      </header>

      {canReceive && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-sm font-semibold">Thêm đơn vị hàng</h2>
            <form action={addItemAction.bind(null, id)} className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">SKU</label>
                <input name="sku" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Tên SP</label>
                <input name="productTitle" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" />
              </div>
              <Button type="submit" size="sm" className="h-9">Thêm</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Đơn vị hàng ({items.length})</div>
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="px-5 py-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{it.unitCode} · {it.sku ?? '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{it.productTitle ?? ''} · {it.disposition}</div>
                  </div>
                  <Badge variant={QC_VARIANT[it.qcResult]} className="h-5 text-[10px] uppercase tracking-wider">{it.qcResult}</Badge>
                </div>
                {it.qcResult === 'fail' && it.qcFailReason && (
                  <div className="text-xs text-amber-600">Lý do: {it.qcFailReason}</div>
                )}
                {canQc && it.qcResult === 'pending' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={passAction}>
                      <input type="hidden" name="itemId" value={it.id} />
                      <Button type="submit" size="sm" className="h-7 px-3 text-xs">QC Pass</Button>
                    </form>
                    <form action={failAction} className="flex items-center gap-2" encType="multipart/form-data">
                      <input type="hidden" name="itemId" value={it.id} />
                      <input name="reason" placeholder="Lý do fail" required className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs" />
                      <input type="file" name="failPhoto" accept="image/*" required className="text-xs" />
                      <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">QC Fail</Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
            {items.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Chưa có đơn vị hàng.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS; `/f/fulfillment/receiving` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/fulfillment/receiving"
git commit -m "feat(receiving): receiving list, awaiting-goods, and receipt detail pages"
```

---

## Task 7: Env + verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document S3 env**

Append to `.env.example`:

```bash
# Object storage for receiving photos / QC evidence (vendor-neutral S3 API:
# Supabase Storage, Cloudflare R2, AWS S3, MinIO). See lib/storage/s3.ts.
S3_ENDPOINT=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
```

- [ ] **Step 2: Full regression**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS (incl. `features/receiving/logic.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(receiving): document S3 env for receiving photos"
```

- [ ] **Step 4: Manual verification (after deploy + S3 configured)**

Apply migration (`npm run db:migrate`) and verify:
1. `/f/fulfillment/receiving` shows under nav for an admin/operator.
2. Create a consignment receipt → add an item with a SKU → QC Pass → `warehouse_inventory.qtyOnHand` for that SKU increments by 1.
3. A `brand_confirmed` line appears under "Chờ hàng về" → "Nhận hàng" → QC Pass → that order line moves to `in_stock` and shows in the pick worklist (`/f/fulfillment`).
4. Receive a retail_for_order item → QC Fail (reason + photo) → the order line returns to `brand_requested` and the brand request `confirm_status` returns to `awaiting`.

---

## Notes

- Reuses Phase 1 reserve mechanics: a retail_for_order pass does `qtyOnHand+1, qtyReserved+1` and sets the line `in_stock` with `allocatedQty = line.qty`; the subsequent pick (Phase 1 `applyLineTransition`) decrements both — no double counting.
- No-SKU for-order lines still move to `in_stock` (earmarked) without touching the aggregate; pick won't decrement (no `warehouseInventoryId`).
- Full unit-level inventory, multi-warehouse transfers, pack codes/materials, finance reconciliation, and Shopify status sync are sub-projects B–F.
