# Order Operations Phase 2 — MMP Brand Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a fulfillment line is out of stock, automatically push a per-line production request to MMP (signed HTTP POST), track it through a confirmation webhook (brand confirms + expected delivery date), and surface a follow-up worklist.

**Architecture:** Reuse the existing MMP HMAC helpers (`signMmpPayload` / `verifyMmpSignature`). A new `brand_order_requests` table (1:1 with out-of-stock fulfillment lines). Auto-send is wired into Phase 1's `checkStockForOrder` (create request in-tx, POST after commit). A confirmation webhook mirrors `/api/mmp/products`. Pure logic (payload build, confirmation apply, follow-up filter, rollup extension) stays in testable modules.

**Tech Stack:** Next.js (app router fork — read `node_modules/next/dist/docs/` before routes per AGENTS.md), Drizzle + Postgres, Better-Auth + RBAC, Vitest, Tailwind.

**Spec:** [docs/superpowers/specs/2026-06-09-order-ops-phase2-mmp-brand-requests-design.md](../specs/2026-06-09-order-ops-phase2-mmp-brand-requests-design.md)

**Environment:** Use `npx` (no pnpm). DB commands prefixed `DATABASE_URL="postgres://macos@localhost:5432/staging"`. `drizzle-kit generate` works (snapshot chain was repaired). Existing MMP HMAC: `features/mmp/hmac.ts` exports `signMmpPayload(secret, timestampSeconds, rawBody) -> "sha256=<hex>"` and `verifyMmpSignature({secret, rawBody, signatureHeader, timestampHeader, nowSeconds?})`. Headers: `x-mean-signature`, `x-mean-timestamp`.

---

## File Structure
- `db/schema.ts` — **modify**: extend `fulfillmentLineStatusEnum`; add 2 enums + `brandOrderRequests` table.
- `db/migrations/` — **generate**.
- `features/fulfillment/logic.ts` — **modify**: add brand statuses to `LineStatus`, `NEXT`, and `rollupOrderStatus`.
- `features/fulfillment/logic.test.ts` — **modify**: cover the rollup extension.
- `features/fulfillment/brand-logic.ts` — **create**: `buildBrandRequestPayload`, `applyConfirmation`, `isFollowUpDue` (pure).
- `features/fulfillment/brand-logic.test.ts` — **create**.
- `features/mmp/outbound.ts` — **create**: `sendBrandRequest`.
- `features/fulfillment/actions.ts` — **modify**: ensure+send brand requests during `checkStockForOrder`.
- `features/fulfillment/brand-actions.ts` — **create**: `resendBrandRequest`.
- `features/fulfillment/brand-queries.ts` — **create**: list brand requests / per-order.
- `app/api/mmp/order-confirmations/route.ts` — **create**: confirmation webhook.
- `app/(dashboard)/f/fulfillment/brand-requests/page.tsx` + `components/fulfillment/BrandRequestsTable.tsx` — **create**.
- `components/fulfillment/OrderDetailPanel.tsx` — **modify**: brand badges + resend.
- `.env.example` — **modify**: `MMP_OUTBOUND_URL`, `MMP_OUTBOUND_SECRET`.

---

## Task 1: Schema + migration

**Files:** Modify `db/schema.ts`; generate migration.

- [ ] **Step 1: Extend the line-status enum + add new enums + table**

