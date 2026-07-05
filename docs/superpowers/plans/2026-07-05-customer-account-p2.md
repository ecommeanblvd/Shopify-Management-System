# Customer Account Builder P2 — data API (orders/timeline/loyalty/returns) + admin queue — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-07-05-customer-account-builder-design.md` §5–§6.

**Goal:** API extension đọc data customer (orders, timeline sanitized, loyalty, returns GET/POST) + admin Returns queue + Loyalty editor. Tái dùng `authenticateExtension` (P1), lifecycle `buildTimeline`.

**Architecture:** Query customer-scoped (storeId từ token + customerId từ token) qua expression index `shopify_orders`; timeline sanitize thuần (bỏ field nội bộ); returns/loyalty CRUD. Admin UI dưới `/f/customer-account/*`.

**Tech Stack:** Next.js App Router, Drizzle, Vitest.

## Global Constraints

- Data endpoint LỌC theo `storeId` (từ JWT `dest`) + `shopifyCustomerId` (từ JWT `sub`) — KHÔNG nhận id từ query (privacy, như P1).
- Timeline trả customer KHÔNG lộ field nội bộ: bỏ `exceptionNote`, `delayHours`, `deadline`, `delayStatus`, `exception`. Chỉ: mốc đã đạt (label + ngày) + stage hiện tại + stage kế.
- Return POST: verify order thuộc (store, customer) TRƯỚC khi tạo; chặn trùng request status='requested' cùng order.
- Admin RBAC: `view_functions` (xem) / `manage_functions` (đổi) — như P1.
- CORS + `authenticateExtension` tái dùng `app/api/customer-account/_shared.ts` (P1).
- customerId từ token là `sub` GID→numeric; nếu token không có `sub` (app thiếu scope read_customers) → data endpoint trả 403 `{error:'no customer in token'}`.

---

### Task 1: Query customer-scoped + timeline sanitize thuần + return guard thuần

**Files:**
- Create `features/customer-account/customer-queries.ts`
- Create `features/customer-account/public-timeline.ts` · Test `features/customer-account/public-timeline.test.ts`
- Create `features/customer-account/return-logic.ts` · Test `features/customer-account/return-logic.test.ts`

**Interfaces:**
- Consumes: `db, schema` (`@/db/client`); `buildTimeline` + `STAGE_LABELS` + `nextStage` + `type StageKey` + `fmtDuration` (`@/features/lifecycle/display`); `getLifecycle` (`@/features/lifecycle/queries`).
- Produces:
```ts
// public-timeline.ts (THUẦN)
export interface PublicTimeline {
  currentStage: string; currentStageLabel: string; nextStageLabel: string | null;
  steps: Array<{ label: string; at: string | null }>;   // mốc đã đạt, ISO date
}
export function toPublicTimeline(lc: {
  currentStage: string; syncedAt: Date | string | null;
  placedAt: Date | string | null; productionStartAt: Date | string | null; goodsReceivedAt: Date | string | null;
  qcPassAt: Date | string | null; packedAt: Date | string | null; shippedAt: Date | string | null;
  inTransitAt: Date | string | null; outForDeliveryAt: Date | string | null; deliveredAt: Date | string | null; completedAt: Date | string | null;
}): PublicTimeline;
// return-logic.ts (THUẦN)
export function canCreateReturn(existing: Array<{ orderId: string; status: string }>, orderId: string): { ok: true } | { ok: false; reason: 'duplicate' };
// customer-queries.ts
export async function listCustomerOrders(storeId: string, customerId: string): Promise<Array<{ orderId: string; orderNumber: string; placedAt: Date; total: string; currency: string; currentStage: string | null }>>;
export async function getCustomerOrderLifecycle(storeId: string, customerId: string, orderId: string): Promise<Awaited<ReturnType<typeof getLifecycle>> | null>; // null nếu đơn không thuộc customer
export async function getCustomerLoyalty(storeId: string, customerId: string): Promise<{ tier: string; note: string | null } | null>;
export async function listCustomerReturns(storeId: string, customerId: string): Promise<Array<{ id: string; orderId: string; orderNumber: string | null; reason: string; status: string; createdAt: Date }>>;
export async function createCustomerReturn(storeId: string, customerId: string, orderId: string, reason: string, note: string | null): Promise<{ ok: boolean; id?: string; error?: string }>;
```

