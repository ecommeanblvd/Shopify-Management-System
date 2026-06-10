# Shopify Fulfillment Push (Sub-project F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pack ships, push a Shopify fulfillment (partial, per pack) with tracking + carrier and customer notification, tracked on the shipment for manual retry on failure.

**Architecture:** `shipPack` (sub-project D) gains a pre-flight `write_fulfillments` scope gate (blocks if missing) and, after the internal-ship commit, calls `pushPackFulfillment(packId)`. That action queries the order's `fulfillmentOrders`, maps the pack's lines (by `shopifyLineId`) to fulfillment-order line items via pure logic, and runs `fulfillmentCreateV2` through a dedicated `lib/shopify/fulfillment.ts` writer (raw `graphqlCall` + `getStoreToken`). Push state lives on `shipments` (pushed/failed) so the UI can retry.

**Tech Stack:** Next.js App Router (server actions), Drizzle + Postgres, Shopify GraphQL Admin API 2025-01, Vitest.

---

## File Structure

- `db/schema.ts` — `shopify_push_status` enum + 4 push columns on `shipments` (MODIFY) + migration (CREATE).
- `features/packing/shopify-push.ts` + `shopify-push.test.ts` — pure mapping/scope/carrier logic (CREATE).
- `lib/shopify/fulfillment.ts` — `getOrderFulfillmentOrders` + `createFulfillment` (CREATE).
- `features/packing/shopify-actions.ts` — `pushPackFulfillment(packId)` server action (CREATE).
- `features/packing/actions.ts` — `shipPack`: pre-flight scope gate + after-commit push call (MODIFY).
- `components/fulfillment/PackPanel.tsx` — push-status badge + "Push lại" button (MODIFY).
- `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` — pass push fields into PackPanel (MODIFY).
- `features/packing/queries.ts` — include push fields in `listPacksForOrder` (MODIFY).
- `.env.example` — add `write_fulfillments` to `SHOPIFY_SCOPES` + re-install note (MODIFY).

---

## Task 1: Schema — push-status columns

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add enum + columns**

In `db/schema.ts`, near the other shipment-related enums (e.g. just before `export const shipments = pgTable`), add:

```ts
export const shopifyPushStatusEnum = pgEnum('shopify_push_status', ['pending', 'pushed', 'failed']);
```

Then in the `shipments` table, add these columns just before `createdAt`:

```ts
  shopifyFulfillmentId: text('shopify_fulfillment_id'),
  shopifyPushStatus: shopifyPushStatusEnum('shopify_push_status'),
  shopifyPushError: text('shopify_push_error'),
  shopifyPushedAt: timestamp('shopify_pushed_at'),
```

`pgEnum`, `text`, `timestamp` are imported. Verify.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Generate migration**

Run: `npm run db:generate` → a new `db/migrations/00XX_*.sql` (e.g. 0046) with `CREATE TYPE ... shopify_push_status` and `ALTER TABLE "shipments" ADD COLUMN` for the 4 columns.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(shopify-push): shipments push-status columns"
```

---

## Task 2: Pure logic — carrier, scope, line-item mapping

**Files:**
- Create: `features/packing/shopify-push.ts`
- Test: `features/packing/shopify-push.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/packing/shopify-push.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { trackingCompany, hasWriteFulfillmentsScope, buildFulfillmentLineItems } from './shopify-push';

describe('trackingCompany', () => {
  it('maps known carriers', () => {
    expect(trackingCompany('fedex')).toBe('FedEx');
    expect(trackingCompany('dhl')).toBe('DHL');
  });
  it('capitalizes unknown, handles null', () => {
    expect(trackingCompany('ups')).toBe('Ups');
    expect(trackingCompany(null)).toBe('Other');
  });
});

describe('hasWriteFulfillmentsScope', () => {
  it('true only when present', () => {
    expect(hasWriteFulfillmentsScope(['read_orders', 'write_fulfillments'])).toBe(true);
    expect(hasWriteFulfillmentsScope(['read_orders'])).toBe(false);
  });
});

