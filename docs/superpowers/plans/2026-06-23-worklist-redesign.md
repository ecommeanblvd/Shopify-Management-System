# Bảng vận hành nhìn-nhanh status (Phần A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign WorklistTable: ngày lên cột đầu + các cột status nhìn-nhanh (địa chỉ/brand/KCS/đóng gói/vận chuyển/tình trạng) từ dữ liệu hệ thống đã có.

**Architecture:** Query gom status per-đơn bằng 3 GROUP BY (brand/kcs/shipment) + base; summarizer THUẦN → badge; WorklistTable render 8 cột, bấm hàng → `/f/fulfillment/[orderId]`.

**Tech Stack:** Next.js (RSC), Drizzle, Vitest.

## Global Constraints

- Phần A dùng **status hệ thống** (#1–#4) — KHÔNG gọi Lark, KHÔNG thêm migration.
- Summarizer **THUẦN** (no I/O), test được. Query tránh N+1 (3 GROUP BY, không correlated).
- Ngày = **cột đầu tiên** (`createdAtShopify`, dd/MM/yyyy).
- Bấm hàng → `/f/fulfillment/[orderId]` (đã có).
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` xanh.

---

## File Structure
- `features/fulfillment/worklist-status.ts` + `.test.ts` — Badge type + 4 summarizer (THUẦN).
- `features/fulfillment/worklist-status-queries.ts` — `listWorklistStatus()` (base + 3 GROUP BY).
- `components/fulfillment/WorklistTable.tsx` — redesign 8 cột.
- `app/(dashboard)/f/fulfillment/page.tsx` — đổi sang `listWorklistStatus` + tính badge truyền xuống.

---

## Task 1: Summarizer THUẦN

**Files:**
- Create: `features/fulfillment/worklist-status.ts`
- Test: `features/fulfillment/worklist-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
  export interface Badge { label: string; tone: BadgeTone }
  export function summarizeAddr(o: { addrDeliverable: boolean | null; addrVerifiedAt: Date | string | null }): Badge;
  export function summarizeBrand(o: { total: number; awaiting: number; confirmed: number; delivered: number; minExpected: string | null }): Badge;
  export function summarizeKcs(o: { pending: number; pass: number; fail: number }): Badge;
  export function summarizeDelivery(o: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number }): Badge;
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `features/fulfillment/worklist-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { summarizeAddr, summarizeBrand, summarizeKcs, summarizeDelivery } from './worklist-status';

describe('summarizeAddr', () => {
  it('chưa verify', () => expect(summarizeAddr({ addrDeliverable: null, addrVerifiedAt: null }).tone).toBe('muted'));
  it('không giao được', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date() }).tone).toBe('bad'));
  it('giao được', () => expect(summarizeAddr({ addrDeliverable: true, addrVerifiedAt: new Date() }).tone).toBe('ok'));
});
describe('summarizeBrand', () => {
  it('total 0 → không cần', () => expect(summarizeBrand({ total: 0, awaiting: 0, confirmed: 0, delivered: 0, minExpected: null })).toEqual({ label: 'Không cần', tone: 'muted' }));
  it('all delivered → đã giao', () => expect(summarizeBrand({ total: 2, awaiting: 0, confirmed: 0, delivered: 2, minExpected: null }).tone).toBe('ok'));
  it('awaiting → chờ confirm', () => expect(summarizeBrand({ total: 2, awaiting: 1, confirmed: 1, delivered: 0, minExpected: '2026-06-25' }).tone).toBe('warn'));
  it('confirmed → Confirm + ngày dd/MM', () => expect(summarizeBrand({ total: 1, awaiting: 0, confirmed: 1, delivered: 0, minExpected: '2026-06-25' })).toEqual({ label: 'Confirm · 25/06', tone: 'info' }));
});
describe('summarizeKcs', () => {
  it('fail', () => expect(summarizeKcs({ pending: 0, pass: 1, fail: 1 }).tone).toBe('bad'));
  it('pending', () => expect(summarizeKcs({ pending: 1, pass: 0, fail: 0 }).tone).toBe('warn'));
  it('pass', () => expect(summarizeKcs({ pending: 0, pass: 2, fail: 0 }).tone).toBe('ok'));
  it('none → —', () => expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 })).toEqual({ label: '—', tone: 'muted' }));
});
describe('summarizeDelivery', () => {
  it('chưa pack', () => expect(summarizeDelivery({ packs: 0, withTracking: 0, delivered: 0, exception: 0, inTransit: 0 }).label).toBe('Chưa'));
  it('sự cố', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 1, inTransit: 0 }).tone).toBe('bad'));
  it('đã giao', () => expect(summarizeDelivery({ packs: 2, withTracking: 2, delivered: 2, exception: 0, inTransit: 0 }).tone).toBe('ok'));
  it('đang chuyển', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 0, inTransit: 1 }).tone).toBe('info'));
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết implementation**

Tạo `features/fulfillment/worklist-status.ts`:
```ts
export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
export interface Badge { label: string; tone: BadgeTone }

