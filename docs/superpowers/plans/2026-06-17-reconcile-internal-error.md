# Reconcile "Lỗi nội bộ" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Thêm trạng thái đối soát mới **`internal_error` (Lỗi nội bộ)** — đơn lệch do MÌNH nhập sai dim/kg (carrier cân lại lệch), tách khỏi "lỗi carrier"; + panel tổng kết lỗi nội bộ (count + tổng Δ theo carrier).

**Design (đã chốt brainstorm):** Trạng thái mới song song với `carrier_error`/`disputing`, đánh dấu THỦ CÔNG (không auto-suggest). Tổng kết riêng. Tái dùng cột `shipment_reconcile_status` (note + deltaVndAtReview snapshot).

**Tech:** Next.js, Drizzle (pgEnum), React, Vitest.

---

## File Structure
- `db/schema.ts` + migration `0065`: thêm `'internal_error'` vào `reconcileStatusEnum`.
- `features/shipments/reconcile-status-actions.ts`: `markInternalError()`.
- `features/shipments/reconcile-view.ts`: `ReconcileStatus` += `'internal_error'`.
- `features/shipments/internal-error-report.ts` (mới) + test: `listInternalErrors()` + `summariseInternalErrors()`.
- `components/shipping-reconcile/ReconcileDetailPanel.tsx`: nút "Lỗi nội bộ" + branch hiển thị status.
- `components/shipping-reconcile/ReconcileTable.tsx`: status filter + badge.
- `components/shipping-reconcile/ReconcileIssuesModal.tsx` (hoặc panel mới): hiện tổng kết internal.
- `app/(dashboard)/f/shipping-reconcile/page.tsx`: load + truyền summary.

---

## Task 1: Schema enum + migration

**Files:** `db/schema.ts`, `db/migrations/0065_reconcile-internal-error.sql`, `db/migrations/meta/_journal.json`.

- [ ] **Step 1:** Trong `db/schema.ts` đổi:
  `export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error', 'disputing']);`
  → thêm `'internal_error'`:
  `export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error', 'disputing', 'internal_error']);`

- [ ] **Step 2:** Create `db/migrations/0065_reconcile-internal-error.sql`:
```sql
ALTER TYPE "reconcile_status" ADD VALUE IF NOT EXISTS 'internal_error';
```

- [ ] **Step 3:** Append journal entry idx 65 (tag `0065_reconcile-internal-error`, when = last+86400000) to `db/migrations/meta/_journal.json` (giữ JSON hợp lệ).

- [ ] **Step 4:** Apply: `npx dotenv -- drizzle-kit migrate 2>&1 | tail -3` → "applied successfully". (`ALTER TYPE ADD VALUE` không chạy trong transaction — nếu drizzle báo lỗi transaction, chạy SQL trực tiếp 1 lần: `npx dotenv -- tsx -e` không dùng được top-level await; thay bằng script tạm tiny chạy `db.execute(sql\`ALTER TYPE ...\`)`. Idempotent IF NOT EXISTS.) `npx tsc --noEmit | grep -i schema` empty.

- [ ] **Step 5:** Commit `git add db/schema.ts db/migrations/0065_reconcile-internal-error.sql db/migrations/meta/_journal.json && git commit -m "feat(reconcile): thêm status 'internal_error' (lỗi nội bộ)"`

---

## Task 2: Action markInternalError + ReconcileStatus type

**Files:** `features/shipments/reconcile-status-actions.ts`, `features/shipments/reconcile-view.ts`.

- [ ] **Step 1:** Trong `reconcile-view.ts`: thêm `'internal_error'` vào `export type ReconcileStatus` (dòng có `'pending' | 'reconciled' | ...`). KHÔNG cần đổi union nội bộ dòng 26 (đó là input type của status từ DB; nhưng để an toàn nếu nó cũng liệt kê, thêm 'internal_error' vào đó nữa — đọc file để xác nhận chỗ nào cần).

