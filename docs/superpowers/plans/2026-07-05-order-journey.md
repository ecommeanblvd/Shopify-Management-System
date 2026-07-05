# Order Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tái định vị trang full-page Customer Account Hub thành Order Journey — timeline giai đoạn từng đơn + hành động theo chính sách (cancel free / cancel 40% / claim 14 ngày / return đa hub / refund thủ công), theo spec `docs/superpowers/specs/2026-07-05-order-journey-design.md`.

**Architecture:** Policy engine thuần (một nơi duy nhất tính tiền, snapshot lúc submit) + bảng hợp nhất `customer_order_requests` (kind cancel|claim, một state machine) + 4 API extension (Bearer session token) + admin queue/hubs trong SMS + extension Preact render journey. Bảng `customer_return_requests` cũ (rỗng) bị thay thế và drop ở task cleanup cuối.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres, Vitest, Zod; extension: Preact + `@shopify/ui-extensions` (`s-*`), api_version 2026-04.

## Global Constraints

- **KHÔNG inline `'use server'`** per-function. Actions cho client component = file riêng có `'use server'` đầu file. Client component KHÔNG được import module có `@/db/client` — theo pattern 3 file `*-shared.ts` (const/type, không db) / `*-admin.ts` (query, server-only) / `*-actions.ts` ('use server') như `features/customer-account/returns-*.ts` hiện tại.
- **Trước khi push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` (next build THẬT) đều phải xanh** (bài học 2026-07-05: 9 deploy fail vì bỏ qua next build).
- Chính sách tiền (spec §2, KHÓA): free cancel đến khi có `order_lifecycle.production_confirmed_at`; sau đó đến trước `shipped_at` → fee 40% (refund 60%); sau ship không cancel; claim trong 14 ngày sau `delivered_at`; claim refund 100%; snapshot `order_total/refund_percent/refund_amount/currency` lúc tạo request, bất biến.
- Copy phía khách: **tiếng Anh**. Copy admin: tiếng Việt (theo style hiện có).
- Extension: chỉ dùng web components `s-*`; package `shopify-extension/` độc lập (KHÔNG đụng tsconfig/vitest root SMS); mỗi lệnh chạy trong `shopify-extension/` dùng `npm run typecheck` / `npm test` của package đó.
- Tiền tính bằng cents-integer rồi chia 100 (`Math.round(total * 100 * pct) / 100`), không nhân float trực tiếp.
- RBAC admin: `view_functions` xem, `manage_functions` thao tác — luôn qua `getRole()` + `hasPermission()` (KHÔNG query bảng roles trực tiếp).
- Migration: file kế tiếp `db/migrations/0090_order-journey.sql`; cleanup drop bảng cũ là `0091_drop-return-requests.sql`. Chạy local: `npm run db:migrate`.

## File Structure (mới/sửa chính)

```
features/customer-account/
  order-policy.ts            # Task 1 — policy engine thuần + types
  order-policy.test.ts
  request-status.ts          # Task 3 — state machine thuần (transitions)
  request-status.test.ts
  order-requests.ts          # Task 3 — domain logic (db): create/list/addTracking
  requests-shared.ts         # Task 8 — const/type client-safe cho admin UI
  requests-admin.ts          # Task 8 — admin queries
  requests-actions.ts        # Task 8 — 'use server' admin actions
  hubs-shared.ts / hubs-admin.ts / hubs-actions.ts   # Task 7
db/schema.ts                 # Task 2 — customerOrderRequests + returnHubs
db/migrations/0090_order-journey.sql                 # Task 2
db/migrations/0091_drop-return-requests.sql          # Task 10
app/api/customer-account/
  orders/[orderId]/journey/route.ts   # Task 4
  orders/[orderId]/requests/route.ts  # Task 5
  uploads/route.ts                    # Task 5
  requests/[id]/tracking/route.ts     # Task 5
app/(dashboard)/f/customer-account/
  hubs/page.tsx + HubsEditor.tsx      # Task 7
  requests/page.tsx + RequestsTable.tsx  # Task 8
shopify-extension/extensions/customer-account-hub/src/
  lib/journey-api.ts         # Task 9 — client gọi 4 API
  lib/journey-vm.ts          # Task 9 — view-model thuần + tests
  lib/journey-vm.test.ts
  Page.tsx                   # Task 9 — rewrite: list → detail → wizard
```

---

### Task 1: Policy engine thuần

**Files:**
- Create: `features/customer-account/order-policy.ts`
- Test: `features/customer-account/order-policy.test.ts`

**Interfaces:**
- Consumes: không gì (thuần).
- Produces: `evaluateOrderPolicy(input: PolicyInput): PolicyResult` và types:

```ts
export interface PolicyInput {
  placedAt: Date | null;
  productionConfirmedAt: Date | null;  // mốc brand confirm (order_lifecycle.production_confirmed_at)
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  orderTotal: string;                  // numeric string từ shopify_orders.total_price
  currency: string;
  hasOpenRequest: boolean;             // đơn đã có request chưa kết thúc
  now: Date;
}
export type CancelMode = 'free' | 'fee40' | null;
export interface PolicyResult {
  canCancel: CancelMode;
  canClaim: boolean;
  claimDeadline: Date | null;          // deliveredAt + 14d (null nếu chưa giao)
  refundPercent: 100 | 60;             // cho cancel (claim luôn 100)
  refundAmount: string;                // 2 số lẻ, ví dụ "158.39"
  feeAmount: string;                   // "0.00" khi free
}
export const CLAIM_WINDOW_DAYS = 14;
export function money(total: string, pct: number): string; // cents-safe, xuất "x.xx"
```

- [ ] **Step 1: Viết test fail** — `features/customer-account/order-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateOrderPolicy, money, CLAIM_WINDOW_DAYS } from './order-policy';