/** 'YYYY-MM-DD' → 'dd/MM' (thuần, không Date/timezone). */
function ddmm(iso: string | null): string {
  if (!iso || iso.length < 10) return '?';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function summarizeAddr(o: { addrDeliverable: boolean | null; addrVerifiedAt: Date | string | null }): Badge {
  if (!o.addrVerifiedAt) return { label: 'Chưa verify', tone: 'muted' };
  if (o.addrDeliverable === false) return { label: '⚠ Không giao được', tone: 'bad' };
  return { label: '✓ Giao được', tone: 'ok' };
}

export function summarizeBrand(o: { total: number; awaiting: number; confirmed: number; delivered: number; minExpected: string | null }): Badge {
  if (o.total === 0) return { label: 'Không cần', tone: 'muted' };
  if (o.delivered === o.total) return { label: '✓ Đã giao', tone: 'ok' };
  if (o.awaiting > 0) return { label: 'Chờ confirm', tone: 'warn' };
  if (o.confirmed > 0) return { label: `Confirm · ${ddmm(o.minExpected)}`, tone: 'info' };
  return { label: '—', tone: 'muted' };
}

export function summarizeKcs(o: { pending: number; pass: number; fail: number }): Badge {
  if (o.fail > 0) return { label: 'Lỗi', tone: 'bad' };
  if (o.pending > 0) return { label: 'Chờ', tone: 'warn' };
  if (o.pass > 0) return { label: 'Đạt', tone: 'ok' };
  return { label: '—', tone: 'muted' };
}

export function summarizeDelivery(o: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number }): Badge {
  if (o.packs === 0) return { label: 'Chưa', tone: 'muted' };
  if (o.exception > 0) return { label: 'Sự cố', tone: 'bad' };
  if (o.delivered === o.packs) return { label: 'Đã giao', tone: 'ok' };
  if (o.inTransit > 0) return { label: 'Đang chuyển', tone: 'info' };
  if (o.withTracking > 0) return { label: 'Có tracking', tone: 'info' };
  return { label: 'Chưa ship', tone: 'muted' };
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/worklist-status.ts features/fulfillment/worklist-status.test.ts
git commit -m "feat(ops): summarizer thuần badge status worklist (Phần A)"
```

---

## Task 2: Query `listWorklistStatus`

**Files:**
- Create: `features/fulfillment/worklist-status-queries.ts`

**Interfaces:**
- Consumes: `db, schema`.
- Produces:
  ```ts
  export interface WorklistStatusRow {
    orderId: string; orderNumber: string | null; storeName: string | null;
    status: string; createdAtShopify: Date | null;
    addrDeliverable: boolean | null; addrVerifiedAt: Date | null;
    brand: { total: number; awaiting: number; confirmed: number; delivered: number; minExpected: string | null };
    kcs: { pending: number; pass: number; fail: number };
    ship: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number };
  }
  export function listWorklistStatus(): Promise<WorklistStatusRow[]>;
  ```

Integration (db). Verify tsc/build.

- [ ] **Step 1: Viết query**

Tạo `features/fulfillment/worklist-status-queries.ts`:
```ts
import { desc, eq, sql, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface WorklistStatusRow {
  orderId: string; orderNumber: string | null; storeName: string | null;
  status: string; createdAtShopify: Date | null;
  addrDeliverable: boolean | null; addrVerifiedAt: Date | null;
  brand: { total: number; awaiting: number; confirmed: number; delivered: number; minExpected: string | null };
  kcs: { pending: number; pass: number; fail: number };
  ship: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number };
}

