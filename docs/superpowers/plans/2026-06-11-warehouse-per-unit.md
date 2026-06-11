# Kho hàng per-unit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quản lý tồn kho theo từng món (per-unit) trên `goods_receipt_items`; allocator cấp đúng món FIFO; tồn gộp SKU×kho thành rollup; import 833 món thật.

**Architecture:** Tái dùng `goods_receipt_items` (đã per-unit) làm món tồn — thêm `currentWarehouseCode`/`location`/`stockStatus`. Giữ nguyên `warehouseInventory`+`inventoryMovements` (rollup+sổ cái); mỗi movement gắn 1 món. Allocator/pick/release thao tác trên món cụ thể.

**Tech Stack:** Drizzle, Vitest (TDD), Next.js App Router, xlsx.

**Spec:** `docs/superpowers/specs/2026-06-11-warehouse-per-unit-design.md`

**Hằng số:** warehouseCode = `GVM`/`AP`/`DM`; tie-rule ưu tiên `['GVM','AP','DM']`. Map XLSX: warehouse=phần sau `|`; stockStatus: QC Failed→qc_failed, Tạm nhập→staging, đã xuất→shipped, else in_stock.

---

### Task 1: Schema — món tồn per-unit

**Files:**
- Modify: `db/schema.ts` (enum mới + `goodsReceiptItems` ~dòng 1492)
- Generate: `db/migrations/0058_*.sql`

- [ ] **Step 1.1:** Thêm enum + cột.

```ts
// cạnh các enum receiving:
export const warehouseItemStatusEnum = pgEnum('warehouse_item_status', [
  'pending', 'in_stock', 'staging', 'allocated', 'picked', 'shipped',
  'qc_failed', 'returned_to_vendor',
]);
```

Trong `goodsReceiptItems` thêm (sau `weightKg`):

```ts
  /** Kho hiện tại của món (GVM/AP/DM) — đổi khi chuyển kho. NULL tới khi lưu kho. */
  currentWarehouseCode: text('current_warehouse_code'),
  /** Vị trí trong kho ("Kệ 6-F"). */
  location: text('location'),
  /** Vòng đời món trong kho. Default pending tới khi QC + lưu kho. */
  stockStatus: warehouseItemStatusEnum('stock_status').notNull().default('pending'),
```

Thêm index phục vụ allocator (cuối định nghĩa bảng, trong mảng `(t)=>[...]`):

```ts
  index('gri_stock_pick_idx').on(t.sku, t.stockStatus, t.currentWarehouseCode),
```

- [ ] **Step 1.2:** `npx drizzle-kit generate --name warehouse-item-status && npx drizzle-kit migrate`. Expected: 0058 có ADD VALUEs enum + 3 ADD COLUMN + CREATE INDEX. `npx tsc --noEmit` sạch.

- [ ] **Step 1.3: Commit** `git add db/schema.ts db/migrations` → `feat(warehouse): schema món tồn per-unit (stockStatus/location/currentWarehouseCode)` + trailer.

---

### Task 2: Pure logic — chọn món FIFO + map stockStatus (TDD)

**Files:**
- Modify: `features/warehouse/allocation-logic.ts`
- Create: `features/warehouse/item-import-logic.ts` (+ test)
- Test: `features/warehouse/allocation-logic.test.ts`

- [ ] **Step 2.1: Test FAIL** cho `pickItem` trong allocation-logic.test.ts:

```ts
describe('pickItem (per-unit FIFO)', () => {
  it('chọn món in_stock cũ nhất ở kho nhiều khả dụng nhất (hoà → GVM)', () => {
    const items = [
      { id: 'b', warehouseCode: 'AP', receivedAt: new Date('2024-01-01') },
      { id: 'a', warehouseCode: 'GVM', receivedAt: new Date('2024-02-01') },
      { id: 'c', warehouseCode: 'GVM', receivedAt: new Date('2024-01-15') },
    ];
    // GVM có 2 món, AP 1 → chọn GVM; trong GVM cũ nhất = 'c' (2024-01-15).
    expect(pickItem(items)?.id).toBe('c');
  });
  it('rỗng → null', () => { expect(pickItem([])).toBeNull(); });
});
```

- [ ] **Step 2.2: Implement** trong allocation-logic.ts:

```ts
export interface PickableItem { id: string; warehouseCode: string; receivedAt: Date | null }
/** Chọn 1 món để cấp: kho nhiều món nhất (hoà → ưu tiên WAREHOUSE_PRIORITY),
 *  trong kho đó lấy món NHẬN CŨ NHẤT (FIFO; receivedAt null xếp cuối). */
export const WAREHOUSE_PRIORITY = ['GVM', 'AP', 'DM'];
export function pickItem<T extends PickableItem>(items: T[]): T | null {
  if (items.length === 0) return null;
  const byWh = new Map<string, T[]>();
  for (const it of items) { const l = byWh.get(it.warehouseCode) ?? []; l.push(it); byWh.set(it.warehouseCode, l); }
  let best: string | null = null;
  for (const [wh, list] of byWh) {
    if (best === null) { best = wh; continue; }
    const a = list.length, b = byWh.get(best)!.length;
    if (a > b || (a === b && rank(wh) < rank(best))) best = wh;
  }
  const pool = byWh.get(best!)!;
  return [...pool].sort((x, y) =>
    (x.receivedAt?.getTime() ?? Infinity) - (y.receivedAt?.getTime() ?? Infinity)
    || x.id.localeCompare(y.id))[0];
}
function rank(wh: string): number { const i = WAREHOUSE_PRIORITY.indexOf(wh); return i < 0 ? 99 : i; }
```

- [ ] **Step 2.3: Test FAIL** `mapStockStatus` + `mapWarehouseCode` trong item-import-logic.test.ts:

```ts
import { mapStockStatus, mapWarehouseCode } from './item-import-logic';
it('map kho từ cột "HN | GVM"', () => { expect(mapWarehouseCode('HN | GVM')).toBe('GVM'); expect(mapWarehouseCode('SG | DM')).toBe('DM'); });
it('map status', () => {
  expect(mapStockStatus({ qc: 'QC Failed', action: 'Lưu kho', exportDate: 'Chưa xuất đơn' })).toBe('qc_failed');
  expect(mapStockStatus({ qc: 'QC Pass', action: 'Tạm nhập (đi đơn)', exportDate: 'Chưa xuất đơn' })).toBe('staging');
  expect(mapStockStatus({ qc: 'QC Pass', action: 'Lưu kho', exportDate: '2026/03/19' })).toBe('shipped');
  expect(mapStockStatus({ qc: 'QC Pass', action: 'Lưu kho', exportDate: 'Chưa xuất đơn' })).toBe('in_stock');
});
```

- [ ] **Step 2.4: Implement** `features/warehouse/item-import-logic.ts`:

```ts
export function mapWarehouseCode(raw: string): string {
  const p = raw.split('|').map((s) => s.trim());
  return (p[1] || p[0] || '').toUpperCase();
}
export function mapStockStatus(r: { qc: string; action: string; exportDate: string }): string {
  if (/fail/i.test(r.qc)) return 'qc_failed';
  if (/tạm nhập/i.test(r.action)) return 'staging';
  const ed = (r.exportDate || '').trim();
  if (ed && ed !== 'Chưa xuất đơn') return 'shipped';
  return 'in_stock';
}
```

- [ ] **Step 2.5:** `npx vitest run features/warehouse` xanh; tsc sạch. Commit `feat(warehouse): pure logic chọn món FIFO + map import` + trailer.

---

### Task 3: Allocator cấp đúng món (TDD)

**Files:**
- Modify: `features/warehouse/allocate.ts` (allocateLine), `features/warehouse/release.ts`, `features/fulfillment/actions.ts` (applyLineTransition pick)
- Test: `features/warehouse/allocate.test.ts`

- [ ] **Step 3.1:** Đọc `features/warehouse/allocate.ts`, `release.ts`, `ledger.ts` (MovementDraft refType cần thêm `'item'`), `features/fulfillment/actions.ts` applyLineTransition.

- [ ] **Step 3.2:** `ledger.ts` MovementDraft.refType union thêm `'item'`.

- [ ] **Step 3.3: Rewrite `allocateLine`** — bước 2-6 đổi từ "lock warehouseInventory + plan theo count" sang "chọn món":