- [ ] **Step 1: Test public-timeline (FAIL trước)**

```ts
// features/customer-account/public-timeline.test.ts
import { describe, it, expect } from 'vitest';
import { toPublicTimeline } from './public-timeline';

const base = {
  currentStage: 'shipped', syncedAt: '2026-03-20T00:00:00Z',
  placedAt: '2026-03-01T00:00:00Z', productionStartAt: null, goodsReceivedAt: null,
  qcPassAt: null, packedAt: '2026-03-10T00:00:00Z', shippedAt: '2026-03-12T00:00:00Z',
  inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
};
describe('toPublicTimeline', () => {
  it('chỉ mốc đã đạt (label+ngày), stage hiện tại + kế; KHÔNG field nội bộ', () => {
    const r = toPublicTimeline(base);
    expect(r.currentStage).toBe('shipped');
    expect(r.currentStageLabel.length).toBeGreaterThan(0);
    expect(r.nextStageLabel).not.toBeNull();
    expect(r.steps.map((s) => s.label).length).toBe(3); // placed, packed, shipped
    expect(JSON.stringify(r)).not.toMatch(/delay|deadline|exception/i);
  });
  it('đơn mới chỉ có placed', () => {
    const r = toPublicTimeline({ ...base, currentStage: 'placed', packedAt: null, shippedAt: null });
    expect(r.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: FAIL → implement public-timeline.ts**

```ts
// features/customer-account/public-timeline.ts
/** THUẦN: rút gọn lifecycle → timeline an toàn cho customer (bỏ field nội bộ). */
import { buildTimeline, STAGE_LABELS, nextStage, type Milestones } from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';

export interface PublicTimeline {
  currentStage: string; currentStageLabel: string; nextStageLabel: string | null;
  steps: Array<{ label: string; at: string | null }>;
}

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

export function toPublicTimeline(lc: { currentStage: string; syncedAt: Date | string | null } & Milestones): PublicTimeline {
  const stage = lc.currentStage as StageKey;
  const steps = buildTimeline(lc, lc.syncedAt).map((s) => ({ label: s.label, at: iso(s.at) }));
  const nx = nextStage(stage);
  return {
    currentStage: lc.currentStage,
    currentStageLabel: STAGE_LABELS[stage] ?? lc.currentStage,
    nextStageLabel: nx ? STAGE_LABELS[nx] : null,
    steps,
  };
}
```
(Kiểm `Milestones` export từ display.ts + có đủ field; nếu tên field lệch → chỉnh param type cho khớp `getLifecycle` row.)

- [ ] **Step 3: Test + implement return-logic.ts**

```ts
// features/customer-account/return-logic.test.ts
import { describe, it, expect } from 'vitest';
import { canCreateReturn } from './return-logic';
describe('canCreateReturn', () => {
  it('chưa có request → ok', () => { expect(canCreateReturn([], 'o1')).toEqual({ ok: true }); });
  it('đã có request "requested" cùng order → duplicate', () => {
    expect(canCreateReturn([{ orderId: 'o1', status: 'requested' }], 'o1')).toEqual({ ok: false, reason: 'duplicate' });
  });
  it('request cũ đã "rejected"/"refunded" cùng order → cho tạo lại', () => {
    expect(canCreateReturn([{ orderId: 'o1', status: 'rejected' }], 'o1')).toEqual({ ok: true });
  });
  it('request "requested" order khác → ok', () => {
    expect(canCreateReturn([{ orderId: 'o2', status: 'requested' }], 'o1')).toEqual({ ok: true });
  });
});
```
```ts
// features/customer-account/return-logic.ts
/** THUẦN: chặn tạo trùng return đang mở cùng 1 đơn. */
export function canCreateReturn(existing: Array<{ orderId: string; status: string }>, orderId: string): { ok: true } | { ok: false; reason: 'duplicate' } {
  const open = existing.some((r) => r.orderId === orderId && r.status === 'requested');
  return open ? { ok: false, reason: 'duplicate' } : { ok: true };
}
```

- [ ] **Step 4: customer-queries.ts** (query mỏng)

```ts
// features/customer-account/customer-queries.ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLifecycle } from '@/features/lifecycle/queries';
import { canCreateReturn } from './return-logic';