const n = (v: unknown) => Number(v ?? 0);

export async function listWorklistStatus(): Promise<WorklistStatusRow[]> {
  const base = await db.select({
    orderId: schema.orderFulfillment.orderId,
    status: schema.orderFulfillment.status,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    createdAtShopify: schema.shopifyOrders.createdAtShopify,
    addrDeliverable: schema.shopifyOrders.addrDeliverable,
    addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,
  })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));

  const brandAgg = await db.select({
    orderId: schema.brandOrderRequests.orderId,
    total: sql<number>`count(*)`,
    awaiting: sql<number>`count(*) filter (where ${schema.brandOrderRequests.confirmStatus} = 'awaiting')`,
    confirmed: sql<number>`count(*) filter (where ${schema.brandOrderRequests.confirmStatus} = 'confirmed')`,
    delivered: sql<number>`count(*) filter (where ${schema.brandOrderRequests.deliveredAt} is not null)`,
    minExpected: sql<string | null>`min(${schema.brandOrderRequests.expectedDeliveryDate})`,
  }).from(schema.brandOrderRequests).groupBy(schema.brandOrderRequests.orderId);

  const kcsAgg = await db.select({
    orderId: schema.goodsReceiptItems.orderId,
    pending: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'pending')`,
    pass: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'pass')`,
    fail: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'fail')`,
  }).from(schema.goodsReceiptItems).where(isNotNull(schema.goodsReceiptItems.orderId)).groupBy(schema.goodsReceiptItems.orderId);

  const shipAgg = await db.select({
    orderId: schema.shipments.orderId,
    packs: sql<number>`count(*)`,
    withTracking: sql<number>`count(*) filter (where ${schema.shipments.trackingNumber} is not null)`,
    delivered: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'delivered')`,
    exception: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'exception')`,
    inTransit: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} in ('in_transit','out_for_delivery'))`,
  }).from(schema.shipments).groupBy(schema.shipments.orderId);

  const bMap = new Map(brandAgg.map((r) => [r.orderId, r]));
  const kMap = new Map(kcsAgg.map((r) => [r.orderId as string, r]));
  const sMap = new Map(shipAgg.map((r) => [r.orderId, r]));

  return base.map((r) => {
    const b = bMap.get(r.orderId); const k = kMap.get(r.orderId); const s = sMap.get(r.orderId);
    return {
      ...r,
      brand: { total: n(b?.total), awaiting: n(b?.awaiting), confirmed: n(b?.confirmed), delivered: n(b?.delivered), minExpected: b?.minExpected ?? null },
      kcs: { pending: n(k?.pending), pass: n(k?.pass), fail: n(k?.fail) },
      ship: { packs: n(s?.packs), withTracking: n(s?.withTracking), delivered: n(s?.delivered), exception: n(s?.exception), inTransit: n(s?.inTransit) },
    };
  });
}
```
> Implementer: kiểm `expected_delivery_date` là cột `date` → `min()` trả string 'YYYY-MM-DD' (khớp `minExpected: string|null`). Nếu drizzle trả Date, ép về ISO `.slice(0,10)` trong map. Kiểm enum value `confirmStatus` ('awaiting'/'confirmed') + `qcResult` ('pending'/'pass'/'fail') + `deliveryStatus` ('delivered'/'exception'/'in_transit'/'out_for_delivery') đúng tên trong schema.

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add features/fulfillment/worklist-status-queries.ts
git commit -m "feat(ops): listWorklistStatus — gom status per-đơn (3 GROUP BY)"
```

---

## Task 3: Redesign WorklistTable + wire page

**Files:**
- Modify: `components/fulfillment/WorklistTable.tsx`
- Modify: `app/(dashboard)/f/fulfillment/page.tsx`

**Interfaces:**
- Consumes: `listWorklistStatus` (T2), `summarizeAddr/Brand/Kcs/Delivery` + `Badge` (T1).

- [ ] **Step 1: Page tính badge + truyền xuống**