describe('buildFulfillmentLineItems', () => {
  const fos = [{
    id: 'gid://shopify/FulfillmentOrder/1',
    lineItems: [
      { id: 'gid://shopify/FulfillmentOrderLineItem/11', remainingQuantity: 2, lineItem: { id: 'gid://shopify/LineItem/100' } },
      { id: 'gid://shopify/FulfillmentOrderLineItem/12', remainingQuantity: 1, lineItem: { id: 'gid://shopify/LineItem/200' } },
    ],
  }];

  it('maps pack lines to FO line items, clamping to remaining qty', () => {
    const r = buildFulfillmentLineItems(fos, [{ shopifyLineId: 'gid://shopify/LineItem/100', qty: 5 }]);
    expect(r).toEqual({
      ok: true,
      lineItemsByFulfillmentOrder: [{
        fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
        fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/11', quantity: 2 }],
      }],
    });
  });

  it('errors when no pack line matches a fulfillable FO line', () => {
    const r = buildFulfillmentLineItems(fos, [{ shopifyLineId: 'gid://shopify/LineItem/999', qty: 1 }]);
    expect(r.ok).toBe(false);
  });

  it('skips FO line items with remainingQuantity 0', () => {
    const zero = [{ id: 'gid://shopify/FulfillmentOrder/2', lineItems: [
      { id: 'gid://shopify/FulfillmentOrderLineItem/21', remainingQuantity: 0, lineItem: { id: 'gid://shopify/LineItem/100' } },
    ] }];
    const r = buildFulfillmentLineItems(zero, [{ shopifyLineId: 'gid://shopify/LineItem/100', qty: 1 }]);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/packing/shopify-push.test.ts`
Expected: FAIL — cannot resolve `./shopify-push`.

- [ ] **Step 3: Implement**

Create `features/packing/shopify-push.ts`:

```ts
/** Pure helpers for pushing a pack's fulfillment to Shopify — no DB / no network. */

const CARRIER_NAMES: Record<string, string> = { fedex: 'FedEx', dhl: 'DHL' };

/** Map our carrierKey to a Shopify tracking-company display name. */
export function trackingCompany(carrierKey: string | null): string {
  if (!carrierKey) return 'Other';
  const k = carrierKey.trim().toLowerCase();
  return CARRIER_NAMES[k] ?? (k.charAt(0).toUpperCase() + k.slice(1));
}

export function hasWriteFulfillmentsScope(scopes: string[]): boolean {
  return scopes.includes('write_fulfillments');
}

export interface FoLineItem { id: string; remainingQuantity: number; lineItem: { id: string }; }
export interface FulfillmentOrderNode { id: string; lineItems: FoLineItem[]; }
export interface PackLine { shopifyLineId: string; qty: number; }
export interface FulfillmentInputGroup { fulfillmentOrderId: string; fulfillmentOrderLineItems: { id: string; quantity: number }[]; }

/** Build the `lineItemsByFulfillmentOrder` input by matching pack lines (by the
 *  underlying order LineItem gid) to fulfillable FO line items. Quantity is
 *  clamped to the FO line's remainingQuantity. Returns an error if nothing
 *  matched (e.g. already fulfilled elsewhere). */
export function buildFulfillmentLineItems(
  fulfillmentOrders: FulfillmentOrderNode[],
  packLines: PackLine[],
): { ok: true; lineItemsByFulfillmentOrder: FulfillmentInputGroup[] } | { ok: false; error: string } {
  const wantQty = new Map(packLines.map((l) => [l.shopifyLineId, l.qty]));
  const groups: FulfillmentInputGroup[] = [];
  for (const fo of fulfillmentOrders) {
    const items: { id: string; quantity: number }[] = [];
    for (const li of fo.lineItems) {
      const want = wantQty.get(li.lineItem.id);
      if (want == null) continue;
      const quantity = Math.min(want, li.remainingQuantity);
      if (quantity > 0) items.push({ id: li.id, quantity });
    }
    if (items.length > 0) groups.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: items });
  }
  if (groups.length === 0) {
    return { ok: false, error: 'Không có dòng nào khớp fulfillment order (có thể đã fulfilled)' };
  }
  return { ok: true, lineItemsByFulfillmentOrder: groups };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/packing/shopify-push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/packing/shopify-push.ts features/packing/shopify-push.test.ts
git commit -m "feat(shopify-push): pure carrier/scope/line-mapping logic with tests"
```

---

## Task 3: Shopify fulfillment writer

**Files:**
- Create: `lib/shopify/fulfillment.ts`

VERIFY the Shopify GraphQL shapes for API 2025-01 before finalizing (use the Shopify Admin GraphQL docs or context7 for `fulfillmentCreateV2`, `FulfillmentV2Input`, `Order.fulfillmentOrders`, `FulfillmentOrderLineItem`). The query/mutation below match 2025-01; adjust field names if the docs differ and note the change.

- [ ] **Step 1: Implement**

Create `lib/shopify/fulfillment.ts`:

```ts
import { graphqlCall } from './client';
import type { FulfillmentOrderNode, FulfillmentInputGroup } from '@/features/packing/shopify-push';

export interface ShopifyStoreRef { shopDomain: string; apiVersion: string; token: string; }

const FULFILLMENT_ORDERS_QUERY = `
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          lineItems(first: 100) {
            nodes { id remainingQuantity lineItem { id } }
          }
        }
      }
    }
  }
`;

/** Open fulfillment orders for an order, normalized to the pure-logic shape. */
export async function getOrderFulfillmentOrders(args: { store: ShopifyStoreRef; orderGid: string }): Promise<FulfillmentOrderNode[]> {
  const res = await graphqlCall({
    shopDomain: args.store.shopDomain, apiVersion: args.store.apiVersion, token: args.store.token,
    query: FULFILLMENT_ORDERS_QUERY, variables: { id: args.orderGid },
  });
  if (res.errors) throw new Error(`Shopify query error: ${JSON.stringify(res.errors)}`);
  const data = res.data as { order?: { fulfillmentOrders?: { nodes?: Array<{ id: string; status: string; lineItems: { nodes: Array<{ id: string; remainingQuantity: number; lineItem: { id: string } }> } }> } } };
  const nodes = data.order?.fulfillmentOrders?.nodes ?? [];
  // Only fulfillment orders that can still be fulfilled.
  return nodes
    .filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS')
    .map((fo) => ({ id: fo.id, lineItems: fo.lineItems.nodes }));
}

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

/** Create a Shopify fulfillment for the given line groups + tracking. */
export async function createFulfillment(args: {
  store: ShopifyStoreRef;
  lineItemsByFulfillmentOrder: FulfillmentInputGroup[];
  trackingCompany: string;
  trackingNumber: string;
  notifyCustomer: boolean;
}): Promise<string> {
  const res = await graphqlCall({
    shopDomain: args.store.shopDomain, apiVersion: args.store.apiVersion, token: args.store.token,
    query: FULFILLMENT_CREATE_MUTATION,
    variables: {
      fulfillment: {
        notifyCustomer: args.notifyCustomer,
        trackingInfo: { company: args.trackingCompany, number: args.trackingNumber },
        lineItemsByFulfillmentOrder: args.lineItemsByFulfillmentOrder,
      },
    },
  });
  if (res.errors) throw new Error(`Shopify mutation error: ${JSON.stringify(res.errors)}`);
  const out = (res.data as { fulfillmentCreateV2?: { fulfillment?: { id: string }; userErrors?: Array<{ field: string[]; message: string }> } }).fulfillmentCreateV2;
  if (out?.userErrors && out.userErrors.length > 0) {
    throw new Error(`Fulfillment userErrors: ${out.userErrors.map((e) => e.message).join('; ')}`);
  }
  const id = out?.fulfillment?.id;
  if (!id) throw new Error('Shopify did not return a fulfillment id');
  return id;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → PASS. (Confirm `graphqlCall` is exported from `./client` with the `{shopDomain, apiVersion, token, query, variables}` signature.)

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/fulfillment.ts
git commit -m "feat(shopify-push): fulfillment-orders query + fulfillmentCreateV2 writer"
```

---

## Task 4: pushPackFulfillment action + shipPack integration

**Files:**
- Create: `features/packing/shopify-actions.ts`
- Modify: `features/packing/actions.ts`, `features/packing/queries.ts`

- [ ] **Step 1: Create the push action**

Create `features/packing/shopify-actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getStoreToken } from '@/lib/shopify/client';
import { getOrderFulfillmentOrders, createFulfillment } from '@/lib/shopify/fulfillment';
import { trackingCompany, buildFulfillmentLineItems } from './shopify-push';

async function requireManage(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
}

/** Push (or re-push) a pack's fulfillment to Shopify. Never throws on push
 *  failure — records status on the shipment so the UI can retry. */
export async function pushPackFulfillment(packId: string): Promise<void> {
  await requireManage();
  await pushPackFulfillmentInternal(packId);
  const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (s) revalidatePath(`/f/fulfillment/${s.orderId}`);
}

/** Core push (no auth/revalidate) — also called by shipPack after commit. */
export async function pushPackFulfillmentInternal(packId: string): Promise<void> {
  const [pack] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (!pack) return;
  if (pack.shopifyFulfillmentId) return; // idempotent: already pushed

  try {
    const [order] = await db.select({ id: schema.shopifyOrders.id, shopifyOrderId: schema.shopifyOrders.shopifyOrderId, storeId: schema.shopifyOrders.storeId })
      .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, pack.orderId)).limit(1);
    if (!order) throw new Error('Order not found');
    const [store] = await db.select({ shopDomain: schema.stores.shopDomain, apiVersion: schema.stores.apiVersion })
      .from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
    if (!store) throw new Error('Store not found');

    const lines = await db.select({ shopifyLineId: schema.orderFulfillmentLines.shopifyLineId, qty: schema.orderFulfillmentLines.qty })
      .from(schema.orderFulfillmentLines).where(eq(schema.orderFulfillmentLines.shipmentId, packId));

    const token = await getStoreToken(order.storeId);
    const storeRef = { shopDomain: store.shopDomain, apiVersion: store.apiVersion, token };

    const fos = await getOrderFulfillmentOrders({ store: storeRef, orderGid: order.shopifyOrderId });
    const mapped = buildFulfillmentLineItems(fos, lines);
    if (!mapped.ok) throw new Error(mapped.error);

    const fulfillmentId = await createFulfillment({
      store: storeRef,
      lineItemsByFulfillmentOrder: mapped.lineItemsByFulfillmentOrder,
      trackingCompany: trackingCompany(pack.carrierKey),
      trackingNumber: pack.trackingNumber ?? '',
      notifyCustomer: true,
    });

    await db.update(schema.shipments)
      .set({ shopifyFulfillmentId: fulfillmentId, shopifyPushStatus: 'pushed', shopifyPushError: null, shopifyPushedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));
  } catch (e) {
    await db.update(schema.shipments)
      .set({ shopifyPushStatus: 'failed', shopifyPushError: e instanceof Error ? e.message : String(e), updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));
  }
}
```

- [ ] **Step 2: Wire shipPack — pre-flight scope gate + after-commit push**

In `features/packing/actions.ts`:

Add imports at the top:
```ts
import { hasWriteFulfillmentsScope } from './shopify-push';
import { pushPackFulfillmentInternal } from './shopify-actions';
```

In `shipPack`, BEFORE the `await db.transaction(...)` call, add the pre-flight scope gate (load the pack's order → store scopes):
```ts
  const [scopeRow] = await db.select({ scopes: schema.stores.scopes })
    .from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shipments.id, packId)).limit(1);
  if (!scopeRow) throw new Error('Pack not found');
  if (!hasWriteFulfillmentsScope(scopeRow.scopes)) {
    throw new Error('Store chưa cấp scope write_fulfillments — cần re-install store trước khi ship');
  }