const base = {
  placedAt: new Date('2026-07-01T00:00:00Z'),
  productionConfirmedAt: null as Date | null,
  shippedAt: null as Date | null,
  deliveredAt: null as Date | null,
  cancelledAt: null as Date | null,
  orderTotal: '263.98',
  currency: 'USD',
  hasOpenRequest: false,
  now: new Date('2026-07-03T00:00:00Z'),
};

describe('money', () => {
  it('tính cents-safe', () => {
    expect(money('263.98', 0.6)).toBe('158.39'); // 26398*0.6=15838.8 → round 15839
    expect(money('263.98', 0.4)).toBe('105.59');
    expect(money('263.98', 1)).toBe('263.98');
    expect(money('0.10', 0.6)).toBe('0.06');
  });
});

describe('evaluateOrderPolicy — cancel', () => {
  it('chưa brand-confirm → free 100%', () => {
    const r = evaluateOrderPolicy(base);
    expect(r.canCancel).toBe('free');
    expect(r.refundPercent).toBe(100);
    expect(r.refundAmount).toBe('263.98');
    expect(r.feeAmount).toBe('0.00');
  });
  it('đã confirm, chưa ship → fee40, refund 60%', () => {
    const r = evaluateOrderPolicy({ ...base, productionConfirmedAt: new Date('2026-07-02T00:00:00Z') });
    expect(r.canCancel).toBe('fee40');
    expect(r.refundPercent).toBe(60);
    expect(r.refundAmount).toBe('158.39');
    expect(r.feeAmount).toBe('105.59');
  });
  it('đã ship → không cancel', () => {
    const r = evaluateOrderPolicy({ ...base, productionConfirmedAt: new Date('2026-07-02'), shippedAt: new Date('2026-07-02T12:00:00Z') });
    expect(r.canCancel).toBeNull();
  });
  it('đã cancelled hoặc có request mở → không cancel/claim', () => {
    expect(evaluateOrderPolicy({ ...base, cancelledAt: new Date() }).canCancel).toBeNull();
    const r = evaluateOrderPolicy({ ...base, hasOpenRequest: true });
    expect(r.canCancel).toBeNull();
    expect(r.canClaim).toBe(false);
  });
});