Trong `app/(dashboard)/f/fulfillment/page.tsx`:
- Đổi import: thay `listFulfillmentWorklist` bằng `import { listWorklistStatus } from '@/features/fulfillment/worklist-status-queries';` và `import { summarizeAddr, summarizeBrand, summarizeKcs, summarizeDelivery } from '@/features/fulfillment/worklist-status';`
- Chỗ `const [rows, brandRows] = await Promise.all([listFulfillmentWorklist(), ...])` → đổi gọi `listWorklistStatus()`.
- Map sang row cho bảng (tính badge ở RSC):
  ```ts
  const worklistRows = (await listWorklistStatus()).map((r) => ({
    orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName,
    status: r.status, createdAtShopify: r.createdAtShopify,
    addr: summarizeAddr(r), brand: summarizeBrand(r.brand), kcs: summarizeKcs(r.kcs),
    delivery: summarizeDelivery(r.ship), packs: r.ship.packs,
  }));
  ```
  (Giữ Promise.all với các query khác như cũ — chỉ thay phần worklist.)
- `<WorklistTable rows={worklistRows} canManage={...} />`.
> Implementer: đọc page để giữ nguyên `brandRows`/`overdue` (BrandOverdueBanner) — chỉ thay nguồn worklist + truyền `worklistRows`.

- [ ] **Step 2: WorklistTable render 8 cột**

Thay `components/fulfillment/WorklistTable.tsx`:
- `WorklistRow` mới:
  ```ts
  import type { Badge } from '@/features/fulfillment/worklist-status';
  type WorklistRow = {
    orderId: string; orderNumber: string | null; storeName: string | null;
    status: string; createdAtShopify: Date | string | null;
    addr: Badge; brand: Badge; kcs: Badge; delivery: Badge; packs: number;
  };
  ```
- Thêm map tone→class:
  ```ts
  const TONE: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    muted: 'bg-muted text-muted-foreground',
  };
  function BadgeCell({ b }: { b: Badge }) {
    return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[b.tone]}`}>{b.label}</span>;
  }
  ```
- Header 8 cột: `Ngày · Đơn · Địa chỉ · Brand · KCS · Đóng gói · Vận chuyển · Tình trạng`.
- Mỗi hàng: cả hàng click sang detail (dùng `onClick`/`router.push` HOẶC bọc cột Đơn bằng `<a>` như cũ + giữ các cột khác). Đơn giản: giữ link ở cột "Đơn", cả hàng `hover:bg-muted/30 cursor-pointer` + onClick điều hướng. Dùng `useRouter` (đã 'use client').
  - Ngày: `fmtDate(row.createdAtShopify)` (giữ fmtDate cũ).
  - Đơn: orderNumber + storeName (2 dòng nhỏ).
  - Địa chỉ/Brand/KCS/Vận chuyển: `<BadgeCell b={row.addr|brand|kcs|delivery} />`.
  - Đóng gói: `row.packs === 0 ? <span class muted>Chưa</span> : `${row.packs} kiện``.
  - Tình trạng: badge pipeline (giữ `ORDER_STATUS_LABELS` + `statusBadgeClass`).
- Giữ filter "Tất cả trạng thái" (lọc theo `row.status` pipeline như cũ). `colSpan` empty = 8.

- [ ] **Step 3: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 4: Commit**

```bash
git add components/fulfillment/WorklistTable.tsx "app/(dashboard)/f/fulfillment/page.tsx"
git commit -m "feat(ops): WorklistTable 8 cột nhìn-nhanh status + ngày cột đầu (Phần A)"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §3 cột → T3; §4 summarizer → T1, query gom → T2, wire page → T3. §6 test thuần → T1. Đủ. Phần B (Lark) ngoài phạm vi (đã ghi).
- **Placeholder scan:** code cụ thể mọi step. "Implementer: kiểm tên enum/cột" là CHỦ Ý — khớp tên thật.
- **Type consistency:** `Badge`/`BadgeTone`, `summarize*`, `WorklistStatusRow`, `listWorklistStatus`, `WorklistRow` nhất quán T1/T2/T3.
- **Lưu ý reviewer:** T2/T3 chạm db/UI — repo không test DB → verify tsc/build; logic badge (summarizer) TDD ở T1.
