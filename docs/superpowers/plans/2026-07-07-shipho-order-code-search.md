# Ship-hộ: mã đơn MMP + cột mã đơn gốc + search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đơn ship-hộ MMP dùng mã MMP (`code = mmpRef` = `26-INSLG-SV-XXXX`, bỏ `SH{seq}`); thêm cột "Mã đơn gốc" (`customerRef`, MMP gửi); thêm search server-side trên danh sách.

**Architecture:** Đổi intake set `code = input.mmpRef`, xoá bộ sinh `SH{seq}`. Thêm cột DB `customer_ref` + field intake. Backfill đơn cũ qua script (pure planner + I/O). List: `listShipHoOrders` trả thêm field, page lọc bằng hàm THUẦN `filterShipHoOrders(rows,{q,source})` (đúng pattern load-all-then-JS-filter sẵn có) + ô search + cột mới.

**Tech Stack:** TypeScript, Next.js (server component), Drizzle (Postgres), vitest.

## Global Constraints
- MMP làm chủ format mã — SMS chỉ LƯU & HIỂN THỊ, KHÔNG sinh/parse.
- `code` giữ unique. `mmpRef` đã unique (idempotency) → dùng làm `code` an toàn.
- KHÔNG đổi sinh code đơn NỘI BỘ (operator tự nhập).
- Page là server component → lọc chạy server (JS trong render, không client).
- tsc + vitest xanh trước push. Migration đăng ký journal.

---

### Task 1: Intake đơn MMP dùng `code = mmpRef` (bỏ `SH{seq}`)

**Files:**
- Modify: `features/ship-ho/brand-order-intake.ts` (dòng ~58, ~61-63)
- Delete: `features/ship-ho/brand-order-code.ts`, `features/ship-ho/brand-order-code.test.ts`

- [ ] **Step 1: Sửa intake.** Trong `features/ship-ho/brand-order-intake.ts`:
  - Bỏ import: `import { nextBrandOrderCode } from './brand-order-code';`
  - Xoá dòng `const { code, seq } = await nextBrandOrderCode();`
  - Trong `db.insert(...).values({ ... })`: đổi `code,` → `code: input.mmpRef,`; xoá `mmpOrderSeq: seq,` (cột nullable, thứ tự list theo `createdAt` nên không cần).
  - `emitShipHoEvent({ id: row.id, code: input.mmpRef, source: 'mmp', mmpRef: input.mmpRef }, ...)` — dùng `input.mmpRef` cho `code`.

- [ ] **Step 2: Xoá dead code.** `git rm features/ship-ho/brand-order-code.ts features/ship-ho/brand-order-code.test.ts`. Grep xác nhận không còn ai import: `grep -rn "brand-order-code\|nextBrandOrderCode\|formatBrandOrderCode" features app` → rỗng.

- [ ] **Step 3: Verify build.** `npx tsc --noEmit` (0 lỗi) + `npx vitest run` (xanh; test formatBrandOrderCode đã xoá cùng file).

- [ ] **Step 4: Commit.**
```bash
git add features/ship-ho/brand-order-intake.ts
git rm features/ship-ho/brand-order-code.ts features/ship-ho/brand-order-code.test.ts
git commit -m "feat(ship-ho): đơn MMP dùng code=mmpRef (26-INSLG-SV-XXXX), bỏ SH{seq}"
```

---

### Task 2: Cột `customer_ref` (migration + schema + intake)

**Files:**
- Create: `db/migrations/0099_shipho-customer-ref.sql`
- Modify: `db/migrations/meta/_journal.json`, `db/schema.ts:1977` (gần `mmpRef`), `features/ship-ho/brand-order-intake.ts` (BrandOrderInput + insert)

**Interfaces:**
- Produces: `shipHoOrders.customerRef` (text nullable); `BrandOrderInput.customerRef?: string`.

- [ ] **Step 1: Migration SQL.** Tạo `db/migrations/0099_shipho-customer-ref.sql`:
```sql
ALTER TABLE "ship_ho_orders" ADD COLUMN "customer_ref" text;
```

- [ ] **Step 2: Đăng ký journal.** Trong `db/migrations/meta/_journal.json`, thêm sau entry idx 98:
```json
    ,{
      "idx": 99,
      "version": "7",
      "when": 1784983200000,
      "tag": "0099_shipho-customer-ref",
      "breakpoints": true
    }
```
(when = 1784896800000 + 86400000)

- [ ] **Step 3: Schema.** Trong `db/schema.ts`, ngay dưới `mmpRef: text('mmp_ref'),` (dòng ~1977) thêm:
```ts
  customerRef: text('customer_ref'),
```