```ts
// 2) Lock các MÓN in_stock của SKU (ORDER BY id để thứ tự lock xác định).
const items = await tx.select({
  id: schema.goodsReceiptItems.id, warehouseCode: schema.goodsReceiptItems.currentWarehouseCode,
  receivedAt: schema.goodsReceiptItems.qcCheckedAt,
}).from(schema.goodsReceiptItems)
  .where(and(eq(schema.goodsReceiptItems.sku, peek.sku),
             eq(schema.goodsReceiptItems.stockStatus, 'in_stock'),
             isNotNull(schema.goodsReceiptItems.currentWarehouseCode)))
  .orderBy(asc(schema.goodsReceiptItems.id)).for('update');
// 3) lock + re-validate dòng đơn (giữ nguyên).
// 4) chọn món:
const chosen = pickItem(items.map((i) => ({ id: i.id, warehouseCode: i.warehouseCode!, receivedAt: i.receivedAt })));
// 5) không có món → out_of_stock (giữ nguyên nhánh cũ).
if (!chosen) { /* ...như cũ... */ return false; }
// 6) cấp: set món allocated + link dòng, movement +reserved refType item.
await tx.update(schema.goodsReceiptItems)
  .set({ stockStatus: 'allocated', fulfillmentLineId: line.id, updatedAt: sql`now()` })
  .where(eq(schema.goodsReceiptItems.id, chosen.id));
const invId = await applyMovement(tx, {
  sku: line.sku, warehouseCode: chosen.warehouseCode, deltaOnHand: 0, deltaReserved: 1,
  reason: 'auto_allocate', refType: 'item', refId: chosen.id, actor: ACTOR,
});
await tx.update(schema.orderFulfillmentLines)
  .set({ status: 'in_stock', warehouseInventoryId: invId, allocatedQty: 1, updatedAt: sql`now()` })
  .where(eq(schema.orderFulfillmentLines.id, line.id));
// events + xoá brandOrderRequests awaiting + recomputeRollup: giữ nguyên.
```

(Lưu ý: v1 mỗi dòng cấp 1 món/qty=1 — khớp dữ liệu thật mỗi món qty 1. Dòng qty>1 chỉ cấp 1 món, phần còn lại để pass sau hoặc out_of_stock; ghi note rõ trong code. KHÔNG mở rộng multi-món lần này — YAGNI.)

- [ ] **Step 3.4: release.ts** — tìm món theo `fulfillmentLineId` thay vì warehouseInventoryId: set món về `in_stock`, gỡ `fulfillmentLineId`, movement −reserved refType item. (Giữ lock order: lock món FOR UPDATE trước, rồi dòng.)

- [ ] **Step 3.5: actions.ts pick** (`applyLineTransition` nhánh `picked`): tìm món `allocated` theo `fulfillmentLineId`, set `stockStatus='picked'` (rồi `shipped` ở bước ship), movement −onHand −reserved refType item.

- [ ] **Step 3.6:** Test allocate (logic-with-fake-rows hoặc integration guard TEST_DATABASE_URL như allocate.integration.test.ts): cấp chọn đúng món FIFO; release trả đúng món; pick trừ đúng. `npx vitest run` xanh; tsc sạch. Commit `feat(warehouse): allocator/release/pick theo món per-unit` + trailer.

---

### Task 4: Receiving store → tạo món in_stock

**Files:**
- Modify: `features/receiving/actions.ts` (nhánh store ~dòng 165-180)

- [ ] **Step 4.1:** Nhánh `disposition === 'store'`: ngoài applyMovement (đổi refType `item`, refId = item.id, qty 1), set chính món vừa QC:

```ts
await tx.update(schema.goodsReceiptItems)
  .set({ stockStatus: 'in_stock', currentWarehouseCode: receiptWarehouseCode, updatedAt: sql`now()` })
  .where(eq(schema.goodsReceiptItems.id, item.id));
await applyMovement(tx, { sku: item.sku!, warehouseCode: receiptWarehouseCode,
  deltaOnHand: 1, deltaReserved: 0, reason: receiptReason, refType: 'item', refId: item.id, actor: userId });
```

Nhánh `allocate_to_order`: set món `stockStatus='staging'`, `currentWarehouseCode=receiptWarehouseCode` (không movement — staging ngoài rollup, giữ nguyên). QC fail: `stockStatus='qc_failed'` hoặc `returned_to_vendor` theo disposition.

- [ ] **Step 4.2:** tsc + `npx vitest run` xanh. Commit `feat(receiving): QC store set món in_stock + movement per-item` + trailer.

---

### Task 5: Import 833 món (script 1 lần)

**Files:**
- Create: `scripts/import-warehouse-items.ts`