describe('evaluateOrderPolicy — claim', () => {
  const delivered = { ...base, productionConfirmedAt: new Date('2026-07-01'), shippedAt: new Date('2026-07-02'), deliveredAt: new Date('2026-07-03T00:00:00Z') };
  it('delivered trong 14 ngày → claim được, hết cancel', () => {
    const r = evaluateOrderPolicy({ ...delivered, now: new Date('2026-07-10T00:00:00Z') });
    expect(r.canClaim).toBe(true);
    expect(r.canCancel).toBeNull();
    expect(r.claimDeadline).toEqual(new Date('2026-07-17T00:00:00Z'));
  });
  it('đúng biên 14 ngày → còn claim; quá 1ms → hết', () => {
    const edge = new Date('2026-07-17T00:00:00Z');
    expect(evaluateOrderPolicy({ ...delivered, now: edge }).canClaim).toBe(true);
    expect(evaluateOrderPolicy({ ...delivered, now: new Date(edge.getTime() + 1) }).canClaim).toBe(false);
  });
  it('chưa delivered → không claim', () => {
    expect(evaluateOrderPolicy(base).canClaim).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy fail** — `npx vitest run features/customer-account/order-policy.test.ts` → FAIL (module chưa tồn tại).
- [ ] **Step 3: Implement** — `features/customer-account/order-policy.ts`:

```ts
/** THUẦN: policy engine Order Journey — NƠI DUY NHẤT tính quyền hành động + tiền refund.
 *  Chính sách khóa (spec 2026-07-05 §2): free cancel đến brand-confirm; sau đó fee 40%
 *  đến trước ship; claim 14 ngày sau delivered, refund 100%. Snapshot tiền do caller lưu. */

export const CLAIM_WINDOW_DAYS = 14;

export interface PolicyInput {
  placedAt: Date | null;
  productionConfirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  orderTotal: string;
  currency: string;
  hasOpenRequest: boolean;
  now: Date;
}
export type CancelMode = 'free' | 'fee40' | null;
export interface PolicyResult {
  canCancel: CancelMode;
  canClaim: boolean;
  claimDeadline: Date | null;
  refundPercent: 100 | 60;
  refundAmount: string;
  feeAmount: string;
}

/** Nhân tiền theo cents để tránh lỗi float; xuất chuỗi 2 số lẻ. */
export function money(total: string, pct: number): string {
  const cents = Math.round(Number(total) * 100);
  return (Math.round(cents * pct) / 100).toFixed(2);
}

export function evaluateOrderPolicy(i: PolicyInput): PolicyResult {
  const dead = i.deliveredAt
    ? new Date(i.deliveredAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 3600 * 1000)
    : null;
  const terminal = !!i.cancelledAt;
  const blocked = terminal || i.hasOpenRequest;

  let canCancel: CancelMode = null;
  if (!blocked && !i.shippedAt) canCancel = i.productionConfirmedAt ? 'fee40' : 'free';

  const canClaim = !blocked && !!i.deliveredAt && !!dead && i.now.getTime() <= dead.getTime();

  const refundPercent: 100 | 60 = canCancel === 'fee40' ? 60 : 100;
  return {
    canCancel,
    canClaim,
    claimDeadline: dead,
    refundPercent,
    refundAmount: money(i.orderTotal, refundPercent / 100),
    feeAmount: canCancel === 'fee40' ? money(i.orderTotal, 0.4) : '0.00',
  };
}
```

- [ ] **Step 4: Chạy pass** — `npx vitest run features/customer-account/order-policy.test.ts` → PASS toàn bộ.
- [ ] **Step 5: Commit** — `git add features/customer-account/order-policy.{ts,test.ts} && git commit -m "feat(order-journey): policy engine thuần (cancel free/fee40, claim 14d, tiền cents-safe)"`

---

### Task 2: Schema + migration 0090 (`customer_order_requests`, `return_hubs`)

**Files:**
- Modify: `db/schema.ts` (thêm 2 bảng SAU `customerLoyalty`; GIỮ NGUYÊN `customerReturnRequests` — drop ở Task 10)
- Create: `db/migrations/0090_order-journey.sql`

**Interfaces:**
- Produces: `schema.customerOrderRequests`, `schema.returnHubs` (drizzle) — cột đúng như SQL dưới.

- [ ] **Step 1: Thêm vào `db/schema.ts`:**

```ts
// ---------- Order Journey (spec 2026-07-05-order-journey-design.md §5) ----------
// Bảng HỢP NHẤT yêu cầu của khách trên một đơn: cancel | claim. Một state machine.
// Tiền snapshot lúc tạo (bất biến) — admin refund đúng một con số.
export const customerOrderRequests = pgTable('customer_order_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  orderNumber: text('order_number'),
  kind: text('kind').notNull(),                    // cancel | claim
  status: text('status').notNull(),                // xem features/customer-account/request-status.ts
  reasonCodes: text('reason_codes').array(),       // claim
  description: text('description'),
  photoKeys: text('photo_keys').array(),           // S3 keys, claim
  fault: text('fault'),                            // customer | mean — admin điền khi duyệt
  returnHubId: uuid('return_hub_id').references(() => returnHubs.id),
  returnShippingPayer: text('return_shipping_payer'), // customer | mean
  returnTrackingNumber: text('return_tracking_number'),
  returnCarrier: text('return_carrier'),
  orderTotal: numeric('order_total', { precision: 14, scale: 2 }).notNull(),
  refundPercent: integer('refund_percent').notNull(), // 100 | 60
  refundAmount: numeric('refund_amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  adminNote: text('admin_note'),
  rejectedReason: text('rejected_reason'),
  reviewedAt: timestamp('reviewed_at'),
  approvedAt: timestamp('approved_at'),
  trackingAddedAt: timestamp('tracking_added_at'),
  receivedAt: timestamp('received_at'),
  qcAt: timestamp('qc_at'),
  refundedAt: timestamp('refunded_at'),
  refundedMarkedBy: text('refunded_marked_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('customer_order_requests_store_status_idx').on(t.storeId, t.status),
  index('customer_order_requests_order_idx').on(t.orderId),
  index('customer_order_requests_customer_idx').on(t.storeId, t.shopifyCustomerId),
]);

// Danh mục hub nhận hàng return (US / Middle East / VN…). Operation chọn hub khi duyệt claim.
export const returnHubs = pgTable('return_hubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(),                  // "US Hub"
  recipientName: text('recipient_name').notNull(),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country').notNull(),              // ISO alpha-2, vd "US"
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

Lưu ý: `returnHubs` phải khai báo TRƯỚC `customerOrderRequests` trong file (tham chiếu FK) — hoặc dùng arrow ref như pattern hiện có (`references(() => returnHubs.id)` cho phép mọi thứ tự; giữ như trên là được).

- [ ] **Step 2: Viết `db/migrations/0090_order-journey.sql`:**

```sql
-- Order Journey (spec 2026-07-05): bảng hợp nhất cancel/claim + danh mục hub return.
CREATE TABLE IF NOT EXISTS return_hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  recipient_name text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text,
  postal_code text,
  country text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  shopify_customer_id text NOT NULL,
  order_number text,
  kind text NOT NULL,
  status text NOT NULL,
  reason_codes text[],
  description text,
  photo_keys text[],
  fault text,
  return_hub_id uuid REFERENCES return_hubs(id),
  return_shipping_payer text,
  return_tracking_number text,
  return_carrier text,
  order_total numeric(14,2) NOT NULL,
  refund_percent integer NOT NULL,
  refund_amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  admin_note text,
  rejected_reason text,
  reviewed_at timestamp,
  approved_at timestamp,
  tracking_added_at timestamp,
  received_at timestamp,
  qc_at timestamp,
  refunded_at timestamp,
  refunded_marked_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_order_requests_store_status_idx ON customer_order_requests(store_id, status);
CREATE INDEX IF NOT EXISTS customer_order_requests_order_idx ON customer_order_requests(order_id);
CREATE INDEX IF NOT EXISTS customer_order_requests_customer_idx ON customer_order_requests(store_id, shopify_customer_id);
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` xanh; `npm run db:migrate` local chạy OK (migration idempotent `IF NOT EXISTS`).
- [ ] **Step 4: Commit** — `git commit -m "feat(order-journey): schema + migration 0090 (customer_order_requests, return_hubs)"`

---

### Task 3: State machine + domain logic requests

**Files:**
- Create: `features/customer-account/request-status.ts` (+ test)
- Create: `features/customer-account/order-requests.ts`

**Interfaces:**
- Consumes: `evaluateOrderPolicy`, `money` (Task 1); `schema.customerOrderRequests` (Task 2); `getCustomerOrderLifecycle`-style privacy gate (viết lại nội bộ bằng `customerIdExpr` như `features/customer-account/customer-queries.ts:8`).
- Produces:

```ts
// request-status.ts (THUẦN)
export type RequestKind = 'cancel' | 'claim';
export type RequestStatus = 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'return_in_transit' | 'received' | 'refund_pending' | 'refunded';
export const OPEN_STATUSES: RequestStatus[];       // tất cả trừ 'rejected' | 'refunded'
export function canTransition(kind: RequestKind, from: RequestStatus, to: RequestStatus): boolean;
export const CLAIM_REASONS = ['damaged_package','damaged_product','wrong_item','wrong_size','missing_item','other'] as const;

// order-requests.ts (db)
export async function getOrderJourney(storeId: string, customerId: string, orderId: string):
  Promise<null | { lifecycle: {...getLifecycle row}; policy: PolicyResult; requests: RequestRow[] }>;
export async function createOrderRequest(storeId, customerId, orderId, input:
  { kind: 'cancel' } | { kind: 'claim'; reasonCodes: string[]; description: string; photoKeys: string[] }):
  Promise<{ ok: true; id: string } | { ok: false; error: string }>;
export async function addReturnTracking(storeId, customerId, requestId, carrier: string, tracking: string):
  Promise<{ ok: boolean; error?: string }>;
```

- [ ] **Step 1: Test state machine** — `features/customer-account/request-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canTransition, OPEN_STATUSES } from './request-status';

describe('canTransition', () => {
  it('cancel: chỉ refund_pending → refunded', () => {
    expect(canTransition('cancel', 'refund_pending', 'refunded')).toBe(true);
    expect(canTransition('cancel', 'submitted', 'approved')).toBe(false);
  });
  it('claim: luồng chuẩn', () => {
    expect(canTransition('claim', 'submitted', 'under_review')).toBe(true);
    expect(canTransition('claim', 'submitted', 'approved')).toBe(true);     // skip review
    expect(canTransition('claim', 'submitted', 'rejected')).toBe(true);
    expect(canTransition('claim', 'under_review', 'approved')).toBe(true);
    expect(canTransition('claim', 'approved', 'return_in_transit')).toBe(true); // khách nhập tracking
    expect(canTransition('claim', 'return_in_transit', 'received')).toBe(true);
    expect(canTransition('claim', 'received', 'refund_pending')).toBe(true);    // QC pass
    expect(canTransition('claim', 'received', 'rejected')).toBe(true);          // QC fail
    expect(canTransition('claim', 'refund_pending', 'refunded')).toBe(true);
  });
  it('chặn nhảy bậy', () => {
    expect(canTransition('claim', 'approved', 'refunded')).toBe(false);
    expect(canTransition('claim', 'rejected', 'approved')).toBe(false);
  });
  it('OPEN_STATUSES không chứa trạng thái kết thúc', () => {
    expect(OPEN_STATUSES).not.toContain('rejected');
    expect(OPEN_STATUSES).not.toContain('refunded');
  });
});
```

- [ ] **Step 2: Chạy fail rồi implement `request-status.ts`:**

```ts
/** THUẦN: state machine của customer_order_requests (spec §5). */
export type RequestKind = 'cancel' | 'claim';
export type RequestStatus = 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'return_in_transit' | 'received' | 'refund_pending' | 'refunded';

export const CLAIM_REASONS = ['damaged_package', 'damaged_product', 'wrong_item', 'wrong_size', 'missing_item', 'other'] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];

const TERMINAL: RequestStatus[] = ['rejected', 'refunded'];
export const OPEN_STATUSES: RequestStatus[] =
  ['submitted', 'under_review', 'approved', 'return_in_transit', 'received', 'refund_pending'];

const CLAIM_EDGES: Record<RequestStatus, RequestStatus[]> = {
  submitted: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['return_in_transit'],
  return_in_transit: ['received'],
  received: ['refund_pending', 'rejected'],   // QC pass | fail
  refund_pending: ['refunded'],
  rejected: [], refunded: [],
};
const CANCEL_EDGES: Record<RequestStatus, RequestStatus[]> = {
  refund_pending: ['refunded'],
  submitted: [], under_review: [], approved: [], return_in_transit: [], received: [], rejected: [], refunded: [],
};

export function canTransition(kind: RequestKind, from: RequestStatus, to: RequestStatus): boolean {
  if (TERMINAL.includes(from)) return false;
  return (kind === 'cancel' ? CANCEL_EDGES : CLAIM_EDGES)[from]?.includes(to) ?? false;
}
```

- [ ] **Step 3: Implement `order-requests.ts`** (domain, dùng db):

```ts
/** Domain logic Order Journey (db): journey + tạo request + tracking.
 *  Server LUÔN re-check policy — không tin client. Tiền snapshot tại đây. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { evaluateOrderPolicy, type PolicyResult } from './order-policy';
import { CLAIM_REASONS, OPEN_STATUSES, canTransition, type RequestStatus } from './request-status';

const customerIdExpr = sql`${schema.shopifyOrders.rawPayload}->'customer'->>'id'`;

async function loadOrderForCustomer(storeId: string, customerId: string, orderId: string) {
  const [row] = await db.select({
    id: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    totalPrice: schema.shopifyOrders.totalPrice,
    currency: schema.shopifyOrders.currency,
    lc: schema.orderLifecycle,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(
      eq(schema.shopifyOrders.id, orderId),
      eq(schema.shopifyOrders.storeId, storeId),
      eq(customerIdExpr, customerId),
    ))
    .limit(1);
  return row ?? null;
}

export async function listOrderRequests(storeId: string, orderId: string) {
  return db.select().from(schema.customerOrderRequests)
    .where(and(eq(schema.customerOrderRequests.storeId, storeId), eq(schema.customerOrderRequests.orderId, orderId)))
    .orderBy(desc(schema.customerOrderRequests.createdAt));
}

async function hasOpenRequest(storeId: string, orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.customerOrderRequests.id })
    .from(schema.customerOrderRequests)
    .where(and(
      eq(schema.customerOrderRequests.storeId, storeId),
      eq(schema.customerOrderRequests.orderId, orderId),
      inArray(schema.customerOrderRequests.status, OPEN_STATUSES),
    )).limit(1);
  return !!row;
}

export async function getOrderJourney(storeId: string, customerId: string, orderId: string) {
  const order = await loadOrderForCustomer(storeId, customerId, orderId);
  if (!order) return null;
  const open = await hasOpenRequest(storeId, orderId);
  const policy = evaluateOrderPolicy({
    placedAt: order.lc?.placedAt ?? null,
    productionConfirmedAt: order.lc?.productionConfirmedAt ?? null,
    shippedAt: order.lc?.shippedAt ?? null,
    deliveredAt: order.lc?.deliveredAt ?? null,
    cancelledAt: order.lc?.cancelledAt ?? null,
    orderTotal: order.totalPrice,
    currency: order.currency,
    hasOpenRequest: open,
    now: new Date(),
  });
  const requests = await listOrderRequests(storeId, orderId);
  return { order, policy, requests };
}

type CreateInput =
  | { kind: 'cancel' }
  | { kind: 'claim'; reasonCodes: string[]; description: string; photoKeys: string[] };

export async function createOrderRequest(
  storeId: string, customerId: string, orderId: string, input: CreateInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const journey = await getOrderJourney(storeId, customerId, orderId);
  if (!journey) return { ok: false, error: 'order not found' };
  const { order, policy } = journey;

  if (input.kind === 'cancel') {
    if (!policy.canCancel) return { ok: false, error: 'cancellation not available' };
    const [row] = await db.insert(schema.customerOrderRequests).values({
      storeId, orderId, shopifyCustomerId: customerId, orderNumber: order.orderNumber,
      kind: 'cancel',
      status: 'refund_pending' satisfies RequestStatus,   // policy engine tự duyệt — vào thẳng queue refund
      orderTotal: order.totalPrice,
      refundPercent: policy.refundPercent,
      refundAmount: policy.refundAmount,
      currency: order.currency,
    }).returning({ id: schema.customerOrderRequests.id });
    return { ok: true, id: row.id };
  }

  // claim
  if (!policy.canClaim) return { ok: false, error: 'claim window closed' };
  const reasons = input.reasonCodes.filter((r): r is (typeof CLAIM_REASONS)[number] =>
    (CLAIM_REASONS as readonly string[]).includes(r));
  if (reasons.length === 0) return { ok: false, error: 'select at least one issue' };
  if (input.photoKeys.length < 1 || input.photoKeys.length > 5) return { ok: false, error: 'photos: 1-5 required' };
  const [row] = await db.insert(schema.customerOrderRequests).values({
    storeId, orderId, shopifyCustomerId: customerId, orderNumber: order.orderNumber,
    kind: 'claim', status: 'submitted' satisfies RequestStatus,
    reasonCodes: reasons, description: input.description.trim() || null,
    photoKeys: input.photoKeys,
    orderTotal: order.totalPrice, refundPercent: 100, refundAmount: order.totalPrice, currency: order.currency,
  }).returning({ id: schema.customerOrderRequests.id });
  return { ok: true, id: row.id };
}

export async function addReturnTracking(
  storeId: string, customerId: string, requestId: string, carrier: string, tracking: string,
): Promise<{ ok: boolean; error?: string }> {
  const [req] = await db.select().from(schema.customerOrderRequests)
    .where(and(
      eq(schema.customerOrderRequests.id, requestId),
      eq(schema.customerOrderRequests.storeId, storeId),
      eq(schema.customerOrderRequests.shopifyCustomerId, customerId),
    )).limit(1);
  if (!req) return { ok: false, error: 'not found' };
  if (!canTransition('claim', req.status as RequestStatus, 'return_in_transit')) {
    return { ok: false, error: 'tracking not expected at this stage' };
  }
  const cleanCarrier = carrier.trim(), cleanTracking = tracking.trim();
  if (!cleanCarrier || !cleanTracking) return { ok: false, error: 'carrier and tracking required' };
  await db.update(schema.customerOrderRequests).set({
    returnCarrier: cleanCarrier, returnTrackingNumber: cleanTracking,
    status: 'return_in_transit', trackingAddedAt: new Date(), updatedAt: new Date(),
  }).where(eq(schema.customerOrderRequests.id, requestId));
  return { ok: true };
}
```

- [ ] **Step 4: Chạy pass** — `npx vitest run features/customer-account` + `npx tsc --noEmit` xanh.
- [ ] **Step 5: Commit** — `git commit -m "feat(order-journey): state machine + domain requests (create/list/tracking, server re-check policy)"`

---

### Task 4: API `GET /orders/[orderId]/journey`

**Files:**
- Create: `app/api/customer-account/orders/[orderId]/journey/route.ts`

**Interfaces:**
- Consumes: `authenticateExtension`, `caJson`, `preflight` từ `app/api/customer-account/_shared.ts`; `getOrderJourney` (Task 3); `toPublicTimeline` từ `features/customer-account/public-timeline.ts`.
- Produces JSON:

```jsonc
{
  "order": { "orderId": "...", "orderNumber": "CICI1242", "total": "263.98", "currency": "USD" },
  "timeline": { /* toPublicTimeline output (steps label+at) */ },
  "productionEta": "2026-07-20" | null,
  "policy": { "canCancel": "free|fee40|null", "canClaim": true, "claimDeadline": "...",
              "refundPercent": 100, "refundAmount": "263.98", "feeAmount": "0.00" },
  "requests": [{ "id","kind","status","reasonCodes","createdAt","refundAmount","currency",
                 "returnHub": {"label","recipientName","addressLine1","addressLine2","city","state","postalCode","country","phone"} | null,
                 "returnShippingPayer","returnTrackingNumber","returnCarrier","rejectedReason" }]
}
```

- [ ] **Step 1: Implement route** (theo đúng style `timeline/route.ts` hiện có — OPTIONS preflight, validate uuid, 403 khi token thiếu customer). `returnHub` join từ `return_hubs` khi `return_hub_id` không null; CHỈ expose các field địa chỉ liệt kê trên (không expose id nội bộ).
- [ ] **Step 2: Verify** — `npx tsc --noEmit`; test thủ công bằng script token-ký-tay (pattern đã dùng trong session: ký JWT HS256 bằng secret qua `railway run`, gọi endpoint local `npm run dev` hoặc prod sau deploy). Trong CI của task này chỉ cần tsc + vitest toàn repo xanh.
- [ ] **Step 3: Commit** — `git commit -m "feat(order-journey): API journey (timeline + policy + requests per order)"`

---

### Task 5: API mutations — create request, uploads, tracking

**Files:**
- Create: `app/api/customer-account/orders/[orderId]/requests/route.ts`
- Create: `app/api/customer-account/uploads/route.ts`
- Create: `app/api/customer-account/requests/[id]/tracking/route.ts`

**Interfaces:**
- Consumes: Task 3 (`createOrderRequest`, `addReturnTracking`), `lib/storage/s3.ts` (`putObject`, `isStorageConfigured`), `node:crypto` randomUUID, zod.
- Produces: `POST requests` body `{ kind: 'cancel' } | { kind: 'claim', reasonCodes: string[], description?: string, photoKeys: string[] }` → `{ ok, id? , error? }`; `POST uploads` multipart field `file` → `{ key }`; `POST tracking` body `{ carrier, tracking }` → `{ ok, error? }`.

- [ ] **Step 1: `requests/route.ts`** — zod schema:

```ts
const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancel') }),
  z.object({
    kind: z.literal('claim'),
    reasonCodes: z.array(z.string()).min(1).max(6),
    description: z.string().max(2000).optional().default(''),
    photoKeys: z.array(z.string().regex(/^customer-claims\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/)).min(1).max(5),
  }),
]);
```
Auth qua `authenticateExtension`; 403 nếu `!auth.customerId`; validate `orderId` uuid; photoKeys phải bắt đầu bằng `customer-claims/${auth.store.id}/` (chống trỏ ảnh store khác) — check thêm sau zod. Gọi `createOrderRequest`, trả `caJson`.

- [ ] **Step 2: `uploads/route.ts`:**

```ts
/** POST /api/customer-account/uploads — ảnh bằng chứng claim → S3. Bearer session token. */
import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { isStorageConfigured, putObject } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  if (!isStorageConfigured()) return caJson({ error: 'storage not configured' }, 503);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return caJson({ error: 'file required' }, 400);
  const ext = TYPES[file.type];
  if (!ext) return caJson({ error: 'png/jpg only' }, 415);
  if (file.size > MAX_BYTES) return caJson({ error: 'max 5MB' }, 413);
  const key = `customer-claims/${auth.store.id}/${randomUUID()}.${ext}`;
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
  return caJson({ key });
}
```

- [ ] **Step 3: `tracking/route.ts`** — auth + validate `{carrier: z.string().min(1).max(64), tracking: z.string().min(4).max(64)}` → `addReturnTracking`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npx vitest run` xanh.
- [ ] **Step 5: Commit** — `git commit -m "feat(order-journey): API create request + uploads (S3) + return tracking"`