- [ ] **Step 4: Intake nhận + lưu.** Trong `features/ship-ho/brand-order-intake.ts`:
  - `BrandOrderInput` thêm field: `customerRef?: string;`
  - Trong `db.insert(...).values({...})` thêm: `customerRef: input.customerRef || null,`

- [ ] **Step 5: Verify.** `npx tsc --noEmit` (0 lỗi) + `npx vitest run` (xanh).

- [ ] **Step 6: Commit.**
```bash
git add db/migrations/0099_shipho-customer-ref.sql db/migrations/meta/_journal.json db/schema.ts features/ship-ho/brand-order-intake.ts
git commit -m "feat(ship-ho): thêm cột customer_ref (mã đơn gốc khách) + intake field"
```

---

### Task 3: Backfill `code = mmpRef` cho đơn MMP cũ (pure planner + script)

**Files:**
- Create: `features/ship-ho/backfill-code.ts`, `features/ship-ho/backfill-code.test.ts`, `scripts/backfill-shipho-code-from-mmpref.ts`

**Interfaces:**
- Produces: `planCodeBackfill(rows: {id,code,mmpRef,source}[]): { updates: {id,from,to}[]; collisions: {id,mmpRef}[] }`.

- [ ] **Step 1: Test THUẦN cho planner.** `features/ship-ho/backfill-code.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planCodeBackfill } from './backfill-code';

describe('planCodeBackfill', () => {
  it('đổi code→mmpRef cho đơn MMP khi khác nhau', () => {
    const r = planCodeBackfill([
      { id: 'a', code: 'SH1000', mmpRef: '26-INSLG-SV-0001', source: 'mmp' },
      { id: 'b', code: 'SH1001', mmpRef: '26-INSLG-SV-0002', source: 'mmp' },
    ]);
    expect(r.updates).toEqual([
      { id: 'a', from: 'SH1000', to: '26-INSLG-SV-0001' },
      { id: 'b', from: 'SH1001', to: '26-INSLG-SV-0002' },
    ]);
    expect(r.collisions).toEqual([]);
  });
  it('bỏ qua đơn nội bộ, đơn không mmpRef, đơn đã đúng code', () => {
    const r = planCodeBackfill([
      { id: 'c', code: '#KLS1983', mmpRef: null, source: 'internal' },
      { id: 'd', code: '26-INSLG-SV-0003', mmpRef: '26-INSLG-SV-0003', source: 'mmp' },
    ]);
    expect(r.updates).toEqual([]);
    expect(r.collisions).toEqual([]);
  });
  it('phát hiện trùng: mmpRef mới == code của đơn khác → collision, KHÔNG update', () => {
    const r = planCodeBackfill([
      { id: 'e', code: 'SH1004', mmpRef: '#KLS1983', source: 'mmp' },
      { id: 'f', code: '#KLS1983', mmpRef: null, source: 'internal' },
    ]);
    expect(r.updates).toEqual([]);
    expect(r.collisions).toEqual([{ id: 'e', mmpRef: '#KLS1983' }]);
  });
});
```

- [ ] **Step 2: Chạy test → FAIL** (`npx vitest run features/ship-ho/backfill-code.test.ts`).

- [ ] **Step 3: Implement planner.** `features/ship-ho/backfill-code.ts`:
```ts
export interface BackfillRow { id: string; code: string; mmpRef: string | null; source: string }
export interface CodeBackfillPlan {
  updates: { id: string; from: string; to: string }[];
  collisions: { id: string; mmpRef: string }[];
}

/** THUẦN: đơn MMP có mmpRef khác code → đổi code=mmpRef, TRỪ khi mmpRef trùng
 *  code của đơn khác (giữ unique). */
export function planCodeBackfill(rows: BackfillRow[]): CodeBackfillPlan {
  const codeOwner = new Map(rows.map((r) => [r.code, r.id]));
  const updates: CodeBackfillPlan['updates'] = [];
  const collisions: CodeBackfillPlan['collisions'] = [];
  for (const r of rows) {
    if (r.source !== 'mmp' || !r.mmpRef || r.mmpRef === r.code) continue;
    const owner = codeOwner.get(r.mmpRef);
    if (owner && owner !== r.id) { collisions.push({ id: r.id, mmpRef: r.mmpRef }); continue; }
    updates.push({ id: r.id, from: r.code, to: r.mmpRef });
  }
  return { updates, collisions };
}
```

- [ ] **Step 4: Chạy test → PASS.**