- [ ] **Step 5.1: Script** (dry-run/--apply): đọc XLSX, cho mỗi dòng:
- upsert `goods_receipts` tổng hợp: 1 receipt cho mỗi (inventoryType, warehouseCode) — code vd `SEED-<wh>-<type>`; `warehouseCode`, `sourceType` map gần đúng (Consignment→consignment, PO→po, còn lại→retail_for_order), `note`= nguyên văn inventory type.
- upsert `goods_receipt_items` theo `unitCode` ("WH - Unique code"): sku, productTitle, variantTitle (Color+Size), qcResult (Pass/Failed), qcFailReason, disposition (Lưu kho→store / Tạm nhập→allocate_to_order), `currentWarehouseCode`=mapWarehouseCode, `location`="Vị trí tại kho", `stockStatus`=mapStockStatus, `domPrice`/`globalPrice`+currency, `weightKg`, `qcCheckedAt`/`receivedAt`="Ngày Import", `orderId` (tra theo "Order Number final" nếu khớp đơn — best-effort, null nếu không).
- **Backfill món cũ (spec §6):** trước khi recompute, các `goods_receipt_items`
  ĐÃ CÓ từ luồng Nhập-QC (nếu có, `stockStatus='pending'` default) → suy
  stockStatus từ qcResult+disposition+fulfillmentLineId (qc fail→qc_failed;
  store+qc pass→in_stock; allocate_to_order→staging; có fulfillmentLine đã
  picked/shipped→tương ứng); `currentWarehouseCode`←receipt.warehouseCode nếu trống.
- Sau import: recompute `warehouseInventory` rollup từ TẤT CẢ món (cả seed lẫn
  cũ): với mỗi (sku, currentWarehouseCode) đếm in_stock→onHand, allocated→onHand+reserved;
  upsert row (KHÔNG qua applyMovement — đây là seed; ghi 1 movement `migration` tổng nếu muốn vết).
- Dry-run in: tổng theo stockStatus (kỳ vọng ~700 in_stock / 8 staging / 19 qc_failed / 105 shipped), theo kho (GVM/AP/DM), số SKU rollup. Idempotent theo unitCode.

- [ ] **Step 5.2:** Chạy DRY-RUN, dán output. KHÔNG --apply (Task 7).

- [ ] **Step 5.3:** Commit `feat(warehouse): script import 833 món từ XLSX` + trailer.

---

### Task 6: UI — tab kho GVM/AP/DM + danh sách món

**Files:**
- Modify: `features/warehouse/queries.ts` (listInventory theo kho mới + listItems(sku, wh)), `components/fulfillment/WarehouseBoard.tsx`, `app/(dashboard)/f/warehouse/page.tsx`

- [ ] **Step 6.1:** `queries.ts`: `listItems(sku, warehouseCode?)` trả các `goods_receipt_items` của sku (mã WH, location, stockStatus, currentWarehouseCode, source từ receipt, receivedAt, domPrice/globalPrice, fulfillmentLineId→order name). `listInventory` group theo `currentWarehouseCode` (GVM/AP/DM).

- [ ] **Step 6.2:** `WarehouseBoard.tsx`: tab `GVM / AP / DM / Tất cả` (thay HN/SG). Click SKU mở drawer **danh sách món** (bảng: mã WH · vị trí · trạng thái(badge) · nguồn · ngày nhập · giá vốn · đơn) — load qua server action `getItems(sku, wh)` (guard view_fulfillment). Giữ nút điều chỉnh/chuyển kho nhưng chuyển sang chọn MÓN (chuyển kho 1 món: đổi currentWarehouseCode + movement transfer per-item; đánh hỏng 1 món: stockStatus qc_failed). Form upsert metadata SKU giữ nguyên.

- [ ] **Step 6.3:** page.tsx truyền dữ liệu kho mới. tsc + eslint + `npx vitest run` xanh. Commit `feat(ui): kho per-unit — tab GVM/AP/DM + danh sách món` + trailer.

---

### Task 7: Apply import + verify + push

- [ ] **Step 7.1:** Dry-run lần cuối rồi `npx tsx scripts/import-warehouse-items.ts --apply`.
- [ ] **Step 7.2:** Verify DB: `SELECT stock_status, count(*) FROM goods_receipt_items GROUP BY 1` khớp dry-run; rollup `warehouseInventory` theo (sku, GVM/AP/DM) khớp số món in_stock; tổng SKU hợp lý.
- [ ] **Step 7.3:** Smoke allocator trên 1 SKU có tồn: gọi `allocateLine` (script tạm) cho 1 dòng pending_check khớp SKU → chọn đúng món cũ nhất, món→allocated, rollup reserved+1; rồi release → trả về in_stock. (Hoặc integration test guard TEST_DATABASE_URL.)
- [ ] **Step 7.4:** `npx tsc --noEmit && npx vitest run && npx eslint .` sạch/xanh; `npx next build` pass.
- [ ] **Step 7.5:** Final code review subagent toàn implementation; rồi `git push origin main`. Mở `/f/warehouse` kiểm tab + danh sách món.