---

### Task 6: MODULE_KEYS mới cho config

**Files:**
- Modify: `features/customer-account/config-schema.ts` — `MODULE_KEYS = ['tracking', 'wishlist'] as const;` `DEFAULT_CONFIG.modules` theo keys mới.
- Modify: `app/(dashboard)/f/customer-account/ConfigEditor.tsx` — cập nhật label map: `tracking: 'Order Tracking (Journey)'`, `wishlist: 'Wishlist'` (xóa entry profile/credit/returns nếu có).
- Test: cập nhật test hiện có của config-schema nếu tham chiếu keys cũ (`grep -rn "profile\|credit" features/customer-account/*.test.ts`).

Ghi chú: `sanitizeConfig` đã tự DROP module key lạ (zod enum fail → skip) → config cũ trong DB (có profile/credit/returns) tự lành, không cần migration data.

- [ ] Step 1: sửa 2 file + test liên quan; Step 2: `npx vitest run features/customer-account && npx tsc --noEmit` xanh; Step 3: commit `feat(order-journey): module keys tracking|wishlist (bỏ profile/credit/returns khỏi hub)`.

---

### Task 7: Admin — Return hubs CRUD

**Files:**
- Create: `features/customer-account/hubs-shared.ts` (types, KHÔNG db), `hubs-admin.ts` (list), `hubs-actions.ts` (`'use server'`: upsertHub, toggleHub)
- Create: `app/(dashboard)/f/customer-account/hubs/page.tsx` (server) + `HubsEditor.tsx` (client)

