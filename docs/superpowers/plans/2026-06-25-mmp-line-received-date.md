# Gửi ngày nhận hàng per-line sang MMP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đẩy ngày hàng về kho theo từng sản phẩm (`receivedAt` mỗi line) sang MMP, và re-push tự động khi nhận hàng, để MMP tính công nợ theo brand.

**Architecture:** Thêm `receivedAt` vào mỗi MMP order line; `buildOrderMmpBody` tính ngày nhận mới nhất per fulfillment line (từ `goods_receipt_items` allocate_to_order → `goods_receipts.received_at`). Re-push tái dùng hash idempotency sẵn có — trigger `pushOrderToMmp` ở `recordQc` khi item allocate vào đơn.

**Tech Stack:** Next.js (server actions), Drizzle, Vitest, HMAC-signed MMP outbound.

## Global Constraints

- `receivedAt` per-line (mỗi sản phẩm 1 ngày), KHÔNG phải cấp đơn. Line chưa nhận → `null`.
- 1 line nhận nhiều lần → ngày **mới nhất** (`max(received_at)`). Chỉ tính item `disposition='allocate_to_order'`.
- Re-push best-effort (fire-and-forget) ở `recordQc`; lỗi push KHÔNG làm fail recordQc. Idempotency = hash payload sẵn có (`hashOrderPayload`/`shouldPushOrder`).
- `placedAt` + các field khác giữ nguyên. Không migration (received_at đã có).
- Verify mỗi task: `npx tsc --noEmit`; thêm `npx vitest run` cho task có test; `npm run lint` (0 errors) + `npm run build` ở task cuối.
- Branch: `feat/mmp-line-received-date` (đã tạo, spec commit `1e89a0e`).

---

### Task 1: `MmpOrderLine.receivedAt` + buildMmpOrderPayload

**Files:**
- Modify: `features/mmp/order-push-logic.ts`
- Test: `features/mmp/order-push-logic.test.ts`

**Interfaces:**
- Produces: `MmpOrderLine` gồm `receivedAt: string | null`; `buildMmpOrderPayload` map `receivedAt` vào mỗi line.

- [ ] **Step 1: Cập nhật test (key set + case receivedAt)**

Trong `features/mmp/order-push-logic.test.ts`, sửa case 1: thêm `receivedAt` vào input line + expected, và đổi key-set assertion. Thay block `it('chỉ gồm field đã chốt...')` thành:

```ts
  it('chỉ gồm field đã chốt (không PII chi tiết); line gồm vendor + receivedAt', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z',
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z',
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    expect(Object.keys(p).sort()).toEqual(['lines','orderNumber','placedAt','recipientName','shipCountry','store']);
    expect(Object.keys(p.lines[0]).sort()).toEqual(['qty','receivedAt','sku','title','vendor']);
  });
```

Và sửa case 2 (thêm `receivedAt` cho 2 line — 1 có, 1 null):

```ts
  it('giữ nguyên thứ tự + nhiều dòng brand; vendor null + receivedAt null cho line chưa nhận', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE', placedAt: null,
      brandLines: [{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }]);
    expect(p.placedAt).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/mmp/order-push-logic.test.ts`
Expected: FAIL — line thiếu `receivedAt` (type + assertion mismatch).

- [ ] **Step 3: Implement**

Trong `features/mmp/order-push-logic.ts`:
- `MmpOrderLine`: thêm `receivedAt`:
```ts
export interface MmpOrderLine { sku: string | null; title: string; qty: number; vendor: string | null; receivedAt: string | null }
```
- `buildMmpOrderPayload` input type `brandLines: MmpOrderLine[]` (đã là MmpOrderLine — tự có receivedAt). Trong map line output, thêm `receivedAt`:
```ts
    lines: input.brandLines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, vendor: l.vendor, receivedAt: l.receivedAt })),
```
- Cập nhật comment `MmpOrderPayload` nếu cần (receivedAt per line = ngày hàng về kho, để MMP đối soát công nợ theo brand).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/mmp/order-push-logic.test.ts`
Expected: PASS (2 case).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output (chú ý: `buildOrderMmpBody` ở order-outbound.ts sẽ TẠM lỗi vì brandLines thiếu receivedAt — Task 2 sửa. Nếu tsc lỗi CHỈ ở order-outbound.ts dòng brandLines, chấp nhận tạm? KHÔNG: để tsc xanh, thêm `receivedAt: null` tạm vào brandLines map ở order-outbound.ts trong task này, Task 2 thay bằng giá trị thật.)

Thêm tạm trong `features/mmp/order-outbound.ts` brandLines map: `receivedAt: null` (Task 2 thay bằng map thật) — để tsc xanh ngay task này.

```bash
git add features/mmp/order-push-logic.ts features/mmp/order-push-logic.test.ts features/mmp/order-outbound.ts
git commit -m "feat(ops): MmpOrderLine.receivedAt (per-line ngày nhận, MMP công nợ)"
```

---

### Task 2: Tính receivedAt per-line trong buildOrderMmpBody

**Files:**
- Modify: `features/mmp/order-outbound.ts`

**Interfaces:**
- Consumes: `MmpOrderLine.receivedAt` (Task 1); `schema.goodsReceiptItems`, `schema.goodsReceipts`.
- Produces: brandLines mỗi line có `receivedAt` thật (max received_at, allocate_to_order) thay cho `null` tạm.

- [ ] **Step 1: Thêm import drizzle + schema**

Trong `features/mmp/order-outbound.ts`, dòng import drizzle hiện `import { eq, sql } from 'drizzle-orm';` → thêm `and, inArray`:
```ts
import { and, eq, inArray, sql } from 'drizzle-orm';
```
(`db, schema` đã import.)

- [ ] **Step 2: Thêm `id` vào fLines select**

Trong `fLines` select, thêm `id`:
```ts
  const fLines = await db.select({
      id: schema.orderFulfillmentLines.id,
      sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status,
      title: schema.shopifyOrderLines.productTitle, vendor: schema.shopifyOrderLines.vendor,
    })
