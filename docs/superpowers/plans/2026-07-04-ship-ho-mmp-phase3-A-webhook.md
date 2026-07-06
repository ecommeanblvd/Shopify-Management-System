# Ship hộ Phase 3 — Plan A: Webhook sender (SMS→MMP status events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SMS đẩy cập nhật vòng đời đơn ship hộ (trạng thái/giao hàng) cho MMP qua webhook ký HMAC, có outbox + retry, chỉ với đơn brand tạo (`source='mmp'`).

**Architecture:** Outbox `ship_ho_order_events` + core `mmp-events.ts` (`emitShipHoEvent` ghi outbox có gate + `deliverShipHoEvent` ký `signMmpPayload` rồi POST + `retryPendingShipHoEvents`). Emit được gọi tại các action lifecycle sẵn có (intake, tracking, track) + 2 nút MEAN (reject/needs-info). Cron mới retry pending.

**Tech Stack:** Next.js App Router (breaking-changes fork — đọc `node_modules/next/dist/docs/` nếu chạm API Next), Drizzle ORM (PostgreSQL), Vitest, HMAC (`features/mmp/hmac.ts` `signMmpPayload`).

## Global Constraints

- Chỉ đơn **`source='mmp'` và có `mmp_ref`** mới phát event; đơn nội bộ → no-op (không ghi outbox).
- Ký SMS→MMP: `signMmpPayload(secret, ts, rawBody)` (ký `${ts}.${rawBody}`), secret **`MMP_OUTBOUND_SECRET`**, URL **`MMP_SHIP_HO_WEBHOOK_URL`**, headers `x-mean-signature`/`x-mean-timestamp`. Chưa cấu hình env → deliver no-op (ghi outbox pending, cron gửi sau).
- Envelope: `{ event, mmpRef, code, occurredAt, data }`. `occurredAt` = ISO8601. Tiền VND nguyên đồng.
- **Payload trung tính** — không tên hãng, không cước gốc/margin/markup.
- Event Plan A (trạng thái): `order.received`, `shipment.booked`, `shipment.in_transit`, `shipment.delivered`, `shipment.exception`, `order.rejected`, `order.needs_info`. **KHÔNG** phát `order.priced`/`order.reconciled` ở plan này (cần công thức brand — đi cùng plan rebill).
- `emitShipHoEvent` best-effort: lỗi deliver KHÔNG làm hỏng action gọi nó (bọc try/catch, luôn ghi outbox trước).
- Migration kế tiếp: **0090** (viết tay SQL + append `db/migrations/meta/_journal.json`, KHÔNG `db:generate`).
- Trước push: `npx tsc --noEmit` + `npx vitest run` xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: DB — outbox `ship_ho_order_events`

**Files:**
- Create: `db/migrations/0090_ship-ho-order-events.sql`
- Modify: `db/schema.ts`, `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: bảng `shipHoOrderEvents` (Drizzle) + enum `ship_ho_event_status`.

- [ ] **Step 1: Migration SQL**

Tạo `db/migrations/0090_ship-ho-order-events.sql`:

```sql
CREATE TYPE "ship_ho_event_status" AS ENUM('pending', 'delivered', 'failed');

CREATE TABLE "ship_ho_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"mmp_ref" text NOT NULL,
	"code" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"delivery_status" "ship_ho_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "ship_ho_order_events" ADD CONSTRAINT "ship_ho_order_events_order_id_ship_ho_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ship_ho_orders"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "ship_ho_order_events_delivery_idx" ON "ship_ho_order_events" ("delivery_status");
CREATE INDEX "ship_ho_order_events_order_idx" ON "ship_ho_order_events" ("order_id");
```

- [ ] **Step 2: Schema Drizzle**

Trong `db/schema.ts`, thêm enum + bảng (đặt sau khối `shipHoOrders`; đảm bảo `jsonb`, `integer` đã import từ pg-core):

```ts
export const shipHoEventStatusEnum = pgEnum('ship_ho_event_status', ['pending', 'delivered', 'failed']);