```

Inside the transaction, when updating the shipment with tracking, also set `shopifyPushStatus: 'pending'`:
```ts
    await tx.update(schema.shipments)
      .set({ trackingNumber: tn, labelCreatedAt: sql`now()`, shopifyPushStatus: 'pending', updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));
```

After the transaction commits (after the `recordAudit` try/catch, before/after the revalidatePath calls), add the push:
```ts
  await pushPackFulfillmentInternal(packId);
```
(`pushPackFulfillmentInternal` never throws — it records failure on the shipment for retry.)

Keep the existing `eq`/`innerJoin` imports available — add `innerJoin` to the `drizzle-orm` import in actions.ts if not already present.

- [ ] **Step 3: Add push fields to listPacksForOrder**

In `features/packing/queries.ts`, in `listPacksForOrder`'s pack select, add these fields to the selected columns:
```ts
    shopifyPushStatus: schema.shipments.shopifyPushStatus,
    shopifyPushError: schema.shipments.shopifyPushError,
    shopifyFulfillmentId: schema.shipments.shopifyFulfillmentId,
```

- [ ] **Step 4: Typecheck + regression**

Run: `npm run typecheck && npx vitest run features/packing lib/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/packing/shopify-actions.ts features/packing/actions.ts features/packing/queries.ts
git commit -m "feat(shopify-push): pushPackFulfillment + shipPack pre-flight scope gate"
```

---

## Task 5: UI — push status + retry in PackPanel

**Files:**
- Modify: `components/fulfillment/PackPanel.tsx`, `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`

- [ ] **Step 1: Extend PackPanel**

In `components/fulfillment/PackPanel.tsx`:

Add to the `Pack` type:
```ts
  shopifyPushStatus: 'pending' | 'pushed' | 'failed' | null;
  shopifyPushError: string | null;