```

- [ ] **Step 3: Query received per line + map vào brandLines**

Sau dòng `const brand = fLines.filter((l) => isBrandStatus(l.status));` và check `no brand lines`, TRƯỚC khi dựng `brandLines`, thêm:

```ts
  // Ngày nhận hàng MỚI NHẤT per line (chỉ item allocate_to_order = giữ cho đơn) — để MMP đối soát công nợ.
  const lineIds = brand.map((l) => l.id);
  const recvRows = lineIds.length
    ? await db.select({
        lineId: schema.goodsReceiptItems.fulfillmentLineId,
        receivedAt: sql<Date | null>`max(${schema.goodsReceipts.receivedAt})`,
      })
      .from(schema.goodsReceiptItems)
      .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
      .where(and(
        inArray(schema.goodsReceiptItems.fulfillmentLineId, lineIds),
        eq(schema.goodsReceiptItems.disposition, 'allocate_to_order'),
      ))
      .groupBy(schema.goodsReceiptItems.fulfillmentLineId)
    : [];
  const recvByLine = new Map<string, Date>();
  for (const r of recvRows) { if (r.lineId && r.receivedAt) recvByLine.set(r.lineId, r.receivedAt as Date); }
```

Đổi `brandLines` map để dùng `l.id` + `receivedAt`:
```ts
  const brandLines: MmpOrderLine[] = brand.map((l) => {
    const ra = recvByLine.get(l.id);
    return { sku: l.sku, title: l.title ?? l.sku ?? '', qty: l.qty, vendor: l.vendor ?? null, receivedAt: ra ? ra.toISOString() : null };
  });
```

(Bỏ dòng `receivedAt: null` tạm của Task 1.)

- [ ] **Step 4: Verify tsc + suite**

Run: `npx tsc --noEmit` → no output.
Run: `npx vitest run` → toàn bộ xanh.

- [ ] **Step 5: Commit**

```bash
git add features/mmp/order-outbound.ts
git commit -m "feat(ops): buildOrderMmpBody tính receivedAt per-line (max, allocate_to_order)"
```

---

### Task 3: Re-push khi nhận hàng (recordQc)

**Files:**
- Modify: `features/receiving/actions.ts`

**Interfaces:**
- Consumes: `pushOrderToMmp` (order-outbound); `item.orderId` + `disposition` trong `recordQc`.
- Produces: sau khi allocate item vào đơn → re-push đơn (best-effort).

- [ ] **Step 1: Capture orderId cần re-push (trong tx) + fire post-tx**

Trong `features/receiving/actions.ts`, hàm `recordQc`:
- TRƯỚC khối `await db.transaction(async (tx) => {`, thêm biến ngoài (cạnh `let storedSku` nếu có):
```ts
  let repushOrderId: string | null = null;
```
- Trong khối `else if (disposition === 'allocate_to_order') { ... }` (sau khi set staging), thêm:
```ts
      if (item.orderId) repushOrderId = item.orderId;
```
- SAU khi `await db.transaction(...)` kết thúc (cùng chỗ post-tx `reallocateSku`/`storedSku` đang xử lý), thêm:
```ts
  // Re-push đơn sang MMP để cập nhật ngày nhận hàng per-line (best-effort, không chặn).
  if (repushOrderId) {
    const oid = repushOrderId;
    void import('@/features/mmp/order-outbound')
      .then(({ pushOrderToMmp }) => pushOrderToMmp(oid))
      .catch((e) => console.error('[mmp] re-push sau nhận hàng lỗi:', e instanceof Error ? e.message : e));
  }
```

> Dùng `void import(...)` (dynamic) để fire-and-forget + tránh vòng phụ thuộc nếu có. Nếu file đã import tĩnh được `pushOrderToMmp` không gây cycle, có thể import tĩnh + `void pushOrderToMmp(oid).catch(...)` — implementer chọn cách tsc/lint sạch.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npm run build`
Expected: tsc no output; vitest toàn bộ pass; lint 0 errors; build xanh.

- [ ] **Step 3: Commit**

```bash
git add features/receiving/actions.ts
git commit -m "feat(ops): re-push MMP khi recordQc allocate item vào đơn (ngày nhận)"
```

---

## Self-Review

**Spec coverage:**
- §4.1 MmpOrderLine.receivedAt + buildMmpOrderPayload → Task 1. §4.2 test → Task 1. §4.3 buildOrderMmpBody per-line received → Task 2. §4.4 trigger recordQc → Task 3. §5 guard (null khi chưa nhận, best-effort, allocate_to_order only) → Task 2 (filter) + Task 3 (fire-and-forget). §6 test thuần → Task 1. Đủ.

**Type consistency:**
- `MmpOrderLine` shape (Task 1) = brandLines dựng ở order-outbound (Task 2). ✔
- `receivedAt: string | null` xuyên suốt (ISO hoặc null); aggregate trả `Date` → `.toISOString()`. ✔
- Task 1 đặt `receivedAt: null` tạm ở order-outbound để tsc xanh; Task 2 thay bằng map thật. ✔
- `pushOrderToMmp(orderId)` (order-outbound) = gọi ở recordQc (Task 3). ✔
- `disposition='allocate_to_order'` nhất quán giữa filter (Task 2) + trigger (Task 3). ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command. ✔
