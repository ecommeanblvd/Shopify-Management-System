# Ship hộ Phase 3 — Plan C: Backfill GET Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MMP đồng bộ bù khi lỡ webhook: `GET /api/mmp/ship-ho/orders?updatedSince=<ISO>&brandSlug=` trả các đơn `source='mmp'` có thay đổi từ mốc, kèm trạng thái + data mới nhất.

**Architecture:** Dùng outbox `ship_ho_order_events` làm change-log — đơn có event `occurred_at >= updatedSince` = đơn đã đổi. Core thuần `mapOrderToBackfill(order)` + query I/O + endpoint HMAC (GET ký body rỗng).

**Tech Stack:** Next.js App Router, Drizzle ORM, Vitest, HMAC (`verifyMmpSignature`).

## Global Constraints

- HMAC vào: `verifyMmpSignature` + `MMP_WEBHOOK_SECRET`. **GET ký body rỗng**: MMP ký `${ts}.` (rawBody = `''`); SMS đọc `rawBody = await req.text()` (rỗng với GET) rồi verify — cùng cơ chế.
- Chỉ trả đơn `source='mmp'`. Shape mỗi đơn (§2a): `{ mmpRef, code, status, trackingNumber?, deliveryStatus?, deliveredAt?, chargedVnd? }`. Số tiền VND nguyên đồng; thời gian ISO8601. **Trung tính** — không tên hãng/margin.
- `updatedSince` bắt buộc, ISO8601 hợp lệ; sai → 400. `brandSlug` optional (lọc thêm). Limit 200, sort theo `created_at`.
- Đơn "đã đổi" = có ≥1 row trong `ship_ho_order_events` với `occurred_at >= updatedSince`.
- Trước push: `npx tsc --noEmit` + `npx vitest run` xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Core `mapOrderToBackfill` (thuần) + query + endpoint

**Files:**
- Create: `features/ship-ho/backfill.ts`
- Test: `features/ship-ho/backfill.test.ts`
- **Modify** (KHÔNG tạo mới): `app/api/mmp/ship-ho/orders/route.ts` — file này ĐÃ có `POST` (intake Phase 2). Thêm export `GET` vào cùng file (Next App Router cho phép nhiều method/route). GIỮ NGUYÊN `POST` + các export `runtime`/`dynamic` hiện có.

**Interfaces:**
- Consumes: `verifyMmpSignature`; `db, schema`; drizzle `and, eq, gte, inArray, desc`.
- Produces:
  - `interface BackfillOrder { mmpRef: string; code: string; status: string; trackingNumber?: string; deliveryStatus?: string; deliveredAt?: string; chargedVnd?: number }`
  - `mapOrderToBackfill(o: {...}): BackfillOrder` (thuần)
  - `getBackfillOrders(updatedSince: Date, brandSlug?: string): Promise<BackfillOrder[]>` (I/O)

- [ ] **Step 1: Test thất bại (phần thuần)**

Tạo `features/ship-ho/backfill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapOrderToBackfill } from './backfill';

describe('mapOrderToBackfill', () => {
  it('map field cơ bản; bỏ field null; số tiền → integer; thời gian → ISO', () => {
    const o = {
      mmpRef: 'MMP-1', code: 'SH1000', status: 'shipped',
      trackingNumber: 'TN1', deliveryStatus: 'in_transit',
      deliveredAt: new Date('2026-07-04T00:00:00.000Z'), chargedVnd: '189540',
    };
    expect(mapOrderToBackfill(o)).toEqual({
      mmpRef: 'MMP-1', code: 'SH1000', status: 'shipped',
      trackingNumber: 'TN1', deliveryStatus: 'in_transit',
      deliveredAt: '2026-07-04T00:00:00.000Z', chargedVnd: 189540,
    });
  });
  it('field null/undefined bị bỏ khỏi output', () => {
    const o = { mmpRef: 'MMP-2', code: 'SH1001', status: 'draft', trackingNumber: null, deliveryStatus: null, deliveredAt: null, chargedVnd: null };
    expect(mapOrderToBackfill(o)).toEqual({ mmpRef: 'MMP-2', code: 'SH1001', status: 'draft' });
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/ship-ho/backfill.test.ts`.

- [ ] **Step 3: Implement core**

Tạo `features/ship-ho/backfill.ts`:

```ts
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface BackfillOrder {
  mmpRef: string; code: string; status: string;
  trackingNumber?: string; deliveryStatus?: string; deliveredAt?: string; chargedVnd?: number;
}

/** THUẦN: map 1 đơn → shape backfill (bỏ field null, tiền→int, thời gian→ISO). */
export function mapOrderToBackfill(o: {
  mmpRef: string; code: string; status: string;
  trackingNumber?: string | null; deliveryStatus?: string | null; deliveredAt?: Date | null; chargedVnd?: string | null;
}): BackfillOrder {
  const r: BackfillOrder = { mmpRef: o.mmpRef, code: o.code, status: o.status };
  if (o.trackingNumber) r.trackingNumber = o.trackingNumber;
  if (o.deliveryStatus) r.deliveryStatus = o.deliveryStatus;
  if (o.deliveredAt) r.deliveredAt = o.deliveredAt.toISOString();
  if (o.chargedVnd != null) r.chargedVnd = Math.round(Number(o.chargedVnd));
  return r;
}

/** I/O: đơn source='mmp' có event occurred_at >= updatedSince (đã đổi). */
export async function getBackfillOrders(updatedSince: Date, brandSlug?: string): Promise<BackfillOrder[]> {
  const changed = await db.selectDistinct({ orderId: schema.shipHoOrderEvents.orderId })
    .from(schema.shipHoOrderEvents)
    .where(gte(schema.shipHoOrderEvents.occurredAt, updatedSince));
  const ids = changed.map((c) => c.orderId);
  if (ids.length === 0) return [];

  const conds = [eq(schema.shipHoOrders.source, 'mmp'), inArray(schema.shipHoOrders.id, ids)];
  if (brandSlug) conds.push(eq(schema.shipHoOrders.partnerBrandSlug, brandSlug));

  const rows = await db.select({
    mmpRef: schema.shipHoOrders.mmpRef, code: schema.shipHoOrders.code, status: schema.shipHoOrders.status,
    trackingNumber: schema.shipHoOrders.trackingNumber, deliveryStatus: schema.shipHoOrders.deliveryStatus,
    deliveredAt: schema.shipHoOrders.deliveredAt, chargedVnd: schema.shipHoOrders.chargedVnd,
  }).from(schema.shipHoOrders).where(and(...conds)).orderBy(desc(schema.shipHoOrders.createdAt)).limit(200);

  return rows.filter((r) => r.mmpRef).map((r) => mapOrderToBackfill({ ...r, mmpRef: r.mmpRef as string }));
}
```

- [ ] **Step 4: PASS + Endpoint**

Run: `npx vitest run features/ship-ho/backfill.test.ts` → PASS.

**MODIFY** `app/api/mmp/ship-ho/orders/route.ts` (đã có `POST`): thêm import `getBackfillOrders` từ `@/features/ship-ho/backfill`, và thêm export `GET` dưới đây vào cuối file. GIỮ NGUYÊN `POST`, `runtime`, `dynamic` hiện có (KHÔNG tạo lại file, KHÔNG đụng POST):

```ts
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });
  const rawBody = await req.text(); // '' cho GET
  const hmac = verifyMmpSignature({ secret, rawBody, signatureHeader: req.headers.get('x-mean-signature'), timestampHeader: req.headers.get('x-mean-timestamp') });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  const sinceRaw = req.nextUrl.searchParams.get('updatedSince');
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (!since || Number.isNaN(since.getTime())) return NextResponse.json({ error: 'updatedSince (ISO8601) required' }, { status: 400 });
  const brandSlug = req.nextUrl.searchParams.get('brandSlug') || undefined;

  const orders = await getBackfillOrders(since, brandSlug);
  return NextResponse.json({ ok: true, orders, count: orders.length });
}
```

- [ ] **Step 5: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/backfill.ts features/ship-ho/backfill.test.ts "app/api/mmp/ship-ho/orders/route.ts"
git commit -m "feat(ship-ho): backfill GET /api/mmp/ship-ho/orders (đồng bộ bù webhook)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Verify + push

- [ ] **Step 1: tsc** — `npx tsc --noEmit` → PASS.
- [ ] **Step 2: full test** — `npx vitest run` → PASS (gồm `backfill`).
- [ ] **Step 3: push** — `git push origin feat/ship-ho-mmp-phase3`.

---

## Self-Review

**Spec coverage (C):**
- C1 backfill GET (updatedSince + brandSlug, shape §2a, HMAC ký body rỗng) → Task 1. ✅
- Nguồn "đã đổi" = outbox events occurred_at >= since → Task 1 query. ✅

**Placeholder scan:** không TBD; code đầy đủ.

**Type consistency:**
- `mapOrderToBackfill(o) → BackfillOrder` (T1) test T1. ✅
- `getBackfillOrders(since, brandSlug?) → BackfillOrder[]` (T1) dùng ở route T1. ✅
- Route `app/api/mmp/ship-ho/orders/route.ts` ĐÃ có `POST` (intake Phase 2) → chỉ **thêm export GET** vào cùng file, GIỮ NGUYÊN POST. ✅