- [ ] **Step 2:** Trong `reconcile-status-actions.ts`, thêm action (mirror `approveCarrierError` nhưng status='internal_error', KHÔNG kind):
```typescript
export interface MarkInternalErrorInput {
  shipmentId: string;
  note: string;
  billedTotal: number;
  deltaVnd: number;
}

/** Lỗi nội bộ: lệch do MÌNH nhập sai dim/kg (carrier cân lại). KHÔNG đòi carrier;
 *  để sửa data nội bộ. Lý do bắt buộc; snapshot delta để tổng kết. */
export async function markInternalError(input: MarkInternalErrorInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do lỗi nội bộ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: 'internal_error',
      note,
      billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'internal_error',
        note,
        carrierErrorKind: null,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}
```
(`requireUser`, `db`, `schema`, `sql`, `revalidatePath`, `ROUTE` đã có trong file.)

- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -iE "reconcile-status-actions|reconcile-view"` empty. `npx vitest run features/shipments` pass.

- [ ] **Step 4:** Commit `git add features/shipments/reconcile-status-actions.ts features/shipments/reconcile-view.ts && git commit -m "feat(reconcile): action markInternalError + status type"`

---

## Task 3: Internal-error report (list + summarise) — TDD pure

**Files:** Create `features/shipments/internal-error-report.ts` + `internal-error-report.test.ts`.

Mẫu theo `carrier-error-report.ts` (đọc nó để khớp pattern query + join shipments→orders→stores→carrier). `summariseInternalErrors` THUẦN, test được.

- [ ] **Step 1: Test** `features/shipments/internal-error-report.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { summariseInternalErrors, type InternalErrorRow } from './internal-error-report';

const row = (o: Partial<InternalErrorRow>): InternalErrorRow => ({
  shipmentId: 's', orderNumber: '#1', carrierKey: 'dhl', deltaVnd: -100000, note: 'sai cân', ...o,
});