In `db/schema.ts`, change `fulfillmentLineStatusEnum` to append the three brand statuses:
```typescript
export const fulfillmentLineStatusEnum = pgEnum('fulfillment_line_status', [
  'pending_check', 'in_stock', 'out_of_stock', 'picked', 'packed', 'shipped',
  'brand_requested', 'brand_confirmed', 'brand_rejected',
]);
```
Add near the other order/fulfillment tables:
```typescript
export const brandRequestSendStatusEnum = pgEnum('brand_request_send_status', ['pending', 'sent', 'failed']);
export const brandRequestConfirmStatusEnum = pgEnum('brand_request_confirm_status', ['awaiting', 'confirmed', 'rejected']);

/** One production request to a brand (via MMP) per out-of-stock line. */
export const brandOrderRequests = pgTable('brand_order_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentLineId: uuid('fulfillment_line_id')
    .references(() => orderFulfillmentLines.id, { onDelete: 'cascade' })
    .notNull().unique(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  brandSlug: text('brand_slug'),
  sku: text('sku'),
  qty: integer('qty').notNull(),
  sendStatus: brandRequestSendStatusEnum('send_status').notNull().default('pending'),
  sendAttempts: integer('send_attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at'),
  externalRef: text('external_ref'),
  confirmStatus: brandRequestConfirmStatusEnum('confirm_status').notNull().default('awaiting'),
  expectedDeliveryDate: date('expected_delivery_date'),
  note: text('note'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('brand_order_requests_confirm_idx').on(t.confirmStatus),
  index('brand_order_requests_order_idx').on(t.orderId),
]);
```
(`date` is already imported in db/schema.ts — verify.)

- [ ] **Step 2: Generate migration**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit generate`
Expected: a new `db/migrations/0041_*.sql` with `ALTER TYPE "fulfillment_line_status" ADD VALUE ...` (×3), 2 `CREATE TYPE`, 1 `CREATE TABLE`, FKs, indexes. Read it.

- [ ] **Step 3: Apply migration**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit migrate > /tmp/mig.log 2>&1; echo exit $?; cat /tmp/mig.log`
> Gotcha: PostgreSQL cannot run `ALTER TYPE ... ADD VALUE` inside a transaction in the same statement batch that then USES the value, but adding values alone is fine. If `migrate` errors on the ADD VALUE statements being in a transaction, split: run the three `ALTER TYPE ... ADD VALUE` lines via `psql "postgres://macos@localhost:5432/staging" -c "<each>"` individually (autocommit), then run the rest. If `migrate` hangs (tracking drift), apply the SQL manually in a psql transaction (the CREATE TYPE/TABLE parts) + the ADD VALUEs outside any tx, then register a tracking row (hash=sha256 of the .sql, created_at=the `when` of the 0041 journal entry; fix id sequence with setval then INSERT), as done for prior migrations.
Verify: `psql "postgres://macos@localhost:5432/staging" -tA -c "select count(*) from brand_order_requests;"` → `0`. And `psql "postgres://macos@localhost:5432/staging" -tA -c "select unnest(enum_range(null::fulfillment_line_status));"` shows the 3 new values.

- [ ] **Step 4: Verify generate is still a clean no-op (snapshot chain intact)**

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit generate` → expect "No schema changes, nothing to migrate".

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add db/schema.ts db/migrations/
git commit -m "feat(fulfillment): brand_order_requests schema + brand line statuses"
```

---

## Task 2: Extend Phase 1 pure logic for brand statuses

**Files:** Modify `features/fulfillment/logic.ts` + `features/fulfillment/logic.test.ts`.

- [ ] **Step 1: Add failing tests**

In `features/fulfillment/logic.test.ts`, inside the `rollupOrderStatus` describe block, add:
```typescript
  it('brand_requested rolls up to awaiting_brand', () => expect(roll(['brand_requested', 'in_stock'])).toBe('awaiting_brand'));
  it('brand_confirmed rolls up to awaiting_brand', () => expect(roll(['brand_confirmed', 'picked'])).toBe('awaiting_brand'));
  it('brand_rejected rolls up to awaiting_brand', () => expect(roll(['brand_rejected', 'shipped'])).toBe('awaiting_brand'));
```

- [ ] **Step 2: Run — verify the new cases fail (type/logic)**

Run: `npx vitest run features/fulfillment/logic.test.ts` → the brand cases fail (rollup returns wrong value) and/or tsc-level type error on the literals.

- [ ] **Step 3: Update `logic.ts`**