- [ ] **Step 5: Script I/O.** `scripts/backfill-shipho-code-from-mmpref.ts` (dry-run mặc định, `--apply`):
```ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { planCodeBackfill } from '@/features/ship-ho/backfill-code';

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    mmpRef: schema.shipHoOrders.mmpRef, source: schema.shipHoOrders.source,
  }).from(schema.shipHoOrders);
  const plan = planCodeBackfill(rows);
  console.log(`updates: ${plan.updates.length}, collisions: ${plan.collisions.length}`);
  for (const c of plan.collisions) console.log(`  ⚠ collision id=${c.id} mmpRef=${c.mmpRef} (bỏ qua)`);
  for (const u of plan.updates) console.log(`  ${u.from} → ${u.to}`);
  if (!apply) { console.log('DRY-RUN — chạy lại với --apply.'); return; }
  for (const u of plan.updates) {
    await db.update(schema.shipHoOrders).set({ code: u.to }).where(eq(schema.shipHoOrders.id, u.id));
  }
  console.log(`✓ Đổi ${plan.updates.length} code.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: tsc + commit.** `npx tsc --noEmit` + `npx vitest run` xanh.
```bash
git add features/ship-ho/backfill-code.ts features/ship-ho/backfill-code.test.ts scripts/backfill-shipho-code-from-mmpref.ts
git commit -m "feat(ship-ho): backfill code=mmpRef đơn MMP cũ (planner thuần + script, skip trùng)"
```

---

### Task 4: List — cột "Mã đơn gốc" + search (pure filter)

**Files:**
- Modify: `features/ship-ho/queries.ts` (ShipHoOrderRow + select), `app/(dashboard)/f/ship-ho/page.tsx`
- Create: `features/ship-ho/filter-orders.ts`, `features/ship-ho/filter-orders.test.ts`

**Interfaces:**
- Consumes: `ShipHoOrderRow` (thêm `customerRef`, `trackingNumber`, `recipientName`).
- Produces: `filterShipHoOrders(rows, opts: { q?: string; source?: 'mmp' }): ShipHoOrderRow[]`.

- [ ] **Step 1: queries.ts** — `ShipHoOrderRow` thêm 3 field và select tương ứng:
```ts
  customerRef: string | null;
  trackingNumber: string | null;
  recipientName: string | null;
```
Trong `.select({...})` thêm:
```ts
      customerRef: schema.shipHoOrders.customerRef,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      recipientName: schema.shipHoOrders.recipientName,
```

- [ ] **Step 2: Test THUẦN filter.** `features/ship-ho/filter-orders.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filterShipHoOrders } from './filter-orders';

const base = { id: '1', code: '26-INSLG-SV-0001', partnerBrandSlug: 'kalisa', brandName: 'Kalisa',
  country: 'US', weightKg: '2', carrierKey: null, carrierCostVnd: null, chargedVnd: null,
  status: 'draft', source: 'mmp', createdAt: new Date(0),
  customerRef: 'KLS-9001', trackingNumber: '7712345', recipientName: 'Jaque' } as const;

describe('filterShipHoOrders', () => {
  const rows = [
    { ...base, id: 'a', code: '26-INSLG-SV-0001', customerRef: 'KLS-9001', trackingNumber: '7712345', recipientName: 'Jaque', brandName: 'Kalisa', source: 'mmp' },
    { ...base, id: 'b', code: '#KLS1983', customerRef: null, trackingNumber: '9998888', recipientName: 'Bob', brandName: 'Kalisa', source: 'internal' },
  ];
  it('q khớp code hệ thống', () => {
    expect(filterShipHoOrders(rows, { q: 'INSLG-SV-0001' }).map((r) => r.id)).toEqual(['a']);
  });
  it('q khớp mã đơn gốc (customerRef)', () => {
    expect(filterShipHoOrders(rows, { q: 'kls-9001' }).map((r) => r.id)).toEqual(['a']); // case-insensitive
  });
  it('q khớp tracking', () => {
    expect(filterShipHoOrders(rows, { q: '9998888' }).map((r) => r.id)).toEqual(['b']);
  });
  it('q khớp tên brand / người nhận', () => {
    expect(filterShipHoOrders(rows, { q: 'bob' }).map((r) => r.id)).toEqual(['b']);
  });
  it('source=mmp lọc riêng, kết hợp q', () => {
    expect(filterShipHoOrders(rows, { source: 'mmp' }).map((r) => r.id)).toEqual(['a']);
  });
  it('q rỗng/space → không lọc', () => {
    expect(filterShipHoOrders(rows, { q: '  ' }).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 3: Chạy test → FAIL.**

- [ ] **Step 4: Implement filter.** `features/ship-ho/filter-orders.ts`:
```ts
import type { ShipHoOrderRow } from './queries';

/** THUẦN: lọc đơn theo source (nút "Chỉ đơn MMP") và q (ILIKE trên code, mã đơn
 *  gốc, tracking, tên brand, người nhận). Rỗng → không lọc. */
