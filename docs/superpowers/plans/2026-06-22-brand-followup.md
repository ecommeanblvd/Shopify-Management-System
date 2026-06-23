# Brand follow-up: cảnh báo quá hạn + đóng khi giao tới (hệ #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng follow-up brand khi hàng nhập về (`delivered_at`) + banner cảnh báo brand request quá hạn giao.

**Architecture:** Thêm `brand_order_requests.delivered_at` (set lúc `addReceiptItem` nhận hàng có `brandRequestId`); `isFollowUpDue` loại request đã giao; helper thuần `countOverdueFollowUps` cấp số cho banner trên trang vận hành / brand-requests.

**Tech Stack:** Next.js (RSC + server action), Drizzle, Vitest.

## Global Constraints

- **Mốc "giao tới" = lúc NHẬP HÀNG** (`addReceiptItem` ghi item có `brandRequestId`), set `delivered_at` idempotent (`WHERE delivered_at IS NULL`).
- **Quá hạn** = `confirmStatus==='confirmed' AND expectedDeliveryDate ≤ hôm nay AND delivered_at IS NULL`.
- **Migration hand-authored, KHÔNG chạy local** — idx tiếp theo journal = **74** (sau `0073_lark-sync-runs`).
- Tái dùng: `goods_receipt_items.brandRequestId`, `BrandRequestsTable` (filter `followUpOnly`), webhook MMP.
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` xanh.

---

## File Structure
- `db/schema.ts` + `db/migrations/0074_brand-request-delivered-at.sql` + `meta/_journal.json` — cột `delivered_at`.
- `features/fulfillment/brand-logic.ts` + `.test.ts` — `isFollowUpDue` (thêm deliveredAt) + `countOverdueFollowUps`.
- `features/receiving/actions.ts` — `addReceiptItem` set `deliveredAt`.
- `features/fulfillment/brand-queries.ts` — `listBrandRequests` trả `deliveredAt`.
- `features/receiving/queries.ts` — `listAwaitingGoods` lọc `delivered_at IS NULL`.
- `components/fulfillment/BrandRequestsTable.tsx` — hiện "đã giao" + truyền deliveredAt vào isFollowUpDue.
- `components/fulfillment/BrandOverdueBanner.tsx` (mới) + 2 page render.

---

## Task 1: Migration `delivered_at`

**Files:**
- Modify: `db/schema.ts` (bảng `brandOrderRequests`, thêm cột)
- Create: `db/migrations/0074_brand-request-delivered-at.sql`
- Modify: `db/migrations/meta/_journal.json` (entry idx 74)

**Interfaces:**
- Produces: `schema.brandOrderRequests.deliveredAt` (`timestamp('delivered_at')`, nullable).

- [ ] **Step 1: Thêm cột vào schema**

Trong `db/schema.ts`, trong `brandOrderRequests` (sau `confirmedAt`), thêm dòng:
```ts
  deliveredAt: timestamp('delivered_at'),
```

- [ ] **Step 2: Migration SQL**

Tạo `db/migrations/0074_brand-request-delivered-at.sql`:
```sql
ALTER TABLE "brand_order_requests" ADD COLUMN "delivered_at" timestamp;
```

- [ ] **Step 3: Journal entry**

Trong `db/migrations/meta/_journal.json`, thêm cuối mảng `entries` (sau idx 73, nhớ dấu `,`):
```json
    {
      "idx": 74,
      "version": "7",
      "when": 1782823200000,
      "tag": "0074_brand-request-delivered-at",
      "breakpoints": true
    }
```

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0074_brand-request-delivered-at.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): migration brand_order_requests.delivered_at (hệ #2)"
```

---

## Task 2: `isFollowUpDue` (thêm deliveredAt) + `countOverdueFollowUps` (THUẦN)

**Files:**
- Modify: `features/fulfillment/brand-logic.ts`
- Modify: `features/fulfillment/brand-logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FollowUpRow { confirmStatus: string; expectedDeliveryDate: string | null; deliveredAt: Date | string | null }
  export function isFollowUpDue(req: FollowUpRow, todayIso: string): boolean;
  export function countOverdueFollowUps(rows: FollowUpRow[], todayIso: string): number;
  ```

- [ ] **Step 1: Cập nhật test (thêm case deliveredAt + countOverdue)**

