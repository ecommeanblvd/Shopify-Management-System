# Làm chắc order push MMP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order push sang MMP có tracking trạng thái/đơn (sent/failed + lý do), cờ "đã đẩy" content-aware (payloadHash) để không phụ thuộc dedupe MMP, và retry tự động khi lỗi.

**Architecture:** Bảng `mmp_order_pushes` (1 dòng/đơn). `pushOrderToMmp` thay `sendOrderToMmp`: bỏ qua nếu đã sent + hash trùng; ghi pending trước khi POST; cập nhật sent/failed. Retry qua route cron + chèn vào script sync-orders hàng giờ. Badge + nút đẩy lại trên fulfillment.

**Tech Stack:** Next.js (server actions, route handlers, cron scripts tsx), Drizzle (migration tay + journal), Vitest, `crypto` (sha256), MMP HMAC (`signMmpBody`).

## Global Constraints

- Branch off `main` (đã có #190–#194). Migration kế tiếp **`0071`**, journal idx **71**.
- Migration **tay** (`.sql` + journal); **KHÔNG** chạy `db:migrate` cục bộ (DATABASE_URL=PRODUCTION; apply khi deploy).
- Chỉ đụng kênh **order push** (`sendOrderToMmp`/`/api/integration/orders`); KHÔNG đụng kênh brand-requests (`brand_order_requests`).
- Chưa cấu hình env (`MMP_ORDERS_URL`/`MMP_OUTBOUND_SECRET`) → KHÔNG POST, KHÔNG tạo state.
- Tái dùng `buildMmpOrderPayload`, `signMmpBody` — không viết lại payload.
- `maxAttempts = 5`. Cờ "đã đẩy" content-aware qua `payloadHash` (sha256 hex của rawBody).
- numeric/date đọc `Number(...)`; ghi enum bằng giá trị literal.

---

## Task 1: Schema — `mmp_order_pushes`

**Files:**
- Create: `db/migrations/0071_mmp-order-pushes.sql`
- Modify: `db/migrations/meta/_journal.json` (idx 71)
- Modify: `db/schema.ts` (enum + bảng)

**Interfaces — Produces:** enum `mmp_push_status` (`pending|sent|failed`); bảng `mmpOrderPushes` với `orderId` unique, `status`, `attempts`, `lastError`, `sentAt`, `externalRef`, `payloadHash`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Migration SQL** — `db/migrations/0071_mmp-order-pushes.sql`:
```sql
CREATE TYPE "mmp_push_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mmp_order_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "mmp_push_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp,
	"external_ref" text,
	"payload_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mmp_order_pushes_order_id_unique" UNIQUE("order_id")
);--> statement-breakpoint
ALTER TABLE "mmp_order_pushes" ADD CONSTRAINT "mmp_order_pushes_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mmp_order_pushes_status_idx" ON "mmp_order_pushes" ("status");
```

- [ ] **Step 2: Journal entry** — thêm vào cuối `entries` (phẩy sau idx 70):
```json
    {
      "idx": 71,
      "version": "7",
      "when": 1782564000000,
      "tag": "0071_mmp-order-pushes",
      "breakpoints": true
    }
```

- [ ] **Step 3: Schema** — `db/schema.ts`. Thêm enum cạnh `brandRequestSendStatusEnum` (line ~1696):
```ts
export const mmpPushStatusEnum = pgEnum('mmp_push_status', ['pending', 'sent', 'failed']);
```
Thêm bảng (gần các bảng mmp/fulfillment, sau `brandOrderRequests`):
```ts
/** Trạng thái đẩy MỖI đơn sang MMP (kênh orders) — cờ đã-đẩy + retry. 1 dòng/đơn. */
export const mmpOrderPushes = pgTable('mmp_order_pushes', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  status: mmpPushStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at'),
  externalRef: text('external_ref'),
  payloadHash: text('payload_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('mmp_order_pushes_status_idx').on(t.status),
]);
```
(Đảm bảo `pgEnum`, `integer`, `index` đã import — đều dùng nơi khác.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx eslint db/schema.ts`. KHÔNG db:migrate.

- [ ] **Step 5: Commit**
```bash
git add db/migrations/0071_mmp-order-pushes.sql db/migrations/meta/_journal.json db/schema.ts
git commit -m "feat(mmp): bảng mmp_order_pushes (tracking push order)"
```

---

## Task 2: Đơn vị thuần `order-push-state.ts`

**Files:**
- Create: `features/mmp/order-push-state.ts`
- Test: `features/mmp/order-push-state.test.ts`

**Interfaces — Produces:**
```ts
export type MmpPushStatus = 'pending' | 'sent' | 'failed';
export interface MmpPushState { status: MmpPushStatus; attempts: number; payloadHash: string | null }
export function hashOrderPayload(rawBody: string): string
export function shouldPushOrder(state: MmpPushState | null, currentHash: string): boolean
```
> Predicate retry (`status ∈ {pending,failed} ∧ attempts < max`) sống trong câu SQL của Task 4 — không tách helper riêng (tránh export thừa).

- [ ] **Step 1: Failing test** — `features/mmp/order-push-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashOrderPayload, shouldPushOrder } from './order-push-state';

describe('hashOrderPayload', () => {
  it('cùng input → cùng hash; khác → khác', () => {
    expect(hashOrderPayload('{"a":1}')).toBe(hashOrderPayload('{"a":1}'));
    expect(hashOrderPayload('{"a":1}')).not.toBe(hashOrderPayload('{"a":2}'));
    expect(hashOrderPayload('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('shouldPushOrder', () => {
  it('chưa có state → push', () => { expect(shouldPushOrder(null, 'h1')).toBe(true); });
  it('sent + hash trùng → KHÔNG push', () => {
    expect(shouldPushOrder({ status: 'sent', attempts: 1, payloadHash: 'h1' }, 'h1')).toBe(false);
  });
  it('sent + hash khác (nội dung đổi) → push', () => {
    expect(shouldPushOrder({ status: 'sent', attempts: 1, payloadHash: 'h1' }, 'h2')).toBe(true);
  });
  it('failed/pending → push', () => {
    expect(shouldPushOrder({ status: 'failed', attempts: 2, payloadHash: 'h1' }, 'h1')).toBe(true);
    expect(shouldPushOrder({ status: 'pending', attempts: 0, payloadHash: null }, 'h1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/mmp/order-push-state.test.ts`.

- [ ] **Step 3: Implement** — `features/mmp/order-push-state.ts`:
```ts
import { createHash } from 'crypto';

export type MmpPushStatus = 'pending' | 'sent' | 'failed';
export interface MmpPushState { status: MmpPushStatus; attempts: number; payloadHash: string | null }

/** sha256 hex của rawBody — phát hiện nội dung đơn đổi. THUẦN. */
export function hashOrderPayload(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** Có nên POST: chưa có state, HOẶC chưa sent, HOẶC sent nhưng nội dung đổi (hash khác). */
export function shouldPushOrder(state: MmpPushState | null, currentHash: string): boolean {
  if (!state) return true;
  if (state.status !== 'sent') return true;
  return state.payloadHash !== currentHash;
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npx eslint features/mmp/order-push-state.ts features/mmp/order-push-state.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/mmp/order-push-state.ts features/mmp/order-push-state.test.ts
git commit -m "feat(mmp): helper thuần shouldPushOrder/hashOrderPayload/isRetryable"
```

---

## Task 3: Push có tracking `pushOrderToMmp`

**Files:**
- Modify: `features/mmp/order-outbound.ts`
- Modify: `features/fulfillment/actions.ts` (caller kiểm kho)
- Modify: `features/mmp/order-backfill.ts` (caller backfill)

**Interfaces — Consumes:** `shouldPushOrder`/`hashOrderPayload` (T2); `mmpOrderPushes` (T1); `buildMmpOrderPayload`, `signMmpBody` (sẵn).
- Produces: `pushOrderToMmp(orderId: string): Promise<{ ok: boolean; skipped?: boolean; externalRef?: string; error?: string }>`.

- [ ] **Step 1: Refactor order-outbound.ts** — tách build-body khỏi gửi, thêm `pushOrderToMmp`. Thay phần thân `sendOrderToMmp` hiện có bằng:
```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { signMmpBody } from '@/features/mmp/hmac';
import { buildMmpOrderPayload, type MmpOrderLine } from '@/features/mmp/order-push-logic';
import { hashOrderPayload, shouldPushOrder } from '@/features/mmp/order-push-state';
import type { SendResult } from '@/features/mmp/outbound';

const BRAND_STATUSES = ['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected'];

/** Dựng rawBody MMP cho 1 đơn (đọc fulfillment + brand lines + order). Không POST. */
async function buildOrderMmpBody(orderId: string): Promise<{ rawBody: string } | { error: string }> {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return { error: 'no fulfillment' };
  const fLines = await db.select({
      sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status,
      title: schema.shopifyOrderLines.productTitle, vendor: schema.shopifyOrderLines.vendor,
    })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const brand = fLines.filter((l) => BRAND_STATUSES.includes(l.status as string));
  if (brand.length === 0) return { error: 'no brand lines' };
  const [ord] = await db.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipName: schema.shopifyOrders.shipName, shipCountry: schema.shopifyOrders.shipCountry,
      store: schema.stores.name,
    })
    .from(schema.shopifyOrders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  if (!ord) return { error: 'no order' };
  const brandLines: MmpOrderLine[] = brand.map((l) => ({ sku: l.sku, title: l.title ?? l.sku ?? '', qty: l.qty, vendor: l.vendor ?? null }));
  const rawBody = JSON.stringify(buildMmpOrderPayload({
    orderNumber: ord.orderNumber, store: ord.store, recipientName: ord.shipName, shipCountry: ord.shipCountry, brandLines,
  }));
  return { rawBody };
}

/** Đẩy đơn sang MMP CÓ TRACKING: bỏ qua nếu sent+hash trùng; ghi pending trước POST;
 *  cập nhật sent/failed. Idempotent phía mình (không phụ thuộc dedupe MMP). */
export async function pushOrderToMmp(orderId: string): Promise<{ ok: boolean; skipped?: boolean; externalRef?: string; error?: string }> {
  const url = process.env.MMP_ORDERS_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return { ok: false, error: 'not configured' };

  const built = await buildOrderMmpBody(orderId);
  if ('error' in built) return { ok: false, error: built.error };
  const payloadHash = hashOrderPayload(built.rawBody);

  const [state] = await db.select({ status: schema.mmpOrderPushes.status, attempts: schema.mmpOrderPushes.attempts, payloadHash: schema.mmpOrderPushes.payloadHash })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.orderId, orderId)).limit(1);
  if (!shouldPushOrder(state ?? null, payloadHash)) return { ok: true, skipped: true };

  // Ghi pending TRƯỚC khi POST (để cron retry được kể cả khi POST ném).
  await db.insert(schema.mmpOrderPushes)
    .values({ orderId, status: 'pending', payloadHash })
    .onConflictDoUpdate({ target: schema.mmpOrderPushes.orderId, set: { status: 'pending', payloadHash, updatedAt: sql`now()` } });

  const signature = signMmpBody(secret, built.rawBody);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature },
      body: built.rawBody, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await db.update(schema.mmpOrderPushes).set({ status: 'failed', attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, lastError: `http ${res.status}`, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
      return { ok: false, error: `http ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const externalRef = typeof data?.externalRef === 'string' ? data.externalRef : undefined;
    await db.update(schema.mmpOrderPushes).set({ status: 'sent', sentAt: sql`now()`, attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, externalRef: externalRef ?? null, lastError: null, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
    return { ok: true, externalRef };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    await db.update(schema.mmpOrderPushes).set({ status: 'failed', attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, lastError: msg, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
    return { ok: false, error: msg };
  }
}
```
> Giữ `sendOrderToMmp` export cũ HAY thay hẳn? → **Thay**: xoá `sendOrderToMmp`, đổi mọi import sang `pushOrderToMmp`. (Grep `sendOrderToMmp` để chắc chỉ còn 2 caller bên dưới.)

- [ ] **Step 2: Caller kiểm kho** — `features/fulfillment/actions.ts`: đổi `import { sendOrderToMmp }` → `import { pushOrderToMmp }`; đổi dòng `try { await sendOrderToMmp(orderId); } catch ...` → `try { await pushOrderToMmp(orderId); } catch (e) { console.error(...); }` (giữ best-effort).

- [ ] **Step 3: Caller backfill** — `features/mmp/order-backfill.ts`: đổi import + trong vòng lặp `const r = await pushOrderToMmp(oid);` và phân loại: `if (r.ok && !r.skipped) pushed++; else if (r.skipped || r.error === 'no brand lines' || r.error === 'not configured') skipped++; else failed++;`. (Giữ tham số `limit`/`total` đã có.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx eslint features/mmp/order-outbound.ts features/fulfillment/actions.ts features/mmp/order-backfill.ts` + `npm run build`. (Không unit test mới — I/O; helper đã test.)

- [ ] **Step 5: Commit**
```bash
git add features/mmp/order-outbound.ts features/fulfillment/actions.ts features/mmp/order-backfill.ts
git commit -m "feat(mmp): pushOrderToMmp có tracking (cờ đã-đẩy + payloadHash), thay sendOrderToMmp"
```

---

## Task 4: Retry — function + route cron + chèn vào sync-orders

**Files:**
- Create: `features/mmp/order-push-retry.ts`
- Create: `app/api/cron/retry-mmp-orders/route.ts`
- Modify: `scripts/cron/sync-shopify-orders.ts`

**Interfaces — Consumes:** `pushOrderToMmp` (T3), `mmpOrderPushes` (T1).
- Produces: `retryFailedMmpPushes(maxAttempts?: number): Promise<{ retried: number; recovered: number; stillFailing: number }>`.

- [ ] **Step 1: Retry function** — `features/mmp/order-push-retry.ts`:
```ts
import { and, inArray, lt } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';

const MAX_ATTEMPTS = 5;

/** Đẩy lại các đơn chưa sent còn lượt thử. Gọi từ cron. */
export async function retryFailedMmpPushes(maxAttempts: number = MAX_ATTEMPTS): Promise<{ retried: number; recovered: number; stillFailing: number }> {
  const rows = await db.select({ orderId: schema.mmpOrderPushes.orderId })
    .from(schema.mmpOrderPushes)
    .where(and(inArray(schema.mmpOrderPushes.status, ['pending', 'failed']), lt(schema.mmpOrderPushes.attempts, maxAttempts)));
  let recovered = 0, stillFailing = 0;
  for (const r of rows) {
    const res = await pushOrderToMmp(r.orderId);
    if (res.ok) recovered++;
    else stillFailing++;
  }
  return { retried: rows.length, recovered, stillFailing };
}
```

- [ ] **Step 2: HTTP cron route** — `app/api/cron/retry-mmp-orders/route.ts` (mirror `app/api/cron/sync-orders`):
```ts
import { NextResponse } from 'next/server';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const r = await retryFailedMmpPushes();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Chèn vào script sync-orders** — `scripts/cron/sync-shopify-orders.ts`, trong `main()` sau vòng log kết quả sync, thêm:
```ts
  try {
    const mmp = await retryFailedMmpPushes();
    process.stdout.write(`retry-mmp: retried ${mmp.retried}, recovered ${mmp.recovered}, stillFailing ${mmp.stillFailing}\n`);
  } catch (e) {
    process.stderr.write(`retry-mmp: ${e instanceof Error ? e.message : String(e)}\n`);
  }
```
và thêm import đầu file: `import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx eslint features/mmp/order-push-retry.ts "app/api/cron/retry-mmp-orders/route.ts" scripts/cron/sync-shopify-orders.ts` + `npm run build`.

- [ ] **Step 5: Commit**
```bash
git add features/mmp/order-push-retry.ts "app/api/cron/retry-mmp-orders/route.ts" scripts/cron/sync-shopify-orders.ts
git commit -m "feat(mmp): retry order push (route cron + chèn vào sync-orders hàng giờ)"
```

---

## Task 5: UI — badge trạng thái + nút "Đẩy lại MMP"

**Files:**
- Create: `features/mmp/order-push-query.ts` (đọc state + action resend)
- Create: `components/fulfillment/MmpPushBadge.tsx`
- Modify: trang chi tiết đơn fulfillment (`app/(dashboard)/f/fulfillment/[orderId]/page.tsx`)

**Interfaces — Consumes:** `mmpOrderPushes` (T1), `pushOrderToMmp` (T3).

- [ ] **Step 1: Query + resend action** — `features/mmp/order-push-query.ts`:
```ts
'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';

export interface MmpPushInfo { status: 'pending' | 'sent' | 'failed'; attempts: number; lastError: string | null; sentAt: Date | null }

export async function getMmpPushInfo(orderId: string): Promise<MmpPushInfo | null> {
  const [r] = await db.select({ status: schema.mmpOrderPushes.status, attempts: schema.mmpOrderPushes.attempts, lastError: schema.mmpOrderPushes.lastError, sentAt: schema.mmpOrderPushes.sentAt })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.orderId, orderId)).limit(1);
  return r ? { status: r.status, attempts: r.attempts, lastError: r.lastError, sentAt: r.sentAt } : null;
}

export async function resendOrderToMmp(orderId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
  await pushOrderToMmp(orderId);
  revalidatePath(`/f/fulfillment/${orderId}`);
}
```

- [ ] **Step 2: Badge component** — `components/fulfillment/MmpPushBadge.tsx` (`'use client'`): nhận `info: MmpPushInfo | null` + `orderId` + `canManage`. Render: `sent` → badge xanh "Đã đẩy MMP"; `failed`/`pending` → badge amber "Lỗi đẩy MMP" (title = lastError) + (nếu canManage) nút "Đẩy lại MMP" gọi `resendOrderToMmp(orderId)` qua `useTransition` + `router.refresh()`; `null` → không hiện. Import `resendOrderToMmp` từ `@/features/mmp/order-push-query`.

- [ ] **Step 3: Gắn vào trang chi tiết đơn** — trong `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`: gọi `const mmpPush = await getMmpPushInfo(orderId)` (orderId lấy như page hiện dùng) và render `<MmpPushBadge info={mmpPush} orderId={orderId} canManage={hasPermission(role, 'manage_fulfillment')} />` ở khu header/thông tin đơn. (Grep cấu trúc page để đặt đúng chỗ + lấy đúng biến `role`/`orderId`.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx eslint features/mmp/order-push-query.ts components/fulfillment/MmpPushBadge.tsx "app/(dashboard)/f/fulfillment/[orderId]/page.tsx"` + `npm run build`.

- [ ] **Step 5: Commit**
```bash
git add features/mmp/order-push-query.ts components/fulfillment/MmpPushBadge.tsx "app/(dashboard)/f/fulfillment/[orderId]/page.tsx"
git commit -m "feat(mmp): badge trạng thái đẩy MMP + nút đẩy lại trên đơn"
```

---

## Task 6: Verify toàn nhánh + PR

- [ ] **Step 1:** `npx tsc --noEmit` (sạch).
- [ ] **Step 2:** `npx vitest run` (toàn bộ pass — báo số).
- [ ] **Step 3:** `npm run build` (thành công).
- [ ] **Step 4:** Final whole-branch review (subagent-driven tự chạy).
- [ ] **Step 5:** Push + PR base `main`, body Summary + Test Plan: push ghi sent/failed; sent+hash trùng → bỏ qua; nội dung đổi → re-push; backfill bỏ qua sent; cron retry; badge + đẩy lại; migration 0071 apply khi deploy; cần set `CRON_SECRET` (đã có) cho route retry.

---

## Self-review notes
- Spec §1 schema → T1. §2 pure → T2. §3 pushOrderToMmp → T3. §4 backfill skip → T3 step 3. §5 retry → T4. §6 UI → T5. Verify+PR → T6.
- Type nhất quán: `shouldPushOrder`/`hashOrderPayload` (T2) dùng ở T3. Predicate retry sống trong SQL của T4 (không tách helper → tránh export thừa). `mmpOrderPushes` (T1) dùng T3/T4/T5. `pushOrderToMmp` (T3) dùng T4/T5.
- `sendOrderToMmp` bị THAY hoàn toàn → grep đảm bảo 0 caller sót.
- Migration 0071 KHÔNG chạy cục bộ.