describe('summariseInternalErrors', () => {
  it('gom theo carrier: count + tổng Δ', () => {
    const g = summariseInternalErrors([
      row({ carrierKey: 'dhl', deltaVnd: -100000 }),
      row({ carrierKey: 'dhl', deltaVnd: -50000 }),
      row({ carrierKey: 'fedex', deltaVnd: -200000 }),
    ]);
    const dhl = g.find((x) => x.carrierKey === 'dhl')!;
    const fedex = g.find((x) => x.carrierKey === 'fedex')!;
    expect(dhl).toMatchObject({ count: 2, sumDeltaVnd: -150000 });
    expect(fedex).toMatchObject({ count: 1, sumDeltaVnd: -200000 });
  });
  it('rỗng → []', () => { expect(summariseInternalErrors([])).toEqual([]); });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Create `features/shipments/internal-error-report.ts`. Đọc `carrier-error-report.ts` để mirror `listCarrierErrors` (đổi filter status thành `'internal_error'`, bỏ kind). Pure `summariseInternalErrors`:
```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface InternalErrorRow {
  shipmentId: string;
  orderNumber: string;
  carrierKey: string | null;
  deltaVnd: number;
  note: string | null;
}

export interface InternalErrorGroup {
  carrierKey: string | null;
  count: number;
  sumDeltaVnd: number;
}

export function summariseInternalErrors(rows: InternalErrorRow[]): InternalErrorGroup[] {
  const byCarrier = new Map<string, InternalErrorGroup>();
  const order: string[] = [];
  for (const r of rows) {
    const k = r.carrierKey ?? '?';
    let g = byCarrier.get(k);
    if (!g) { g = { carrierKey: r.carrierKey, count: 0, sumDeltaVnd: 0 }; byCarrier.set(k, g); order.push(k); }
    g.count += 1;
    g.sumDeltaVnd += r.deltaVnd;
  }
  return order.map((k) => byCarrier.get(k)!);
}

/** Đơn đã đánh dấu lỗi nội bộ (status='internal_error'), join lấy carrier + đơn + Δ. */
export async function listInternalErrors(): Promise<InternalErrorRow[]> {
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      carrierKey: schema.shipments.carrierKey,
      delta: schema.shipmentReconcileStatus.deltaVndAtReview,
      note: schema.shipmentReconcileStatus.note,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(eq(schema.shipmentReconcileStatus.status, 'internal_error'));
  return rows.map((r) => ({
    shipmentId: r.shipmentId, orderNumber: r.orderNumber,
    carrierKey: r.carrierKey, deltaVnd: r.delta != null ? Number(r.delta) : 0, note: r.note,
  }));
}
```
(Verify column/table names against carrier-error-report.ts; adapt if the join differs — e.g. carrierKey source.)

- [ ] **Step 4:** Run test → pass. `tsc` grep internal-error empty.
- [ ] **Step 5:** Commit `git add features/shipments/internal-error-report.ts features/shipments/internal-error-report.test.ts && git commit -m "feat(reconcile): report lỗi nội bộ (list + summarise)"`

---

## Task 4: UI — nút "Lỗi nội bộ" + badge/filter

**Files:** `components/shipping-reconcile/ReconcileDetailPanel.tsx`, `ReconcileTable.tsx`.

- [ ] **Step 1: ReconcileDetailPanel** — import `markInternalError`; thêm hàm:
```typescript
async function markInternal() {
  if (!note.trim()) return;
  setBusy(true);
  try {
    await markInternalError({ shipmentId: row.shipmentId, note: note.trim(), billedTotal: row.billedTotal, deltaVnd: row.deltaVnd ?? 0 });
  } finally { setBusy(false); }
}
```
Thêm nút trong khu hành động pending (cạnh nút carrier-error/dispute — đọc panel để tìm chỗ render nút khi `row.status` chưa final). Nút: `⚠ Lỗi nội bộ` (amber), disabled khi `noteEmpty || busy`, title "Lệch do mình nhập sai dim/kg → sửa data, không đòi carrier".
Thêm branch hiển thị khi `row.status === 'internal_error'`: badge amber "⚠ Lỗi nội bộ · Δ {fmtVnd(row.deltaVndAtReview)}đ" + note + nút Undo (clearReconcileStatus).

- [ ] **Step 2: ReconcileTable** — thêm `'internal_error'` vào `StatusFilter` (đọc dòng định nghĩa) + nhãn/màu badge status. Label "Lỗi nội bộ", màu amber. Đảm bảo `effStatus`/badge map không vỡ.

- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -iE "ReconcileDetailPanel|ReconcileTable"` empty; `npx eslint` 2 file → 0 error; `npm run build` chạy hết.

- [ ] **Step 4:** Commit `git add components/shipping-reconcile/ReconcileDetailPanel.tsx components/shipping-reconcile/ReconcileTable.tsx && git commit -m "feat(reconcile): UI đánh dấu + badge 'Lỗi nội bộ'"`

---

## Task 5: Panel tổng kết lỗi nội bộ trên page

**Files:** `app/(dashboard)/f/shipping-reconcile/page.tsx`, `components/shipping-reconcile/ReconcileIssuesModal.tsx` (hoặc panel inline trên page).

- [ ] **Step 1: page.tsx** — load thêm:
```typescript
import { listInternalErrors, summariseInternalErrors } from '@/features/shipments/internal-error-report';
// trong Promise.all hoặc sau đó:
const internalErrors = await listInternalErrors();
const internalErrorGroups = summariseInternalErrors(internalErrors);
```
Truyền `internalErrors` + `internalErrorGroups` xuống `ReconcileTable` (rồi tới IssuesModal) HOẶC render panel tổng kết ngay trên page (đơn giản hơn).

- [ ] **Step 2:** Render panel tổng kết (mirror cách `carrierErrorGroups` hiển thị trong ReconcileIssuesModal:135) — 1 khối nhỏ:
"📋 Lỗi nội bộ (sai cân/dim): DHL N đơn · Δ −X đ · FedEx M đơn · Δ −Y đ · Tổng K đơn · −Zđ". Ẩn khi rỗng. Mỗi dòng carrier: count + sumDeltaVnd (fmt VND). Tổng cuối.

- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -i shipping-reconcile` empty; `npm run build` chạy hết.

- [ ] **Step 4:** Commit `git add "app/(dashboard)/f/shipping-reconcile/page.tsx" components/shipping-reconcile/*.tsx && git commit -m "feat(reconcile): panel tổng kết lỗi nội bộ trên trang đối soát"`

---

## Self-Review
- Status mới `internal_error` (Task 1) ↔ action (Task 2) ↔ report (Task 3) ↔ UI mark + badge (Task 4) ↔ summary (Task 5). ✓
- Đánh dấu thủ công (không auto-suggest) ✓. Tách khỏi lỗi carrier (status riêng, report riêng) ✓.
- Migration enum idempotent ✓.