Trong `features/fulfillment/brand-logic.test.ts`, trong `describe('isFollowUpDue', ...)` thêm:
```ts
  it('đã giao (deliveredAt) → không due dù quá ngày', () => {
    expect(isFollowUpDue({ confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-01', deliveredAt: new Date('2026-06-02') }, '2026-06-09')).toBe(false);
  });
```
Và sửa các case isFollowUpDue hiện có để thêm `deliveredAt: null` vào object (giữ kỳ vọng cũ). Thêm describe mới:
```ts
describe('countOverdueFollowUps', () => {
  it('đếm đúng số due (loại đã giao + chưa tới hạn)', () => {
    const rows = [
      { confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-01', deliveredAt: null },   // due
      { confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-01', deliveredAt: new Date() }, // đã giao → loại
      { confirmStatus: 'confirmed', expectedDeliveryDate: '2026-12-01', deliveredAt: null },   // chưa tới → loại
      { confirmStatus: 'awaiting', expectedDeliveryDate: null, deliveredAt: null },             // loại
    ];
    expect(countOverdueFollowUps(rows, '2026-06-09')).toBe(1);
  });
});
```
Cập nhật import: `import { buildBrandRequestPayload, applyConfirmation, isFollowUpDue, countOverdueFollowUps } from './brand-logic';`

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/fulfillment/brand-logic.test.ts`
Expected: FAIL (signature đổi / `countOverdueFollowUps` chưa có).

- [ ] **Step 3: Cập nhật implementation**

Trong `features/fulfillment/brand-logic.ts`, thay `isFollowUpDue` + thêm `countOverdueFollowUps`:
```ts
export interface FollowUpRow {
  confirmStatus: string;
  expectedDeliveryDate: string | null;
  deliveredAt: Date | string | null;
}

export function isFollowUpDue(req: FollowUpRow, todayIso: string): boolean {
  return req.confirmStatus === 'confirmed'
    && req.expectedDeliveryDate !== null
    && req.expectedDeliveryDate <= todayIso
    && req.deliveredAt == null;
}