Change the `LineStatus` type to include the three new statuses:
```typescript
export type LineStatus = 'pending_check' | 'in_stock' | 'out_of_stock' | 'picked' | 'packed' | 'shipped'
  | 'brand_requested' | 'brand_confirmed' | 'brand_rejected';
```
In `rollupOrderStatus`, broaden the out-of-stock bucket to include brand states:
```typescript
  if (lines.some((s) => s === 'out_of_stock' || s === 'brand_requested' || s === 'brand_confirmed' || s === 'brand_rejected')) return 'awaiting_brand';
```
Add the three statuses to the `NEXT` map (no forward pick-flow transition — brand transitions are integration-driven, not via canTransitionLine):
```typescript
const NEXT: Record<LineStatus, LineStatus | null> = {
  pending_check: null, out_of_stock: null,
  in_stock: 'picked', picked: 'packed', packed: 'shipped', shipped: null,
  brand_requested: null, brand_confirmed: null, brand_rejected: null,
};
```

- [ ] **Step 4: Run — all pass**

Run: `npx vitest run features/fulfillment/logic.test.ts` → all pass. Also `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/logic.ts features/fulfillment/logic.test.ts
git commit -m "feat(fulfillment): brand statuses in rollup + line type"
```

---

## Task 3: Brand pure logic (payload, confirmation, follow-up) — TDD

**Files:** Create `features/fulfillment/brand-logic.ts` + `features/fulfillment/brand-logic.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `features/fulfillment/brand-logic.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { buildBrandRequestPayload, applyConfirmation, isFollowUpDue } from './brand-logic';

describe('buildBrandRequestPayload', () => {
  it('builds the MMP payload from a request + order number', () => {
    expect(buildBrandRequestPayload({ id: 'r1', brandSlug: 'denio', sku: 'A', qty: 2 }, '#1001')).toEqual({
      requestId: 'r1', orderNumber: '#1001', brandSlug: 'denio', sku: 'A', qty: 2,
    });
  });
});

describe('applyConfirmation', () => {
  it('confirmed -> sets confirm fields + line brand_confirmed', () => {
    expect(applyConfirmation({ status: 'confirmed', expectedDeliveryDate: '2026-07-01', note: 'ok' })).toEqual({
      confirmStatus: 'confirmed', expectedDeliveryDate: '2026-07-01', note: 'ok', lineStatus: 'brand_confirmed',
    });
  });
  it('rejected -> line brand_rejected, no delivery date', () => {
    expect(applyConfirmation({ status: 'rejected', note: 'out of capacity' })).toEqual({
      confirmStatus: 'rejected', expectedDeliveryDate: null, note: 'out of capacity', lineStatus: 'brand_rejected',
    });
  });
});