```

Add the import:
```ts
import { pushPackFulfillment } from '@/features/packing/shopify-actions';
```

Inside the pack card's status badge row (next to the existing shipped badge), add a Shopify-push badge + retry. Place this right after the `{shipped && ...}` badge:
```tsx
                  {p.shopifyPushStatus === 'pushed' && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5">Đã đồng bộ Shopify</span>}
                  {p.shopifyPushStatus === 'pending' && <span className="rounded bg-muted text-muted-foreground px-2 py-0.5">Đang đẩy Shopify…</span>}
                  {p.shopifyPushStatus === 'failed' && (
                    <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5" title={p.shopifyPushError ?? ''}>Lỗi đẩy Shopify</span>
                  )}
```

And in the action row (the `{canManage && !shipped && (...)}` block already handles unshipped packs), add a SEPARATE block for a shipped-but-failed pack so ops can retry the push. Place it right after that existing block:
```tsx
              {canManage && shipped && p.shopifyPushStatus === 'failed' && (
                <div className="flex items-center gap-2">
                  <button disabled={isPending} onClick={() => startTransition(async () => { await pushPackFulfillment(p.id); })}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Push lại Shopify
                  </button>
                  {p.shopifyPushError && <span className="text-xs text-red-600 truncate max-w-xs">{p.shopifyPushError}</span>}
                </div>
              )}
```

- [ ] **Step 2: Pass the fields from the page**

In `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`, in the `packs={packs.map((p) => ({...}))}` mapping passed to `PackPanel`, add:
```ts
          shopifyPushStatus: p.shopifyPushStatus, shopifyPushError: p.shopifyPushError,
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/fulfillment/[orderId]/page.tsx" components/fulfillment/PackPanel.tsx
git commit -m "feat(shopify-push): push status badge + retry button in PackPanel"
```

---

## Task 6: Env scope + final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the scope**

In `.env.example`, change the `SHOPIFY_SCOPES` line to include `write_fulfillments` and add a note above it:
```bash
# NOTE: write_fulfillments is required to push fulfillments+tracking to Shopify
# (sub-project F1). Existing stores must RE-INSTALL to grant it, otherwise
# shipPack is blocked. Add new write scopes here and re-install affected stores.
SHOPIFY_SCOPES=read_shipping,read_checkout_branding,read_products,write_shipping,write_shop_settings,read_orders,write_fulfillments
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(shopify-push): require write_fulfillments scope (re-install)"
```

- [ ] **Step 3: Full regression**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS (incl. `features/packing/shopify-push.test.ts`).

- [ ] **Step 4: Manual verification (after deploy + migrate + store re-installed with write_fulfillments)**

1. A store WITHOUT the scope → shipping a pack is blocked with the re-install message; nothing ships.
2. Re-install the store (grants `write_fulfillments`) → ship a pack → Shopify order shows a fulfillment with the tracking number + carrier; the customer receives the tracking email; pack badge shows "Đã đồng bộ Shopify".
3. Ship a second pack of the same order → a second (partial) fulfillment appears on Shopify.
4. Force a failure (e.g. revoke token mid-test) → pack badge shows "Lỗi đẩy Shopify" with the error; "Push lại Shopify" retries and succeeds once fixed.

---

## Notes

- `fulfillmentCreateV2` + `Order.fulfillmentOrders` shapes are for Admin API 2025-01 (the pinned `SHOPIFY_API_VERSION`). Task 3 says to verify field names against Shopify docs before finalizing.
- Pre-flight scope gate blocks ship only when the scope is MISSING (a one-time per-store re-install). A runtime push failure (scope present, API error) does NOT block ship — the line is shipped internally and the push is retryable, matching the chosen "auto-push + manual retry" model.
- `pushPackFulfillmentInternal` is idempotent (skips when `shopifyFulfillmentId` is set) so re-ship/retry can't double-create a fulfillment.
- Out of scope: return/refund (F2), cron auto-retry, CX email (Phase 3).
```