**Interfaces:**
- Produces: `listHubs(): Promise<HubRow[]>` (admin) — dùng lại ở Task 8 để chọn hub khi duyệt.
- Pattern BẮT BUỘC: giống bộ ba `returns-shared/admin/actions` hiện tại (xem `features/customer-account/returns-actions.ts` — file-level `'use server'`, gate `requireManageFunctions` giống hệt).

`hubs-shared.ts`:
```ts
export interface HubRow {
  id: string; label: string; recipientName: string;
  addressLine1: string; addressLine2: string | null;
  city: string; state: string | null; postalCode: string | null;
  country: string; phone: string | null; active: boolean;
}
```
`hubs-actions.ts` — `upsertHub(input: Omit<HubRow,'id'|'active'> & { id?: string }): Promise<{ok:boolean;error?:string}>` (validate label/recipient/address1/city/country non-empty; country regex `/^[A-Z]{2}$/`), `toggleHub(id: string, active: boolean)`. `revalidatePath('/f/customer-account/hubs')`.
UI `HubsEditor`: bảng hubs + form thêm/sửa (fields theo HubRow) + toggle active — theo đúng style `LoyaltyEditor.tsx` (Card, Input, Button, useTransition).
Page gate `view_functions`, canManage = `manage_functions`. Thêm link "Return hubs" vào trang index `/f/customer-account/page.tsx` (cạnh links loyalty/returns hiện có).