describe('isFollowUpDue', () => {
  it('confirmed + delivery date <= today is due', () => {
    expect(isFollowUpDue({ confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-09' }, '2026-06-09')).toBe(true);
  });
  it('confirmed + future date is not due', () => {
    expect(isFollowUpDue({ confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-20' }, '2026-06-09')).toBe(false);
  });
  it('not confirmed is never due', () => {
    expect(isFollowUpDue({ confirmStatus: 'awaiting', expectedDeliveryDate: null }, '2026-06-09')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails** (`npx vitest run features/fulfillment/brand-logic.test.ts`).

- [ ] **Step 3: Implement `brand-logic.ts`**
```typescript
/** Pure helpers for MMP brand requests — no DB, no I/O. */

export interface BrandRequestPayload {
  requestId: string; orderNumber: string; brandSlug: string | null; sku: string | null; qty: number;
}

export function buildBrandRequestPayload(
  req: { id: string; brandSlug: string | null; sku: string | null; qty: number },
  orderNumber: string,
): BrandRequestPayload {
  return { requestId: req.id, orderNumber, brandSlug: req.brandSlug, sku: req.sku, qty: req.qty };
}

export interface ConfirmationInput {
  status: 'confirmed' | 'rejected';
  expectedDeliveryDate?: string | null;
  note?: string | null;
}
export interface ConfirmationResult {
  confirmStatus: 'confirmed' | 'rejected';
  expectedDeliveryDate: string | null;
  note: string | null;
  lineStatus: 'brand_confirmed' | 'brand_rejected';
}

export function applyConfirmation(input: ConfirmationInput): ConfirmationResult {
  const confirmed = input.status === 'confirmed';
  return {
    confirmStatus: input.status,
    expectedDeliveryDate: confirmed ? (input.expectedDeliveryDate ?? null) : null,
    note: input.note ?? null,
    lineStatus: confirmed ? 'brand_confirmed' : 'brand_rejected',
  };
}

/** A request needs follow-up when confirmed and its delivery date has arrived. */
export function isFollowUpDue(
  req: { confirmStatus: string; expectedDeliveryDate: string | null },
  todayIso: string,
): boolean {
  return req.confirmStatus === 'confirmed'
    && req.expectedDeliveryDate !== null
    && req.expectedDeliveryDate <= todayIso;
}
```

- [ ] **Step 4: Run — all pass.**
- [ ] **Step 5: Commit**
```bash
git add features/fulfillment/brand-logic.ts features/fulfillment/brand-logic.test.ts
git commit -m "feat(fulfillment): pure brand payload/confirmation/follow-up logic"
```

---

## Task 4: Outbound MMP client

**Files:** Create `features/mmp/outbound.ts`; modify `.env.example`.

- [ ] **Step 1: Implement `outbound.ts`**
```typescript
/**
 * SMS → MMP outbound: POST a brand production request, signed with the same
 * HMAC scheme MMP uses inbound (`${timestamp}.${rawBody}`, header x-mean-signature).
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import { buildBrandRequestPayload } from '@/features/fulfillment/brand-logic';

export interface SendResult {
  ok: boolean;
  externalRef?: string;
  error?: string;
}

export async function sendBrandRequest(
  req: { id: string; brandSlug: string | null; sku: string | null; qty: number },
  orderNumber: string,
): Promise<SendResult> {
  const url = process.env.MMP_OUTBOUND_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return { ok: false, error: 'not configured' };
  if (!req.brandSlug) return { ok: false, error: 'no brand' };

  const rawBody = JSON.stringify(buildBrandRequestPayload(req, orderNumber));
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mean-signature': signature,
        'x-mean-timestamp': String(ts),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, externalRef: typeof data?.externalRef === 'string' ? data.externalRef : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}
```

- [ ] **Step 2: `.env.example`** — add under the MMP section:
```
# SMS → MMP outbound (brand production requests). MMP must expose a receiver
# that verifies the x-mean-signature HMAC with MMP_OUTBOUND_SECRET.
MMP_OUTBOUND_URL=
MMP_OUTBOUND_SECRET=
```

- [ ] **Step 3: Typecheck + commit**
```bash
npx tsc --noEmit
git add features/mmp/outbound.ts .env.example
git commit -m "feat(mmp): outbound brand-request client"
```

---

## Task 5: Auto-send wired into checkStockForOrder

**Files:** Modify `features/fulfillment/actions.ts`.

- [ ] **Step 1: Ensure a request row when a line goes out_of_stock (in-tx)**

In `checkStockForOrder` (inside the `db.transaction`), after a line is updated to `res.status`, when `res.status === 'out_of_stock'`, upsert a brand request row keyed by `fulfillmentLineId` (idempotent). Add this inside the per-line loop, right after the `tx.update(orderFulfillmentLines)...` call:
```typescript
if (res.status === 'out_of_stock') {
  await tx.insert(schema.brandOrderRequests)
    .values({ fulfillmentLineId: l.id, orderId, brandSlug: null, sku: l.sku, qty: l.qty })
    .onConflictDoNothing({ target: schema.brandOrderRequests.fulfillmentLineId });
}
```
(`orderId` is the action param. `brandSlug` is set during send in Step 2, resolved from the order line vendor.)

- [ ] **Step 2: After commit, send any pending requests for this order**

After `recomputeRollup`/the transaction block and before the `revalidatePath` calls in `checkStockForOrder`, add a post-commit send pass:
```typescript
  // Auto-send pending brand requests (fire after commit; failures are recorded, not thrown).
  await sendPendingBrandRequests(orderId);
```
Add this helper to `actions.ts` (it resolves brand from the order line vendor, builds the order number, sends, and records the outcome):
```typescript
import { sendBrandRequest } from '@/features/mmp/outbound';

async function sendPendingBrandRequests(orderId: string): Promise<void> {
  const [ord] = await db.select({ number: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  const orderNumber = ord?.number ?? '';
  const pending = await db.select().from(schema.brandOrderRequests)
    .where(and(eq(schema.brandOrderRequests.orderId, orderId), eq(schema.brandOrderRequests.sendStatus, 'pending')));
  for (const r of pending) {
    // Resolve brand from the order line vendor (best-effort).
    const [line] = await db.select({ vendor: schema.shopifyOrderLines.vendor })
      .from(schema.orderFulfillmentLines)
      .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
      .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId)).limit(1);
    const brandSlug = line?.vendor ?? null;
    const result = await sendBrandRequest({ id: r.id, brandSlug, sku: r.sku, qty: r.qty }, orderNumber);
    if (result.ok) {
      await db.update(schema.brandOrderRequests)
        .set({ brandSlug, sendStatus: 'sent', sentAt: sql`now()`, externalRef: result.externalRef ?? null,
               sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, lastError: null, updatedAt: sql`now()` })
        .where(eq(schema.brandOrderRequests.id, r.id));
      await db.update(schema.orderFulfillmentLines)
        .set({ status: 'brand_requested', updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId));
    } else {
      await db.update(schema.brandOrderRequests)
        .set({ brandSlug, sendStatus: 'failed', lastError: result.error ?? 'failed',
               sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, updatedAt: sql`now()` })
        .where(eq(schema.brandOrderRequests.id, r.id));
    }
  }
}
```
Ensure `and` is imported from `drizzle-orm` (add to the existing import). Note: when a line moves to `brand_requested`, the order rollup should reflect it — call `recomputeRollup` is already done pre-send; the line→brand_requested change happens post-send. That's acceptable (rollup buckets both out_of_stock and brand_requested into awaiting_brand, so the order status is identical either way — no re-rollup needed).

- [ ] **Step 2b: Re-check must not clobber brand progress**

In the `checkable` filter of `checkStockForOrder`, lines already in a `brand_*` status must NOT be re-checked back to out_of_stock. The current filter only includes `pending_check | out_of_stock | in_stock`, so `brand_requested|brand_confirmed|brand_rejected` are already excluded. Confirm this is the case and leave it.

- [ ] **Step 3: Typecheck + commit**
```bash
npx tsc --noEmit
git add features/fulfillment/actions.ts
git commit -m "feat(fulfillment): auto-create + send brand requests on out_of_stock"
```

---

## Task 6: Confirmation webhook

**Files:** Create `app/api/mmp/order-confirmations/route.ts`.

- [ ] **Step 1: Implement the route** (mirror `app/api/mmp/products/route.ts`)
```typescript
/**
 * POST /api/mmp/order-confirmations
 * MMP → SMS: brand confirms/rejects a production request + expected delivery date.
 * HMAC SHA-256 over `${timestamp}.${rawBody}` (x-mean-signature, x-mean-timestamp).
 * Body: { requestId, status: 'confirmed'|'rejected', expectedDeliveryDate?, note? }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { applyConfirmation } from '@/features/fulfillment/brand-logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret, rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  let body: { requestId?: string; status?: string; expectedDeliveryDate?: string | null; note?: string | null };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.requestId || (body.status !== 'confirmed' && body.status !== 'rejected')) {
    return NextResponse.json({ error: 'requestId + status(confirmed|rejected) required' }, { status: 400 });
  }

  const [reqRow] = await db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.id, body.requestId)).limit(1);
  if (!reqRow) return NextResponse.json({ error: 'request not found' }, { status: 404 });

  // Idempotent: if already in the target state, no-op.
  if (reqRow.confirmStatus === body.status) return NextResponse.json({ ok: true, idempotent: true });

  const applied = applyConfirmation({ status: body.status, expectedDeliveryDate: body.expectedDeliveryDate, note: body.note });
  await db.transaction(async (tx) => {
    await tx.update(schema.brandOrderRequests)
      .set({ confirmStatus: applied.confirmStatus, expectedDeliveryDate: applied.expectedDeliveryDate,
             note: applied.note, confirmedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, reqRow.id));
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: applied.lineStatus, updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, reqRow.fulfillmentLineId));
    await tx.insert(schema.orderFulfillmentEvents)
      .values({ fulfillmentId: sql`(select fulfillment_id from order_fulfillment_lines where id = ${reqRow.fulfillmentLineId})`,
                lineId: reqRow.fulfillmentLineId, fromStatus: 'brand_requested', toStatus: applied.lineStatus, actor: 'mmp-webhook' });
  });
  return NextResponse.json({ ok: true });
}
```
> If the `fulfillment_id` subquery in the event insert is awkward in Drizzle, first `select` the fulfillmentId in JS and pass it as a value. Keep behavior identical.

- [ ] **Step 2: Verify it compiles + a signed request updates state**

`npx tsc --noEmit` (0). Manual: with a seeded `brand_order_requests` row, POST a correctly-signed body (compute signature with `MMP_WEBHOOK_SECRET`) and confirm the row + line update; a bad signature → 401. (Can be a short tsx script against staging.)

- [ ] **Step 3: Commit**
```bash
git add "app/api/mmp/order-confirmations/route.ts"
git commit -m "feat(mmp): brand order-confirmation webhook"
```

---

## Task 7: Brand actions + queries

**Files:** Create `features/fulfillment/brand-actions.ts`, `features/fulfillment/brand-queries.ts`.

- [ ] **Step 1: `brand-actions.ts`** (RBAC `manage_fulfillment`)
```typescript
'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { sendBrandRequest } from '@/features/mmp/outbound';

async function requireManage(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
}

export async function resendBrandRequest(requestId: string): Promise<void> {
  await requireManage();
  const [r] = await db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.id, requestId)).limit(1);
  if (!r) throw new Error('Request not found');
  const [line] = await db.select({ vendor: schema.shopifyOrderLines.vendor, orderNumber: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, r.orderId))
    .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId)).limit(1);
  const brandSlug = line?.vendor ?? null;
  const result = await sendBrandRequest({ id: r.id, brandSlug, sku: r.sku, qty: r.qty }, line?.orderNumber ?? '');
  if (result.ok) {
    await db.update(schema.brandOrderRequests)
      .set({ brandSlug, sendStatus: 'sent', sentAt: sql`now()`, externalRef: result.externalRef ?? null,
             sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, lastError: null, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, r.id));
    await db.update(schema.orderFulfillmentLines).set({ status: 'brand_requested', updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId));
  } else {
    await db.update(schema.brandOrderRequests)
      .set({ brandSlug, sendStatus: 'failed', lastError: result.error ?? 'failed',
             sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, r.id));
  }
  revalidatePath('/f/fulfillment/brand-requests');
}
```

- [ ] **Step 2: `brand-queries.ts`**
```typescript
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listBrandRequests() {
  return db.select({
    id: schema.brandOrderRequests.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.brandOrderRequests.sku,
    qty: schema.brandOrderRequests.qty,
    sendStatus: schema.brandOrderRequests.sendStatus,
    confirmStatus: schema.brandOrderRequests.confirmStatus,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
    lastError: schema.brandOrderRequests.lastError,
    createdAt: schema.brandOrderRequests.createdAt,
  })
    .from(schema.brandOrderRequests)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .orderBy(desc(schema.brandOrderRequests.createdAt));
}

export async function listBrandRequestsForOrder(orderId: string) {
  return db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.orderId, orderId));
}
```

- [ ] **Step 3: Typecheck + commit**
```bash
npx tsc --noEmit
git add features/fulfillment/brand-actions.ts features/fulfillment/brand-queries.ts
git commit -m "feat(fulfillment): brand request resend action + queries"
```

---

## Task 8: UI — brand requests page + order-detail badges

**Files:** Create `app/(dashboard)/f/fulfillment/brand-requests/page.tsx` + `components/fulfillment/BrandRequestsTable.tsx`; modify `components/fulfillment/OrderDetailPanel.tsx`.

- [ ] **Step 1: Brand requests server page** (auth `view_fulfillment`, mirror the worklist page)

Create `app/(dashboard)/f/fulfillment/brand-requests/page.tsx`: auth gate, `listBrandRequests()`, render `<BrandRequestsTable rows={rows} canManage={hasPermission(role,'manage_fulfillment')} />`. Heading "Yêu cầu brand".

- [ ] **Step 2: `BrandRequestsTable.tsx`** (client)

`'use client'`. Props `{ rows; canManage }`. Filters: confirm status (`<select>` all/awaiting/confirmed/rejected) and a "Chỉ tới hạn follow-up" checkbox (use `isFollowUpDue(r, todayIso)` from `@/features/fulfillment/brand-logic`, with `todayIso = new Date().toISOString().slice(0,10)` computed in the client). Table: order#, brand, sku, qty, gửi (sendStatus badge), confirm (badge), ngày giao, lỗi; if `canManage` and sendStatus !== 'sent', a "Gửi lại" button → `resendBrandRequest(id)` in `useTransition`. Vietnamese labels. Mirror ReconcileTable styling. Empty state "Chưa có yêu cầu brand nào."

- [ ] **Step 3: Order-detail brand badges** (`components/fulfillment/OrderDetailPanel.tsx`)

The panel currently shows a red "Cần đặt brand" badge for `out_of_stock` lines. Extend the per-line render so that for `brand_requested`/`brand_confirmed`/`brand_rejected` it shows a status badge ("Đã gửi brand" / "Brand xác nhận · {expectedDeliveryDate}" / "Brand từ chối") instead. The panel receives lines from `getFulfillmentDetail`; extend that query (in `features/fulfillment/queries.ts`) to LEFT JOIN `brand_order_requests` (on fulfillmentLineId) and select `sendStatus`, `confirmStatus`, `expectedDeliveryDate`, brand request `id`. Add the brand badge cell + a "Gửi lại" button (canManage, when sendStatus === 'failed') calling `resendBrandRequest`. Add the nav nothing — this is within the existing detail page.

- [ ] **Step 4: Add a nav/link to the brand-requests page**

On the worklist page header (`app/(dashboard)/f/fulfillment/page.tsx`), add a `<Link href="/f/fulfillment/brand-requests">Yêu cầu brand</Link>` next to the existing "Kho MEAN" link.

- [ ] **Step 5: Typecheck + lint + commit**
```bash
npx tsc --noEmit
npm run lint   # 0 errors; escape literal quotes in JSX with &quot;
git add "app/(dashboard)/f/fulfillment/brand-requests/page.tsx" components/fulfillment/BrandRequestsTable.tsx components/fulfillment/OrderDetailPanel.tsx features/fulfillment/queries.ts "app/(dashboard)/f/fulfillment/page.tsx"
git commit -m "feat(fulfillment): brand requests page + order-detail brand badges"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` (0).
- [ ] **Step 2: Lint** — `npm run lint` (0 errors).
- [ ] **Step 3: Tests** — `npx vitest run features/fulfillment features/mmp lib/nav.test.ts` (all pass).
- [ ] **Step 4: Migration sanity** — `DATABASE_URL="postgres://macos@localhost:5432/staging" npx drizzle-kit generate` → "No schema changes". `... migrate` → clean.
- [ ] **Step 5: End-to-end smoke (staging + dev server)** — add a warehouse SKU shortfall so a real order line is `out_of_stock`; run "Check lại tồn"; confirm a `brand_order_requests` row is created (sendStatus `failed: not configured` if no MMP_OUTBOUND_URL set — acceptable). Seed a request, POST a signed confirmation to `/api/mmp/order-confirmations`, confirm the line → `brand_confirmed` + delivery date shows on the order detail and in the brand-requests follow-up filter.
- [ ] **Step 6: Final commit (if cleanup)** — `git add -A && git commit -m "chore(fulfillment): phase 2 verification" || echo "nothing to commit"`.