export function countOverdueFollowUps(rows: FollowUpRow[], todayIso: string): number {
  return rows.reduce((n, r) => n + (isFollowUpDue(r, todayIso) ? 1 : 0), 0);
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/fulfillment/brand-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/brand-logic.ts features/fulfillment/brand-logic.test.ts
git commit -m "feat(ops): isFollowUpDue loại đã-giao + countOverdueFollowUps (thuần)"
```

---

## Task 3: Set `deliveredAt` khi nhập hàng + queries trả deliveredAt

**Files:**
- Modify: `features/receiving/actions.ts` (`addReceiptItem`)
- Modify: `features/fulfillment/brand-queries.ts` (`listBrandRequests`)
- Modify: `features/receiving/queries.ts` (`listAwaitingGoods`)

**Interfaces:**
- Consumes: `schema.brandOrderRequests.deliveredAt` (Task 1).
- Produces: `listBrandRequests()` trả thêm `deliveredAt`. `addReceiptItem` set `delivered_at` khi có `brandRequestId`.

Integration (db). Verify tsc/build + suite cũ xanh.

- [ ] **Step 1: `addReceiptItem` set deliveredAt trong transaction**

Trong `features/receiving/actions.ts`, hàm `addReceiptItem`, NGAY SAU câu `.insert(schema.goodsReceiptItems)...returning(...)` (vẫn trong `db.transaction(async (tx) => {...})`, trước `return row.id;`), thêm:
```ts
    // Hàng brand đã về → đóng follow-up (idempotent, chỉ set lần đầu).
    if (input.brandRequestId) {
      await tx.update(schema.brandOrderRequests)
        .set({ deliveredAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(schema.brandOrderRequests.id, input.brandRequestId), isNull(schema.brandOrderRequests.deliveredAt)));
    }
```
Kiểm import đầu file `features/receiving/actions.ts` có `and`, `eq`, `isNull`, `sql` từ `drizzle-orm` — thiếu cái nào thêm vào dòng import sẵn có.

- [ ] **Step 2: `listBrandRequests` trả deliveredAt**

Trong `features/fulfillment/brand-queries.ts`, trong `listBrandRequests` select, thêm field:
```ts
    deliveredAt: schema.brandOrderRequests.deliveredAt,
```
(đặt cạnh `expectedDeliveryDate`).

- [ ] **Step 3: `listAwaitingGoods` lọc chưa-giao**

Trong `features/receiving/queries.ts`, `listAwaitingGoods`, thêm điều kiện vào `.where(and(...))`:
```ts
      isNull(schema.brandOrderRequests.deliveredAt),
```
Kiểm `isNull` đã import từ `drizzle-orm` trong file — thiếu thì thêm.

- [ ] **Step 4: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 5: Commit**

```bash
git add features/receiving/actions.ts features/fulfillment/brand-queries.ts features/receiving/queries.ts
git commit -m "feat(ops): set delivered_at khi nhập hàng brand + queries trả/lọc deliveredAt"
```

---

## Task 4: UI — bảng "đã giao" + banner quá hạn

**Files:**
- Modify: `components/fulfillment/BrandRequestsTable.tsx`
- Create: `components/fulfillment/BrandOverdueBanner.tsx`
- Modify: `app/(dashboard)/f/fulfillment/brand-requests/page.tsx`
- Modify: `app/(dashboard)/f/fulfillment/page.tsx`

**Interfaces:**
- Consumes: `listBrandRequests` (trả deliveredAt), `isFollowUpDue`/`countOverdueFollowUps`.

- [ ] **Step 1: BrandRequestsTable dùng deliveredAt**

Trong `components/fulfillment/BrandRequestsTable.tsx`:
- Thêm `deliveredAt: string | null` vào type row (cạnh `expectedDeliveryDate: string | null`). (RSC truyền Date → serialize thành string/null; nhận `string | null`.)
- Chỗ gọi `isFollowUpDue({ confirmStatus: r.confirmStatus, expectedDeliveryDate: r.expectedDeliveryDate }, todayIso)` → thêm `deliveredAt: r.deliveredAt`:
  ```ts
  isFollowUpDue({ confirmStatus: r.confirmStatus, expectedDeliveryDate: r.expectedDeliveryDate, deliveredAt: r.deliveredAt }, todayIso)
  ```
- Cột trạng thái: nếu `r.deliveredAt` → hiện badge "✓ Đã giao" (class emerald) thay cho follow-up.

- [ ] **Step 2: Tạo BrandOverdueBanner**

Tạo `components/fulfillment/BrandOverdueBanner.tsx`:
```tsx
import Link from 'next/link';

export function BrandOverdueBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/f/fulfillment/brand-requests?followup=1"
      className="block rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
    >
      ⚠ {count} đơn brand quá hạn giao — cần follow-up →
    </Link>
  );
}
```

- [ ] **Step 3: Render banner ở trang brand-requests + trang vận hành**

Trong `app/(dashboard)/f/fulfillment/brand-requests/page.tsx`:
- Import: `import { BrandOverdueBanner } from '@/components/fulfillment/BrandOverdueBanner';` và `import { countOverdueFollowUps } from '@/features/fulfillment/brand-logic';`
- Sau `const rows = await listBrandRequests();` thêm:
  ```ts
  const overdue = countOverdueFollowUps(rows.map((r) => ({ confirmStatus: r.confirmStatus, expectedDeliveryDate: r.expectedDeliveryDate, deliveredAt: r.deliveredAt })), new Date().toISOString().slice(0, 10));
  ```
- Trong JSX (đầu khu return, trên `<BrandRequestsTable .../>`): `<BrandOverdueBanner count={overdue} />`

Trong `app/(dashboard)/f/fulfillment/page.tsx` (trang vận hành chính):
- Import `BrandOverdueBanner`, `countOverdueFollowUps`, `listBrandRequests` (nếu chưa).
- Tính `overdue` tương tự (gọi `listBrandRequests()` — nếu page chưa gọi, thêm 1 query nhẹ) và render `<BrandOverdueBanner count={overdue} />` đầu trang.
> Implementer: đọc `app/(dashboard)/f/fulfillment/page.tsx` xem đã có dữ liệu brand chưa; nếu page nặng, chỉ cần thêm `const overdue = countOverdueFollowUps((await listBrandRequests()).map(...), today)` 1 lần. Đặt banner đầu danh sách.

- [ ] **Step 4: `followup=1` bật filter sẵn (BrandRequestsTable)**

Trong `BrandRequestsTable.tsx`, khởi tạo `followUpOnly` theo query param: đọc `useSearchParams()` → nếu `followup === '1'` thì `useState(true)`. (Nếu khó truyền searchParams vào client, page truyền prop `defaultFollowUp={sp.followup === '1'}` xuống bảng và `useState(defaultFollowUp)`.) Dùng cách prop cho đơn giản: thêm prop `defaultFollowUp?: boolean`, page truyền từ `searchParams`.

- [ ] **Step 5: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 6: Commit**

```bash
git add components/fulfillment/BrandRequestsTable.tsx components/fulfillment/BrandOverdueBanner.tsx "app/(dashboard)/f/fulfillment/brand-requests/page.tsx" "app/(dashboard)/f/fulfillment/page.tsx"
git commit -m "feat(ops): banner brand quá hạn + bảng hiện 'đã giao' (hệ #2)"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §4(b) delivered_at → Task 1,3; isFollowUpDue loại delivered → Task 2; queries → Task 3; §4(a) countOverdueFollowUps → Task 2; banner → Task 4. §5 guard (idempotent deliveredAt, brandRequestId null) → Task 3. §6 test thuần → Task 2. Đủ.
- **Placeholder scan:** code cụ thể mọi step. Chỗ "đọc page xem đã có brand data" (Task 4 step 3) là CHỦ Ý — implementer khớp page thật.
- **Type consistency:** `FollowUpRow {confirmStatus, expectedDeliveryDate, deliveredAt}`, `isFollowUpDue`, `countOverdueFollowUps`, `deliveredAt` nhất quán giữa task 2/3/4. `deliveredAt` ở logic nhận `Date|string|null` → RSC (Date) và client (string) đều khớp.
- **Lưu ý reviewer:** Task 1/3/4 chạm db/UI — repo không test DB → verify tsc/build; logic thuần (isFollowUpDue/countOverdue) TDD ở Task 2.