- [ ] Step 1 implement 5 file; Step 2 `npx tsc --noEmit` xanh; Step 3 commit `feat(order-journey): admin CRUD return hubs`.

---

### Task 8: Admin — Requests queue (duyệt claim, QC, refund)

**Files:**
- Create: `features/customer-account/requests-shared.ts`, `requests-admin.ts`, `requests-actions.ts`
- Create: `app/(dashboard)/f/customer-account/requests/page.tsx` + `RequestsTable.tsx`
- Modify: `app/(dashboard)/f/customer-account/page.tsx` — đổi link "Returns queue" → "/f/customer-account/requests" label "Yêu cầu đơn hàng (cancel/claim)".

**Interfaces:**
- Consumes: `canTransition`, `RequestStatus` (Task 3); `listHubs` (Task 7); `getSignedDownloadUrl` (`lib/storage/s3.ts`) cho ảnh claim.
- Produces (`requests-shared.ts`):
```ts
export const REQUEST_STATUSES = ['submitted','under_review','approved','rejected','return_in_transit','received','refund_pending','refunded'] as const;
export interface AdminRequestRow {
  id: string; storeName: string; orderNumber: string | null; kind: string; status: string;
  shopifyCustomerId: string; reasonCodes: string[] | null; description: string | null;
  photoUrls: string[];            // signed URLs (5 phút) — build ở admin query
  fault: string | null; returnHubId: string | null; returnHubLabel: string | null;
  returnShippingPayer: string | null; returnTrackingNumber: string | null; returnCarrier: string | null;
  refundAmount: string; currency: string; refundPercent: number;
  adminNote: string | null; rejectedReason: string | null; createdAt: Date;
}
```
- `requests-admin.ts`: `listAdminRequests(filter: {storeId?, kind?, status?}): Promise<AdminRequestRow[]>` (join stores + return_hubs; map photoKeys → `getSignedDownloadUrl` — bỏ qua lỗi từng key).
- `requests-actions.ts` (`'use server'`, gate manage_functions, MỌI action check `canTransition` trước khi update; set timestamp tương ứng + `updatedAt`):
  - `approveClaim(id, fault: 'customer'|'mean', returnHubId: string, note: string)` → status `approved`, set `returnShippingPayer = fault === 'mean' ? 'mean' : 'customer'`, `approvedAt`.
  - `rejectRequest(id, reason: string)` → `rejected`, `rejectedReason`, `reviewedAt`.
  - `markReceived(id)` → `received`, `receivedAt`.
  - `recordQc(id, pass: boolean, note: string)` → pass: `refund_pending`; fail: `rejected` + `rejectedReason = note`; `qcAt`.
  - `markRefunded(id)` → `refunded`, `refundedAt`, `refundedMarkedBy` = session user id.