export const shipHoOrderEvents = pgTable('ship_ho_order_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shipHoOrders.id).notNull(),
  mmpRef: text('mmp_ref').notNull(),
  code: text('code').notNull(),
  event: text('event').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  payload: jsonb('payload').notNull(),
  deliveryStatus: shipHoEventStatusEnum('delivery_status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 3: Append journal**

Trong `db/migrations/meta/_journal.json`, sau entry `0089...` thêm (chỉnh `idx`/`when` tăng dần):

```json
    },{
      "idx": 90,
      "version": "7",
      "when": 1783946400000,
      "tag": "0090_ship-ho-order-events",
      "breakpoints": true
```

Kiểm JSON hợp lệ: `node -e "JSON.parse(require('fs').readFileSync('db/migrations/meta/_journal.json','utf8'))"`.
*(Nếu idx cao nhất hiện tại không phải 89, dùng idx = max+1 và `when` > entry cuối.)*

- [ ] **Step 4: Type-check + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add db/migrations/0090_ship-ho-order-events.sql db/migrations/meta/_journal.json db/schema.ts
git commit -m "feat(ship-ho): migration outbox ship_ho_order_events (webhook SMS→MMP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `deliveryStatusToEvent` (thuần)

**Files:**
- Create: `features/ship-ho/mmp-events-map.ts`
- Test: `features/ship-ho/mmp-events-map.test.ts`

**Interfaces:**
- Produces: `deliveryStatusToEvent(deliveryStatus: string): 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception'`.

- [ ] **Step 1: Test thất bại**

Tạo `features/ship-ho/mmp-events-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deliveryStatusToEvent } from './mmp-events-map';

describe('deliveryStatusToEvent', () => {
  it('delivered → shipment.delivered', () => {
    expect(deliveryStatusToEvent('delivered')).toBe('shipment.delivered');
  });
  it('exception/failed/returned → shipment.exception', () => {
    expect(deliveryStatusToEvent('exception')).toBe('shipment.exception');
    expect(deliveryStatusToEvent('failure')).toBe('shipment.exception');
    expect(deliveryStatusToEvent('returned')).toBe('shipment.exception');
  });
  it('còn lại (in_transit/out_for_delivery/…) → shipment.in_transit', () => {
    expect(deliveryStatusToEvent('in_transit')).toBe('shipment.in_transit');
    expect(deliveryStatusToEvent('out_for_delivery')).toBe('shipment.in_transit');
    expect(deliveryStatusToEvent('anything')).toBe('shipment.in_transit');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/ship-ho/mmp-events-map.test.ts`.

- [ ] **Step 3: Implement**

Tạo `features/ship-ho/mmp-events-map.ts`:

```ts
/** THUẦN: map delivery status (tracking provider) → webhook event trung tính. */
export function deliveryStatusToEvent(
  deliveryStatus: string,
): 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception' {
  const s = deliveryStatus.trim().toLowerCase();
  if (s === 'delivered') return 'shipment.delivered';
  if (/(exception|fail|return|undeliver|refus|lost|damage)/.test(s)) return 'shipment.exception';
  return 'shipment.in_transit';
}
```

- [ ] **Step 4: PASS + Commit**

Run: `npx vitest run features/ship-ho/mmp-events-map.test.ts` → PASS.
```bash
git add features/ship-ho/mmp-events-map.ts features/ship-ho/mmp-events-map.test.ts
git commit -m "feat(ship-ho): deliveryStatusToEvent — map trạng thái giao → webhook event

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Core `mmp-events.ts` — emit + deliver + retry

**Files:**
- Create: `features/ship-ho/mmp-events.ts`
- Test: `features/ship-ho/mmp-events.test.ts`

**Interfaces:**
- Consumes: `signMmpPayload` (`@/features/mmp/hmac`); `db, schema`.
- Produces:
  - `type ShipHoEmitOrder = { id: string; code: string; source: string; mmpRef: string | null }`
  - `buildEnvelope(order, event, data, occurredAtIso): { event; mmpRef; code; occurredAt; data }` (thuần)
  - `emitShipHoEvent(order: ShipHoEmitOrder, event: string, data: Record<string, unknown>): Promise<void>`
  - `deliverShipHoEvent(row: { id; mmpRef; code; event; occurredAt: Date; payload: unknown; attempts: number }): Promise<void>`
  - `retryPendingShipHoEvents(): Promise<{ tried: number; delivered: number; failed: number }>`

- [ ] **Step 1: Test thất bại (phần thuần `buildEnvelope`)**

Tạo `features/ship-ho/mmp-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEnvelope } from './mmp-events';

describe('buildEnvelope', () => {
  it('đúng shape { event, mmpRef, code, occurredAt, data }', () => {
    const e = buildEnvelope(
      { id: 'o1', code: 'SH1000', source: 'mmp', mmpRef: 'MMP-1' },
      'shipment.booked', { trackingNumber: 'TN1' }, '2026-07-04T00:00:00.000Z',
    );
    expect(e).toEqual({
      event: 'shipment.booked', mmpRef: 'MMP-1', code: 'SH1000',
      occurredAt: '2026-07-04T00:00:00.000Z', data: { trackingNumber: 'TN1' },
    });
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/ship-ho/mmp-events.test.ts`.

- [ ] **Step 3: Implement**

Tạo `features/ship-ho/mmp-events.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';

export type ShipHoEmitOrder = { id: string; code: string; source: string; mmpRef: string | null };
const MAX_ATTEMPTS = 8;

/** THUẦN: dựng envelope webhook. */
export function buildEnvelope(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>, occurredAtIso: string,
) {
  return { event, mmpRef: order.mmpRef, code: order.code, occurredAt: occurredAtIso, data };
}

/** Ghi 1 event vào outbox (CHỈ đơn brand) rồi thử gửi ngay (best-effort). No-op cho đơn nội bộ. */
export async function emitShipHoEvent(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>,
): Promise<void> {
  if (order.source !== 'mmp' || !order.mmpRef) return;
  const now = new Date();
  let row;
  try {
    [row] = await db.insert(schema.shipHoOrderEvents).values({
      orderId: order.id, mmpRef: order.mmpRef, code: order.code, event,
      occurredAt: now, payload: data, deliveryStatus: 'pending', attempts: 0,
    }).returning();
  } catch (e) {
    console.warn('[ship-ho] emit outbox insert failed', event, order.code, e);
    return;
  }
  try { await deliverShipHoEvent(row); } catch (e) { console.warn('[ship-ho] deliver failed (sẽ retry)', event, order.code, e); }
}

/** Gửi 1 event tới MMP; cập nhật delivery_status/attempts. Không throw ra ngoài trừ lỗi lập trình. */
export async function deliverShipHoEvent(row: {
  id: string; mmpRef: string; code: string; event: string; occurredAt: Date; payload: unknown; attempts: number;
}): Promise<void> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return; // chưa cấu hình → để pending, cron gửi sau

  const envelope = {
    event: row.event, mmpRef: row.mmpRef, code: row.code,
    occurredAt: row.occurredAt.toISOString(), data: row.payload,
  };
  const rawBody = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);

  const attempts = row.attempts + 1;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature, 'x-mean-timestamp': String(ts) },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      await db.update(schema.shipHoOrderEvents)
        .set({ deliveryStatus: 'delivered', attempts, lastAttemptAt: new Date(), lastError: null })
        .where(eq(schema.shipHoOrderEvents.id, row.id));
      return;
    }
    throw new Error(`http ${res.status}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    await db.update(schema.shipHoOrderEvents)
      .set({ deliveryStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, lastAttemptAt: new Date(), lastError: msg })
      .where(eq(schema.shipHoOrderEvents.id, row.id));
  }
}

/** Cron: gửi lại các event chưa 'delivered' (pending/failed) dưới ngưỡng. */
export async function retryPendingShipHoEvents(): Promise<{ tried: number; delivered: number; failed: number }> {
  const rows = await db.select().from(schema.shipHoOrderEvents)
    .where(and(inArray(schema.shipHoOrderEvents.deliveryStatus, ['pending', 'failed'] as const)))
    .limit(200);
  let delivered = 0, failed = 0;
  for (const r of rows) {
    await deliverShipHoEvent({ id: r.id, mmpRef: r.mmpRef, code: r.code, event: r.event, occurredAt: r.occurredAt, payload: r.payload, attempts: r.attempts });
    const [after] = await db.select({ s: schema.shipHoOrderEvents.deliveryStatus }).from(schema.shipHoOrderEvents).where(eq(schema.shipHoOrderEvents.id, r.id)).limit(1);
    if (after?.s === 'delivered') delivered++; else if (after?.s === 'failed') failed++;
  }
  return { tried: rows.length, delivered, failed };
}
```

- [ ] **Step 4: PASS + tsc + Commit**

Run: `npx vitest run features/ship-ho/mmp-events.test.ts` → PASS. `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/mmp-events.ts features/ship-ho/mmp-events.test.ts
git commit -m "feat(ship-ho): mmp-events core — emit/deliver/retry webhook (outbox + gate source=mmp)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Emit `order.received` khi nhận đơn brand

**Files:**
- Modify: `features/ship-ho/brand-order-intake.ts`

**Interfaces:**
- Consumes: `emitShipHoEvent` (Task 3).

- [ ] **Step 1: Wire emit sau insert đơn mới**

Trong `intakeBrandOrder`, sau khi insert thành công và trước `return { ok: true, orderId: row.id, code, estimate: est.estimate }` (nhánh đơn MỚI, KHÔNG phải idempotent), thêm:

```ts
  await emitShipHoEvent(
    { id: row.id, code, source: 'mmp', mmpRef: input.mmpRef },
    'order.received', { chargedVnd: est.estimate.chargedVnd },
  );
```
Thêm import đầu file: `import { emitShipHoEvent } from './mmp-events';`
(KHÔNG emit ở nhánh idempotent/existing — tránh gửi trùng khi retry tạo đơn.)

- [ ] **Step 2: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/brand-order-intake.ts
git commit -m "feat(ship-ho): emit order.received khi nhận đơn brand mới

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Emit `shipment.booked` khi gán tracking

**Files:**
- Modify: `features/ship-ho/tracking-actions.ts`

**Interfaces:**
- Consumes: `emitShipHoEvent` (Task 3).

- [ ] **Step 1: Đọc hàm `setShipHoTracking` hiện tại**

Run: `sed -n '1,45p' features/ship-ho/tracking-actions.ts` — xác định biến order/select (cần `id, code, source, mmpRef` khi emit). Nếu select hiện chỉ lấy `status`, mở rộng select lấy thêm `id, code, source, mmpRef`.

- [ ] **Step 2: Wire emit sau khi cập nhật tracking**

Sau khi `db.update(...)` set trackingNumber (+status shipped) thành công, thêm (điều chỉnh tên biến theo Step 1):

```ts
  await emitShipHoEvent(
    { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
    'shipment.booked',
    { trackingNumber: tracking, service: o.service ?? 'express' },
  );
```
Thêm import: `import { emitShipHoEvent } from './mmp-events';`. Đảm bảo select ở đầu hàm lấy `id, code, source, mmpRef, service`.

- [ ] **Step 3: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/tracking-actions.ts
git commit -m "feat(ship-ho): emit shipment.booked khi gán tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Emit `shipment.in_transit`/`delivered` khi track

**Files:**
- Modify: `features/ship-ho/track.ts`

**Interfaces:**
- Consumes: `emitShipHoEvent` (Task 3), `deliveryStatusToEvent` (Task 2).

- [ ] **Step 1: Đọc `trackAndStoreShipHo`**

Run: `sed -n '20,55p' features/ship-ho/track.ts` — xác định select (cần `id, code, source, mmpRef` + `deliveredAt`) và chỗ update deliveryStatus.

- [ ] **Step 2: Wire emit sau update deliveryStatus**

Sau khi `db.update(...)` set `deliveryStatus` thành công, thêm (điều chỉnh biến; đảm bảo select lấy `id, code, source, mmpRef`):

```ts
  const evt = deliveryStatusToEvent(r.status);
  await emitShipHoEvent(
    { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
    evt,
    evt === 'shipment.delivered' ? { deliveredAt: (r.deliveredAt ?? new Date()).toISOString() } : {},
  );
```
Imports: `import { emitShipHoEvent } from './mmp-events';` + `import { deliveryStatusToEvent } from './mmp-events-map';`. Mở rộng select đầu hàm lấy `id, code, source, mmpRef`.

- [ ] **Step 3: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/track.ts
git commit -m "feat(ship-ho): emit shipment.in_transit/delivered khi track

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Nút MEAN reject / needs-info → emit

**Files:**
- Modify: `features/ship-ho/orders-actions.ts` (thêm 2 action)
- Modify: `app/(dashboard)/f/ship-ho/[id]/page.tsx` (+ component nút nếu cần)

**Interfaces:**
- Consumes: `emitShipHoEvent`, `requireManageShipHo`, `db, schema`.
- Produces: `rejectMmpOrder(orderId, reason)`, `requestInfoMmpOrder(orderId, reason, requiredFields?)`.

- [ ] **Step 1: Thêm 2 action**

Trong `features/ship-ho/orders-actions.ts`, thêm:

```ts
export async function rejectMmpOrder(orderId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [o] = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };
  await emitShipHoEvent({ id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef }, 'order.rejected', { reason });
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}

export async function requestInfoMmpOrder(orderId: string, reason: string, requiredFields?: string[]): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [o] = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };
  await emitShipHoEvent({ id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef }, 'order.needs_info', { reason, ...(requiredFields?.length ? { requiredFields } : {}) });
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}
```
Thêm import `emitShipHoEvent` vào file. (Các action chỉ emit event cho brand; không đổi status đơn ở v1 — MEAN xử lý status qua luồng hiện có.)

- [ ] **Step 2: Nút trên trang chi tiết (chỉ đơn mmp)**

Trong `app/(dashboard)/f/ship-ho/[id]/page.tsx`, khi `o.source === 'mmp'`, render 2 nút gọi 2 action (prompt nhập lý do). Tạo client component nhỏ `MmpOrderActions.tsx` cùng thư mục nếu cần state:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { rejectMmpOrder, requestInfoMmpOrder } from '@/features/ship-ho/orders-actions';

export function MmpOrderActions({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const doReject = () => { const r = prompt('Lý do từ chối?'); if (!r) return; start(async () => { const res = await rejectMmpOrder(orderId, r); setMsg(res.ok ? 'Đã gửi từ chối cho brand' : res.error ?? 'Lỗi'); }); };
  const doNeed = () => { const r = prompt('Cần bổ sung gì?'); if (!r) return; start(async () => { const res = await requestInfoMmpOrder(orderId, r); setMsg(res.ok ? 'Đã gửi yêu cầu bổ sung' : res.error ?? 'Lỗi'); }); };
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={doReject}>Từ chối</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={doNeed}>Cần bổ sung</Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
```
Import + render `{o.source === 'mmp' && <MmpOrderActions orderId={o.id} />}` ở khu vực action của trang.

- [ ] **Step 3: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/orders-actions.ts "app/(dashboard)/f/ship-ho/[id]"
git commit -m "feat(ship-ho): nút MEAN từ chối/cần-bổ-sung đơn brand → emit order.rejected/needs_info

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Cron retry

**Files:**
- Create: `app/api/cron/retry-ship-ho-events/route.ts`

**Interfaces:**
- Consumes: `retryPendingShipHoEvents` (Task 3).

- [ ] **Step 1: Route cron (mẫu `retry-mmp-orders`)**

Tạo `app/api/cron/retry-ship-ho-events/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const r = await retryPendingShipHoEvents();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Đăng ký lịch cron (nếu repo dùng vercel.json/cron config)**

Run: `grep -rn "retry-mmp-orders\|crons" vercel.json 2>/dev/null` — nếu có mảng `crons`, thêm entry `{ "path": "/api/cron/retry-ship-ho-events", "schedule": "*/10 * * * *" }`. Nếu repo không cấu hình cron kiểu này (không có file), bỏ qua — cron đăng ký ngoài code.

- [ ] **Step 3: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add "app/api/cron/retry-ship-ho-events" vercel.json 2>/dev/null || git add "app/api/cron/retry-ship-ho-events"
git commit -m "feat(ship-ho): cron retry-ship-ho-events — gửi lại webhook pending

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Verify + push

- [ ] **Step 1: tsc** — `npx tsc --noEmit` → PASS.
- [ ] **Step 2: full test** — `npx vitest run` → PASS (gồm `mmp-events`, `mmp-events-map`).
- [ ] **Step 3: push** — `git push -u origin feat/ship-ho-mmp-phase3` (chỉ khi xanh).

---

## Self-Review

**Spec coverage (A):**
- A1 outbox table → Task 1. ✅
- A2 emit helper (gate source=mmp) → Task 3. ✅
- A3 điểm phát: received (T4), booked (T5), in_transit/delivered (T6), rejected/needs_info (T7). ✅ Money events (priced/reconciled) DEFER plan rebill — ghi rõ Global Constraints. ✅
- Map deliveryStatus thuần → Task 2. ✅
- A4 deliver + retry cron → Task 3 + Task 8. ✅

**Placeholder scan:** không TBD; Task 5/6 Step 1 là khảo sát select có chủ đích (kèm lệnh). ✅

**Type consistency:**
- `emitShipHoEvent(order{id,code,source,mmpRef}, event, data)` dùng nhất quán T4/5/6/7. ✅
- `deliveryStatusToEvent(status)` (T2) dùng ở T6. ✅
- `retryPendingShipHoEvents()` (T3) dùng ở T8. ✅
- `shipHoOrderEvents` cột (T1) dùng ở T3. ✅
- Env `MMP_OUTBOUND_SECRET` / `MMP_SHIP_HO_WEBHOOK_URL` nhất quán T3. ✅