const customerIdExpr = sql`${schema.shopifyOrders.rawPayload}->'customer'->>'id'`;

export async function listCustomerOrders(storeId: string, customerId: string) {
  return db.select({
    orderId: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    placedAt: schema.shopifyOrders.createdAtShopify,
    total: schema.shopifyOrders.totalPrice,
    currency: schema.shopifyOrders.currency,
    currentStage: schema.orderLifecycle.currentStage,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(eq(schema.shopifyOrders.storeId, storeId), eq(customerIdExpr, customerId)))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));
}

async function orderBelongsToCustomer(storeId: string, customerId: string, orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.shopifyOrders.id }).from(schema.shopifyOrders)
    .where(and(eq(schema.shopifyOrders.id, orderId), eq(schema.shopifyOrders.storeId, storeId), eq(customerIdExpr, customerId))).limit(1);
  return !!row;
}

export async function getCustomerOrderLifecycle(storeId: string, customerId: string, orderId: string) {
  if (!(await orderBelongsToCustomer(storeId, customerId, orderId))) return null;
  return getLifecycle(orderId);
}

export async function getCustomerLoyalty(storeId: string, customerId: string) {
  const [row] = await db.select({ tier: schema.customerLoyalty.tier, note: schema.customerLoyalty.note })
    .from(schema.customerLoyalty)
    .where(and(eq(schema.customerLoyalty.storeId, storeId), eq(schema.customerLoyalty.shopifyCustomerId, customerId))).limit(1);
  return row ?? null;
}

export async function listCustomerReturns(storeId: string, customerId: string) {
  return db.select({
    id: schema.customerReturnRequests.id, orderId: schema.customerReturnRequests.orderId,
    orderNumber: schema.customerReturnRequests.orderNumber, reason: schema.customerReturnRequests.reason,
    status: schema.customerReturnRequests.status, createdAt: schema.customerReturnRequests.createdAt,
  })
    .from(schema.customerReturnRequests)
    .where(and(eq(schema.customerReturnRequests.storeId, storeId), eq(schema.customerReturnRequests.shopifyCustomerId, customerId)))
    .orderBy(desc(schema.customerReturnRequests.createdAt));
}