- UI `RequestsTable`: filter kind/status/store; mỗi row expand: ảnh (img từ signed URL), mô tả, reason chips; action theo status hiện tại (dropdown hub từ props `hubs`, radio fault, textarea note); badge ⚠️ "Báo brand dừng sản xuất" khi `kind==='cancel' && refundPercent===60`. Style theo `ReturnsTable.tsx` hiện có.
- Page: `listStoresBasic()` + `listHubs()` + `listAdminRequests(filter từ searchParams)`.

- [ ] Step 1 implement; Step 2 `npx tsc --noEmit && npx vitest run` xanh; Step 3 commit `feat(order-journey): admin requests queue (duyệt claim, hub, QC, refund thủ công)`.

---

### Task 9: Extension — Order Journey UI

**Files (trong `shopify-extension/`):**
- Create: `extensions/customer-account-hub/src/lib/journey-api.ts` — gọi 4 API (pattern `lib/api.ts` hiện có, dùng `smsFetch`; export types khớp JSON Task 4/5; upload dùng `fetch` FormData KHÔNG set Content-Type tay).
- Create: `extensions/customer-account-hub/src/lib/journey-vm.ts` + `journey-vm.test.ts` — THUẦN:

```ts
export function stageChip(currentStage: string | null): { label: string; tone: 'info'|'success'|'critical'|'neutral' };
// placed/production→'In production', qc→'Quality check', pack→'Packed', ship→'Shipped',
// deliver/completed→'Delivered', cancelled→'Cancelled', refunded→'Refunded', null→'Processing'
export function cancelCopy(policy: PolicyJson): string | null;
// 'free' → 'Free cancellation — full refund ($263.98)'
// 'fee40' → 'Production has started. Cancellation fee 40% ($105.59). You will be refunded $158.39 (60%).'
// null → null
export function requestStatusLabel(kind: string, status: string): string;  // English, đủ 8 status
export function fmtMoney(amount: string, currency: string): string;        // '$263.98' cho USD, fallback `${amount} ${currency}`
```
Test: bảng label đủ nhánh + cancelCopy đúng số tiền (dùng policy mẫu refundAmount '158.39', feeAmount '105.59').
- Rewrite: `extensions/customer-account-hub/src/Page.tsx` — 3 view trong 1 component state (`view: 'list' | {orderId} | wizard`):
  1. **List**: `getOrders()` (API cũ) → card `s-section` mỗi đơn: orderNumber, ngày, `fmtMoney`, `stageChip` → `s-badge`. Bấm → detail.
  2. **Detail**: `getJourney(orderId)` → timeline (`s-stack` các step: label + at date hoặc "—", step hiện tại in đậm; hiện `productionEta` nếu có: "Estimated completion: {date}"), vùng action theo `policy` (nút Cancel + panel confirm inline với `cancelCopy` + nút "Confirm cancellation"; nút "Report a problem" khi canClaim; text "Claim window closed…" khi delivered quá hạn), khu requests: mỗi request `requestStatusLabel`, khi `status==='approved'` hiện địa chỉ hub (từ `returnHub`) + "{payer} pays return shipping" + form carrier/tracking → `postTracking`.
  3. **Claim wizard**: bước 1 checkbox 6 reason (nhãn: Damaged package / Damaged or defective product / Wrong item / Wrong size / Missing item / Other) + textarea; bước 2 `s-file-input` hoặc `<input type="file">` trong sandbox — dùng `<input type="file" accept="image/png,image/jpeg" multiple>` render qua Preact, upload từng file → `uploadPhoto` → giữ keys, hiện thumbnail count; bước 3 review + Submit → `postRequest({kind:'claim',...})` → quay lại detail.