export function filterShipHoOrders(
  rows: ShipHoOrderRow[],
  opts: { q?: string; source?: 'mmp' },
): ShipHoOrderRow[] {
  let out = rows;
  if (opts.source === 'mmp') out = out.filter((r) => r.source === 'mmp');
  const q = (opts.q ?? '').trim().toLowerCase();
  if (!q) return out;
  const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q);
  return out.filter((r) =>
    has(r.code) || has(r.customerRef) || has(r.trackingNumber) || has(r.brandName) ||
    has(r.partnerBrandSlug) || has(r.recipientName));
}
```

- [ ] **Step 5: Chạy test → PASS.**

- [ ] **Step 6: Wire page.** Trong `app/(dashboard)/f/ship-ho/page.tsx`:
  - Đọc `q`: `const q = typeof sp['q'] === 'string' ? sp['q'] : undefined;`
  - Thay `const orders = sourceFilter ? allOrders.filter(...) : allOrders;` bằng:
    `const orders = filterShipHoOrders(allOrders, { q, source: sourceFilter ?? undefined });`
  - Thêm form search (GET) giữ `source`:
```tsx
<form className="mb-4" action="/f/ship-ho">
  {sourceFilter && <input type="hidden" name="source" value="mmp" />}
  <input name="q" defaultValue={q ?? ''} placeholder="Tìm mã đơn / mã gốc / tracking / brand…"
    className="w-full max-w-md rounded border px-3 py-2 text-sm" />
</form>
```
  - Header row thêm cột: sau `<th>Mã</th>` thêm `<th>Mã đơn gốc</th>` (và tăng `colSpan` empty-state từ 8 → 9).
  - Body row thêm ô sau ô "Mã": `<td className="text-muted-foreground">{o.customerRef ?? '—'}</td>`.
  - import `filterShipHoOrders`.

- [ ] **Step 7: Verify.** `npx tsc --noEmit` + `npx vitest run` xanh.

- [ ] **Step 8: Commit.**
```bash
git add features/ship-ho/queries.ts features/ship-ho/filter-orders.ts features/ship-ho/filter-orders.test.ts "app/(dashboard)/f/ship-ho/page.tsx"
git commit -m "feat(ship-ho): list thêm cột Mã đơn gốc + search (code/mã gốc/tracking/brand/người nhận)"
```

---

### Task 5: Contract doc MMP + deploy (migration + backfill)

**Files:**
- Modify: `docs/integrations/mmp-ship-ho-api.md`

- [ ] **Step 1: Contract doc.** Ở mục tạo đơn (endpoint intake `POST /api/mmp/ship-ho/orders`) trong `docs/integrations/mmp-ship-ho-api.md`, ghi rõ:
  - `mmpRef` (bắt buộc) = mã đơn hệ thống MMP tạo (`26-INSLG-SV-XXXX`); SMS dùng LÀM `code` hiển thị.
  - `customerRef` (tùy chọn) = **mã đơn gốc của khách/brand** để đối soát/track; SMS hiển thị cột "Mã đơn gốc".
  (Nếu file chưa có mục tạo đơn, thêm mục ngắn mô tả 2 field này.)

- [ ] **Step 2: Commit doc.**
```bash
git add docs/integrations/mmp-ship-ho-api.md
git commit -m "docs(mmp): intake gửi customerRef (mã đơn gốc) + mmpRef làm code"
```

- [ ] **Step 3 (CONTROLLER, sau merge+deploy):** chạy prod:
  - `railway run npm run db:migrate` (áp 0099 customer_ref).
  - `railway run npx tsx scripts/backfill-shipho-code-from-mmpref.ts` (dry-run) → xem updates/collisions.
  - `railway run npx tsx scripts/backfill-shipho-code-from-mmpref.ts --apply` → verify list hiện mã MMP.

---

## Self-Review
- **Spec coverage:** A (code=mmpRef) = Task 1 + backfill Task 3 ✓; B (customer_ref) = Task 2 + cột Task 4 ✓; C (search) = Task 4 ✓; contract + deploy = Task 5 ✓.
- **Thứ tự:** Task 2 (schema customer_ref) TRƯỚC Task 4 (queries select customerRef) — nếu không tsc fail. Task 1 độc lập. Task 3 độc lập (chỉ cần source/mmpRef/code đã có).
- **Type consistency:** `ShipHoOrderRow.customerRef/trackingNumber/recipientName` (Task 4) khớp select; `filterShipHoOrders`/`planCodeBackfill` chữ ký nhất quán.
- **Placeholder:** không; migration 0099 + journal when cụ thể.
- **Rủi ro:** backfill collision (mmpRef trùng code đơn khác) → planner phát hiện + skip (có test). Migration khác nhánh đổi số 0099 → kiểm lại lúc merge.