export async function createCustomerReturn(storeId: string, customerId: string, orderId: string, reason: string, note: string | null) {
  if (!reason?.trim()) return { ok: false, error: 'reason required' };
  if (!(await orderBelongsToCustomer(storeId, customerId, orderId))) return { ok: false, error: 'order not found' };
  const existing = await db.select({ orderId: schema.customerReturnRequests.orderId, status: schema.customerReturnRequests.status })
    .from(schema.customerReturnRequests)
    .where(and(eq(schema.customerReturnRequests.storeId, storeId), eq(schema.customerReturnRequests.shopifyCustomerId, customerId)));
  const guard = canCreateReturn(existing, orderId);
  if (!guard.ok) return { ok: false, error: 'Đã có yêu cầu đang xử lý cho đơn này' };
  const [order] = await db.select({ n: schema.shopifyOrders.shopifyOrderNumber }).from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  const [row] = await db.insert(schema.customerReturnRequests)
    .values({ storeId, orderId, shopifyCustomerId: customerId, orderNumber: order?.n ?? null, reason: reason.trim(), note: note?.trim() || null })
    .returning({ id: schema.customerReturnRequests.id });
  return { ok: true, id: row.id };
}
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run features/customer-account/public-timeline.test.ts features/customer-account/return-logic.test.ts` → PASS. `npx tsc --noEmit` → 0.
```bash
git add features/customer-account/customer-queries.ts features/customer-account/public-timeline.ts features/customer-account/public-timeline.test.ts features/customer-account/return-logic.ts features/customer-account/return-logic.test.ts
git commit -m "feat(customer-account): customer-scoped queries + timeline sanitize + return guard (thuần)"
```

---

### Task 2: 5 API route extension (orders/timeline/loyalty/returns GET+POST)

**Files:**
- Create `app/api/customer-account/orders/route.ts`
- Create `app/api/customer-account/orders/[orderId]/timeline/route.ts`
- Create `app/api/customer-account/loyalty/route.ts`
- Create `app/api/customer-account/returns/route.ts`
- Test `features/customer-account/routes-data-auth.test.ts`

**Interfaces:** Consumes `authenticateExtension`/`caJson`/`preflight` (`../_shared`, P1); T1 queries; `toPublicTimeline` (T1).

- [ ] **Step 1: Helper require-customer** — trong mỗi route: `authenticateExtension` → nếu Response trả luôn; nếu `customerId == null` → `caJson({error:'no customer in token'}, 403)`.

- [ ] **Step 2: routes**

```ts
// app/api/customer-account/orders/route.ts
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { listCustomerOrders } from '@/features/customer-account/customer-queries';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  return caJson({ orders: await listCustomerOrders(auth.store.id, auth.customerId) });
}
```
```ts
// app/api/customer-account/orders/[orderId]/timeline/route.ts
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../../../_shared';
import { getCustomerOrderLifecycle } from '@/features/customer-account/customer-queries';
import { toPublicTimeline } from '@/features/customer-account/public-timeline';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const { orderId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return caJson({ error: 'bad id' }, 400);
  const lc = await getCustomerOrderLifecycle(auth.store.id, auth.customerId, orderId);
  if (!lc) return caJson({ error: 'not found' }, 404);
  return caJson({ timeline: toPublicTimeline(lc) });
}
```
```ts
// app/api/customer-account/loyalty/route.ts
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { getCustomerLoyalty } from '@/features/customer-account/customer-queries';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  return caJson(await getCustomerLoyalty(auth.store.id, auth.customerId) ?? { tier: null });
}
```
```ts
// app/api/customer-account/returns/route.ts
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { listCustomerReturns, createCustomerReturn } from '@/features/customer-account/customer-queries';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  return caJson({ returns: await listCustomerReturns(auth.store.id, auth.customerId) });
}
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  let body: { orderId?: string; reason?: string; note?: string };
  try { body = await req.json(); } catch { return caJson({ error: 'invalid json' }, 400); }
  if (!body.orderId || !body.reason) return caJson({ error: 'orderId + reason required' }, 400);
  const r = await createCustomerReturn(auth.store.id, auth.customerId, body.orderId, body.reason, body.note ?? null);
  return caJson(r, r.ok ? 200 : 400);
}
```

- [ ] **Step 3: Test auth (không chạm DB)** — mirror `routes-auth.test.ts` P1: mỗi route OPTIONS→204+CORS, thiếu bearer→401+CORS. `beforeAll` set `CUSTOMER_ACCOUNT_APP_SECRETS`.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run features/customer-account/` PASS · `npx tsc --noEmit` 0 · `npx eslint app/api/customer-account` 0.
```bash
git add app/api/customer-account/orders app/api/customer-account/loyalty app/api/customer-account/returns features/customer-account/routes-data-auth.test.ts
git commit -m "feat(customer-account): API orders/timeline/loyalty/returns (customer-scoped từ token)"
```

---

### Task 3: Admin Returns queue

**Files:** Create `features/customer-account/returns-admin.ts` · Create `app/(dashboard)/f/customer-account/returns/page.tsx` · Create `app/(dashboard)/f/customer-account/returns/ReturnsTable.tsx`

**Interfaces:** Produces `listAdminReturns(filter)`, `updateReturnStatus(id, status, adminNote)` ('use server', guard manage_functions).

- [ ] **Step 1: `returns-admin.ts`**