- Bỏ import các module không dùng nữa trong Page (ProfileCard, CreditCard, WishlistCard, ReturnCenter, TrackingList) — KHÔNG xóa file module (Task 10 dọn).
- Giữ nguyên `getConfig()` gate đầu trang: `enabled:false` → thông báo như cũ; branding.announcement vẫn hiện.

- [ ] Step 1 viết `journey-vm.test.ts` → fail; Step 2 implement vm → pass (`cd shopify-extension && npm test`); Step 3 implement journey-api + Page; Step 4 `cd shopify-extension && npm run typecheck && npm test` xanh; Step 5 commit `feat(order-journey): extension journey UI (timeline + cancel + claim wizard + tracking)`.

---

### Task 10: Cleanup — gỡ returns cũ + migration 0091

**Files:**
- Delete: `features/customer-account/{returns-shared,returns-admin,returns-actions,return-logic}.ts` (+ test của return-logic nếu có), `app/(dashboard)/f/customer-account/returns/` (page + ReturnsTable), `app/api/customer-account/returns/route.ts`, extension `src/modules/{ProfileCard,CreditCard,WishlistCard,ReturnCenter,TrackingList}.tsx` và phần returns trong `lib/api.ts` extension (`getReturns`, `createReturn`, `ReturnRow`).
- Modify: `features/customer-account/customer-queries.ts` — xóa `listCustomerReturns`, `createCustomerReturn` (giữ `listCustomerOrders`, `getCustomerOrderLifecycle`, `getCustomerLoyalty`).
- Modify: `db/schema.ts` — xóa `customerReturnRequests`.
- Create: `db/migrations/0091_drop-return-requests.sql`:
```sql
-- Order Journey thay thế flow returns v1; bảng rỗng (chưa có khách dùng) — drop an toàn.
DROP TABLE IF EXISTS customer_return_requests;
```
- Modify: `app/(dashboard)/f/customer-account/page.tsx` — gỡ link Returns cũ (đã thay bằng /requests ở Task 8).

- [ ] Step 1: xóa/sửa; Step 2: `grep -rn "customerReturnRequests\|return-logic\|returns-admin\|listCustomerReturns" app features db --include='*.ts' --include='*.tsx'` → 0 kết quả; Step 3: root `npx tsc --noEmit && npx vitest run` xanh + `cd shopify-extension && npm run typecheck && npm test` xanh; Step 4: `npm run db:migrate` local OK; Step 5: commit `refactor(order-journey): gỡ returns v1 (bảng + routes + admin + modules) — thay bằng requests hợp nhất`.

---

### Task 11: Build + deploy + verify end-to-end

- [ ] Step 1: **`npm run build`** (next build THẬT) → EXIT 0. Nếu fail vì client-import-db → sửa theo pattern 3 file rồi build lại.
- [ ] Step 2: `git push` (Railway auto-deploy) → `railway deployment list` đến khi SUCCESS.
- [ ] Step 3: `railway run npm run db:migrate` (áp 0090 + 0091 lên prod).
- [ ] Step 4: Smoke test API prod bằng script token-ký-tay (pattern session 2026-07-05: `railway run node -e` ký JWT HS256 `dest=cici-mean.myshopify.com`, `sub=gid://shopify/Customer/5812012056758`): `GET /api/customer-account/orders` 200; lấy orderId thật → `GET .../journey` 200 có `policy` + `timeline`.
- [ ] Step 5: `cd shopify-extension && shopify app deploy` (cần CEO nếu CLI đòi đăng nhập lại) → version mới released.
- [ ] Step 6: Verify trên cici-mean (CEO hoặc chụp màn hình): menu "Customer Account Hub" → danh sách đơn → chi tiết timeline; đơn delivered hiện nút Report a problem.
- [ ] Step 7: Cập nhật `docs/customer-account-deploy.md` (mục Order Journey + return hubs cần admin tạo trước ở `/f/customer-account/hubs`); append Second Brain `Activity Log.md`; thêm `Decisions.md` D-011 (chính sách cancel/claim + refund thủ công v1).
- [ ] Step 8: Commit docs.

---

## Self-review đã chạy
- Spec coverage: §2→T1; §3→T9; §4→T1; §5→T2+T3; §6→T4+T5; §7→T7+T8; §8→T6+T9+T10; §9→tests từng task + T11; §10 out-of-scope tôn trọng (không refund API, không auto MMP-push, không partial refund).
- Type consistency: `RequestStatus`/`canTransition` (T3) dùng ở T8 actions; `PolicyResult` (T1) dùng ở T3/T4/T9; `HubRow` (T7) dùng ở T8. Status `awaiting_return` trong spec = `approved` (đã ghi chú trong bảng transitions); `qc_done` gộp vào `received→refund_pending|rejected` — refinement nhất quán với spec intent, ghi rõ tại T3.
- Placeholder scan: sạch (mọi task có code/lệnh cụ thể; T4/T7/T8 mô tả bằng interface + pattern file có thật trong repo).