`listAdminReturns({storeId?, status?})` → join stores.name + shopifyOrders.shopifyOrderNumber; trả id, storeName, orderNumber, shopifyCustomerId, reason, note, status, adminNote, createdAt. `RETURN_STATUSES = ['requested','approved','rejected','received','refunded']`. `updateReturnStatus(id, status, adminNote)` ('use server'): guard `requireManageFunctions()` (copy từ admin-actions.ts P1); validate status ∈ RETURN_STATUSES; update row set status/adminNote/updatedAt; `revalidatePath('/f/customer-account/returns')`; try/catch trả {ok:false,error}.

- [ ] **Step 2: Page + table** — RBAC `view_functions`; lọc store/status (searchParams); bảng request; mỗi dòng: select status + input adminNote + nút Lưu (gọi updateReturnStatus). Disable khi !canManage.

- [ ] **Step 3: Verify + commit** — `npx tsc --noEmit` 0 · eslint 0.
```bash
git add features/customer-account/returns-admin.ts "app/(dashboard)/f/customer-account/returns"
git commit -m "feat(customer-account): admin Returns queue (duyệt trạng thái đổi/trả)"
```

---

### Task 4: Admin Loyalty editor + sub-nav

**Files:** Create `features/customer-account/loyalty-admin.ts` · Create `app/(dashboard)/f/customer-account/loyalty/page.tsx` · Create `app/(dashboard)/f/customer-account/loyalty/LoyaltyEditor.tsx` · Modify `app/(dashboard)/f/customer-account/page.tsx` (thêm link tới returns + loyalty)

**Interfaces:** Produces `listLoyalty(storeId?)`, `upsertLoyalty(storeId, shopifyCustomerId, tier, note)`, `deleteLoyalty(id)` ('use server', guard manage_functions).

- [ ] **Step 1: `loyalty-admin.ts`** — `listLoyalty` (join stores.name, order updatedAt desc); `upsertLoyalty` (guard; validate tier non-empty + customerId numeric; onConflictDoUpdate theo (storeId, shopifyCustomerId) set tier/note/updatedAt); `deleteLoyalty` (guard; delete by id); mỗi cái revalidatePath + try/catch.

- [ ] **Step 2: Page + editor** — RBAC view_functions; chọn store; bảng tier hiện có + form thêm/sửa (shopifyCustomerId, tier, note); nút xoá. Disable khi !canManage.

- [ ] **Step 3: Sub-nav trên trang config chính** — trong `app/(dashboard)/f/customer-account/page.tsx` header, thêm 2 link: `<Link href="/f/customer-account/returns">Đổi/trả</Link>` + `<Link href="/f/customer-account/loyalty">Loyalty</Link>` (buttonVariants outline).

- [ ] **Step 4: Verify + commit** — `npx vitest run features/customer-account/` · `npx tsc --noEmit` 0 · eslint 0.
```bash
git add features/customer-account/loyalty-admin.ts "app/(dashboard)/f/customer-account/loyalty" "app/(dashboard)/f/customer-account/page.tsx"
git commit -m "feat(customer-account): admin Loyalty editor + sub-nav returns/loyalty"
```

---

## Self-Review (đã chạy)

- **Spec coverage P2 (§5 orders/timeline/loyalty/returns + §6 returns/loyalty admin):** T1 queries+sanitize ✓ · T2 5 route ✓ · T3 returns queue ✓ · T4 loyalty editor + sub-nav ✓.
- **Placeholder scan:** T1/T2 code đầy đủ; T3/T4 mô tả cấu trúc + interface cụ thể (admin UI theo pattern P1 ConfigEditor/Returns đã có mẫu).
- **Type consistency:** `toPublicTimeline` nhận lifecycle row shape của `getLifecycle`; `authenticateExtension` trả `{store, customerId}` (P1) dùng ở mọi route; `canCreateReturn` (T1) dùng trong `createCustomerReturn`; RETURN_STATUSES nhất quán route/admin.
- **Privacy:** mọi query customer-scoped (storeId+customerId từ token); `orderBelongsToCustomer` gate timeline + return-create — không cross-customer.
- **Rủi ro:** `Milestones` shape khớp getLifecycle (T1 kiểm); expression `customerIdExpr` so sánh text — customerId từ token là numeric string, khớp `raw_payload->customer->>id` (string); admin guard copy đúng P1.
