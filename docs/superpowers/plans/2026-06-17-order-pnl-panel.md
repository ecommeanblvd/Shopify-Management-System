# Order P&L Panel Implementation Plan (Plan A — panel)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay panel chi tiết order thành bảng so sánh thu–chi: cân đối margin SP & Ship (chống set-up lỗ) + "Revenue mình tạo ra" = GMV − (giá vốn, ship carrier, transaction fee, discount, refund).

**Architecture:** Một module thuần `pnl.ts` tính toàn bộ con số (đơn vị VND, không I/O) → dễ test. `getOrderDetail` lắp ráp input (quy USD→VND qua FX của store) và trả về object `pnl`. Component `OrderPnlPanel` render layout 2 cột THU/CHI + 2 thẻ cân đối margin + banner Revenue. Transaction fee tạm để `null` (Plan B nạp số thực) → panel vẫn hoạt động, hiện "chưa có phí GD".

**Tech Stack:** Next.js (App Router), TypeScript, Drizzle, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-order-detail-pnl-panel-design.md`

---

## File Structure

- **Create** `features/shopify-orders/pnl.ts` — hàm thuần `computeOrderPnl(input)` → P&L + 2 margin + cờ. Input/output đều VND.
- **Create** `features/shopify-orders/pnl.test.ts` — unit test.
- **Modify** `features/shopify-orders/order-actions.ts` — `getOrderDetail` thêm: total discount, total refund, và object `pnl` (gọi `computeOrderPnl`). Thêm field vào `OrderDetail`.
- **Create** `components/shopify-orders/OrderPnlPanel.tsx` — render bảng P&L (read-only) từ `OrderDetail`.
- **Modify** `components/shopify-orders/OrdersTable.tsx` — `OrderEditForm` dùng `OrderPnlPanel` cho phần read-only thay cho bảng "Shipping cost" cũ; giữ nguyên Edit mode (line cost + weight).

---

## Task 1: Pure P&L module

**Files:**
- Create: `features/shopify-orders/pnl.ts`
- Test: `features/shopify-orders/pnl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// features/shopify-orders/pnl.test.ts
import { describe, it, expect } from 'vitest';
import { computeOrderPnl, type PnlInput } from './pnl';

const base: PnlInput = {
  subtotalVnd: 35_812_080,
  shippingRevenueVnd: 2_987_920,
  discountVnd: 0,
  refundVnd: 0,
  skuCostVnd: 18_000_000,
  skuCostComplete: true,
  shipCostVnd: 3_674_855,
  shipCostSource: 'billed',
  transactionFeeVnd: 1_126_000,
};

describe('computeOrderPnl', () => {
  it('Revenue = GMV − (discount+refund+vốn+ship+txn); % theo GMV', () => {
    const r = computeOrderPnl(base);
    expect(r.gmvVnd).toBe(38_800_000);
    expect(r.thuThuanVnd).toBe(38_800_000);            // GMV − 0 − 0
    expect(r.tongChiVnd).toBe(22_800_855);             // 18,000,000 + 3,674,855 + 1,126,000
    expect(r.revenueVnd).toBe(15_999_145);
    expect(r.revenuePct).toBeCloseTo(41.24, 1);
    expect(r.complete).toBe(true);
  });

  it('Margin SP = bán − vốn (cờ ok khi ≥0)', () => {
    const r = computeOrderPnl(base);
    expect(r.marginSp).toEqual({ revenueVnd: 35_812_080, costVnd: 18_000_000, deltaVnd: 17_812_080, pct: expect.closeTo(49.74, 1), loss: false, missing: false });
  });

  it('Margin Ship lỗ khi thu < chi → loss=true', () => {
    const r = computeOrderPnl(base); // thu 2,987,920 < chi 3,674,855
    expect(r.marginShip.deltaVnd).toBe(-686_935);
    expect(r.marginShip.loss).toBe(true);
    expect(r.marginShip.source).toBe('billed');
  });

  it('thiếu giá vốn → marginSp.missing, tongChi & revenue null + complete=false', () => {
    const r = computeOrderPnl({ ...base, skuCostVnd: null, skuCostComplete: false });
    expect(r.marginSp.missing).toBe(true);
    expect(r.tongChiVnd).toBeNull();
    expect(r.revenueVnd).toBeNull();
    expect(r.complete).toBe(false);
  });

  it('chưa có billed → dùng engine, source=engine (tạm tính)', () => {
    const r = computeOrderPnl({ ...base, shipCostVnd: 2_158_892, shipCostSource: 'engine' });
    expect(r.marginShip.source).toBe('engine');
    expect(r.marginShip.deltaVnd).toBe(2_987_920 - 2_158_892);
  });

  it('ship cost null (unknown) → marginShip.missing, revenue null', () => {
    const r = computeOrderPnl({ ...base, shipCostVnd: null, shipCostSource: 'unknown' });
    expect(r.marginShip.missing).toBe(true);
    expect(r.revenueVnd).toBeNull();
  });

  it('transactionFee null → loại khỏi tổng chi nhưng KHÔNG chặn revenue (chỉ cảnh báo)', () => {
    const r = computeOrderPnl({ ...base, transactionFeeVnd: null });
    expect(r.tongChiVnd).toBe(18_000_000 + 3_674_855); // không cộng txn
    expect(r.feeMissing).toBe(true);
    expect(r.revenueVnd).toBe(38_800_000 - (18_000_000 + 3_674_855));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/shopify-orders/pnl.test.ts`
Expected: FAIL — "Cannot find module './pnl'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// features/shopify-orders/pnl.ts
/**
 * Tính P&L "Revenue mình tạo ra" + cân đối margin cho 1 đơn. THUẦN, không I/O.
 * Mọi input/output là VND (caller quy USD→VND qua FX trước khi gọi).
 */

export type ShipCostSource = 'billed' | 'engine' | 'unknown';

export interface PnlInput {
  subtotalVnd: number;            // giá bán SP (đã quy VND)
  shippingRevenueVnd: number;     // phí ship khách trả (đã quy VND)
  discountVnd: number;            // tổng discount (đã quy VND)
  refundVnd: number;              // tổng refund/return (đã quy VND)
  skuCostVnd: number | null;      // giá vốn SP; null khi thiếu dữ liệu
  skuCostComplete: boolean;       // đủ giá vốn mọi dòng chưa
  shipCostVnd: number | null;     // ship carrier (billed hoặc engine); null khi unknown
  shipCostSource: ShipCostSource;
  transactionFeeVnd: number | null; // null khi chưa sync
}

export interface MarginPair {
  revenueVnd: number;             // vế thu (giá bán / ship thu)
  costVnd: number;                // vế chi (giá vốn / ship carrier)
  deltaVnd: number;               // thu − chi
  pct: number;                    // delta / thu × 100
  loss: boolean;                  // delta < 0
  missing: boolean;               // thiếu dữ liệu chi → không tính được
  source?: ShipCostSource;        // chỉ marginShip
}

export interface PnlResult {
  gmvVnd: number;
  thuThuanVnd: number;
  tongChiVnd: number | null;      // null khi thiếu giá vốn
  revenueVnd: number | null;
  revenuePct: number | null;
  marginSp: MarginPair;
  marginShip: MarginPair;
  feeMissing: boolean;            // transaction fee chưa có
  complete: boolean;              // đủ dữ liệu để chốt revenue
}

const pct = (delta: number, denom: number): number => (denom > 0 ? (delta / denom) * 100 : 0);

export function computeOrderPnl(i: PnlInput): PnlResult {
  const gmvVnd = i.subtotalVnd + i.shippingRevenueVnd;
  const thuThuanVnd = gmvVnd - i.discountVnd - i.refundVnd;

  // Margin SP
  const spMissing = i.skuCostVnd === null || !i.skuCostComplete;
  const spCost = i.skuCostVnd ?? 0;
  const marginSp: MarginPair = {
    revenueVnd: i.subtotalVnd, costVnd: spCost, deltaVnd: i.subtotalVnd - spCost,
    pct: pct(i.subtotalVnd - spCost, i.subtotalVnd), loss: !spMissing && i.subtotalVnd - spCost < 0,
    missing: spMissing,
  };

  // Margin Ship
  const shipMissing = i.shipCostVnd === null || i.shipCostSource === 'unknown';
  const shipCost = i.shipCostVnd ?? 0;
  const marginShip: MarginPair = {
    revenueVnd: i.shippingRevenueVnd, costVnd: shipCost, deltaVnd: i.shippingRevenueVnd - shipCost,
    pct: pct(i.shippingRevenueVnd - shipCost, i.shippingRevenueVnd),
    loss: !shipMissing && i.shippingRevenueVnd - shipCost < 0,
    missing: shipMissing, source: i.shipCostSource,
  };

  const feeMissing = i.transactionFeeVnd === null;
  // Revenue cần đủ giá vốn + ship; transaction fee thiếu chỉ cảnh báo (coi = 0).
  const canTotal = !spMissing && !shipMissing;
  const tongChiVnd = canTotal ? spCost + shipCost + (i.transactionFeeVnd ?? 0) : null;
  const revenueVnd = tongChiVnd === null ? null : thuThuanVnd - tongChiVnd;
  const revenuePct = revenueVnd === null ? null : pct(revenueVnd, gmvVnd);

  return {
    gmvVnd, thuThuanVnd, tongChiVnd, revenueVnd, revenuePct,
    marginSp, marginShip, feeMissing, complete: canTotal,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/shopify-orders/pnl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/pnl.ts features/shopify-orders/pnl.test.ts
git commit -m "feat(orders): module thuần tính P&L + cân đối margin SP/Ship"
```

---

## Task 2: getOrderDetail trả về object `pnl`

**Files:**
- Modify: `features/shopify-orders/order-actions.ts` (interface `OrderDetail` + hàm `getOrderDetail`)

Bối cảnh sẵn có trong `getOrderDetail`:
- `lines` (mỗi dòng: `unitPrice`, `quantity`, `costOverride`, `defaultCostPerUnit`).
- `order.totalDiscount` (cột schema — Shopify totalDiscountsSet), `order.currency`.
- `store.fxCostPerOrderCurrency` (đã select), `store.costCurrency`.
- `defaultShipping`/`engineCostVnd`/`billedCostVnd` (đã tính). `billedFromCharges` (đã có — ship billed VND).
- `shopify_order_refunds` (bảng refund theo order).

- [ ] **Step 1: Thêm import + query refund + discount**

Trong `getOrderDetail`, sau khi đã có `order` và `lines`, thêm:

```typescript
import { computeOrderPnl, type ShipCostSource } from './pnl';
// ... trong getOrderDetail, gần các query khác:
const refundRows = await db
  .select({ amt: schema.shopifyOrderRefunds.amount })
  .from(schema.shopifyOrderRefunds)
  .where(eq(schema.shopifyOrderRefunds.orderId, orderId));
const refundOrderCcy = refundRows.reduce((s, r) => s + Number(r.amt), 0);
```

(Nếu cột tên khác `amount`, mở `db/schema.ts` quanh `shopifyOrderRefunds` để lấy đúng tên cột số tiền refund.)

- [ ] **Step 2: Lắp ráp input P&L (quy USD→VND qua FX) và gọi computeOrderPnl**

Đặt ngay trước `return {` cuối hàm. `fx` = số VND cho 1 đơn-vị order-currency. Khi order ccy == cost ccy thì fx = 1.

```typescript
const fx = order.currency === (store?.costCurrency ?? order.currency)
  ? 1
  : (store?.fxCostPerOrderCurrency != null ? Number(store.fxCostPerOrderCurrency) : null);

const subtotalOrderCcy = lines.reduce((s, l) => s + Number(l.unitPrice) * l.quantity, 0);
const discountOrderCcy = order.totalDiscount != null ? Number(order.totalDiscount) : 0;

// giá vốn: costOverride ?? defaultCostPerUnit, ×qty (đã ở cost currency = VND)
let skuCostVnd = 0; let skuComplete = true;
for (const l of lines) {
  const unit = l.costOverride !== null ? Number(l.costOverride)
    : (l.defaultCostPerUnit !== null ? l.defaultCostPerUnit : null);
  if (unit === null) { skuComplete = false; continue; }
  skuCostVnd += unit * l.quantity;
}

// ship carrier: billed ưu tiên, else engine, else unknown
const shipCostVnd = billedFromCharges ?? engineCostVnd ?? null;
const shipCostSource: ShipCostSource =
  billedFromCharges != null ? 'billed' : engineCostVnd != null ? 'engine' : 'unknown';

const toVnd = (v: number) => (fx === null ? null : Math.round(v * fx));
const subtotalVnd = toVnd(subtotalOrderCcy);
const shippingRevenueVnd = toVnd(Number(order.totalShipping));
const discountVnd = toVnd(discountOrderCcy);
const refundVnd = toVnd(refundOrderCcy);

const pnl = (subtotalVnd === null || shippingRevenueVnd === null)
  ? null // thiếu FX → component hiện "đặt tỉ giá"
  : computeOrderPnl({
      subtotalVnd, shippingRevenueVnd,
      discountVnd: discountVnd ?? 0, refundVnd: refundVnd ?? 0,
      skuCostVnd: skuComplete ? skuCostVnd : (skuCostVnd || null),
      skuCostComplete: skuComplete,
      shipCostVnd, shipCostSource,
      transactionFeeVnd: null, // Plan B nạp số thực
    });
```

- [ ] **Step 3: Thêm `pnl` (và raw vế cho UI) vào interface + return**

Trong `interface OrderDetail` thêm:

```typescript
  /** P&L tính sẵn (VND). null khi thiếu FX để quy đổi. Xem features/shopify-orders/pnl.ts */
  pnl: import('./pnl').PnlResult | null;
  /** true khi store chưa set FX nên không quy được order-ccy→VND. */
  needsFx: boolean;
```

Trong object `return { ... }` thêm: `pnl, needsFx: pnl === null,`.

- [ ] **Step 4: Verify build + types**

Run: `npx tsc --noEmit 2>&1 | grep -i order-actions`
Expected: không có dòng lỗi (output rỗng).

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/order-actions.ts
git commit -m "feat(orders): getOrderDetail trả về object pnl (Revenue + margin), quy VND qua FX"
```

---

## Task 3: Component OrderPnlPanel (read-only) + lắp vào modal

**Files:**
- Create: `components/shopify-orders/OrderPnlPanel.tsx`
- Modify: `components/shopify-orders/OrdersTable.tsx` (trong `OrderEditForm`, phần read-only)

- [ ] **Step 1: Tạo OrderPnlPanel.tsx**

```tsx
// components/shopify-orders/OrderPnlPanel.tsx
'use client';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';

const vnd = (n: number | null | undefined) =>
  n == null ? '—' : `₫${Math.round(n).toLocaleString('vi-VN')}`;
const pctTxt = (n: number | null | undefined) => (n == null ? '' : `${n.toFixed(1)}%`);

export function OrderPnlPanel({ detail }: { detail: OrderDetail }) {
  const p = detail.pnl;
  if (!p) {
    return (
      <div className="rounded-lg border border-amber-400/50 bg-amber-50/40 dark:bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
        Chưa đặt tỉ giá cho store → không quy đổi được sang VND. Đặt tỉ giá để xem P&L.
      </div>
    );
  }
  const mp = p.marginSp; const ms = p.marginShip;
  const cell = (loss: boolean, missing: boolean) =>
    missing ? 'text-muted-foreground' : loss ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="space-y-4 text-sm">
      {/* CÂN ĐỐI MARGIN */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Cân đối margin — đã đủ chưa?</div>
        <div className="grid grid-cols-2 gap-3">
          {/* SP */}
          <div className="rounded-lg border border-border p-2.5 space-y-0.5">
            <Row label="SP — bán" value={vnd(mp.revenueVnd)} />
            <Row label="SP — vốn" value={mp.missing ? 'thiếu giá vốn' : vnd(mp.costVnd)} />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(mp.loss, mp.missing)}`}>
              <span>{mp.missing ? 'Margin SP' : mp.loss ? '⚠ Margin SP' : '✓ Margin SP'}</span>
              <span>{mp.missing ? '—' : `${mp.deltaVnd >= 0 ? '+' : ''}${vnd(mp.deltaVnd)} · ${pctTxt(mp.pct)}`}</span>
            </div>
          </div>
          {/* Ship */}
          <div className={`rounded-lg border p-2.5 space-y-0.5 ${ms.loss ? 'border-red-500/40 bg-red-500/5' : 'border-border'}`}>
            <Row label="Ship — thu khách" value={vnd(ms.revenueVnd)} />
            <Row label={`Ship — DHL/FedEx${ms.source === 'engine' ? ' (tạm tính)' : ''}`} value={ms.missing ? 'chưa có' : vnd(ms.costVnd)} />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(ms.loss, ms.missing)}`}>
              <span>{ms.missing ? 'Margin Ship' : ms.loss ? '⚠ Margin Ship' : '✓ Margin Ship'}</span>
              <span>{ms.missing ? '—' : `${ms.deltaVnd >= 0 ? '+' : ''}${vnd(ms.deltaVnd)} · ${pctTxt(ms.pct)}`}</span>
            </div>
          </div>
        </div>
        {ms.loss && (
          <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">⚠ Ship đang lỗ — set-up phí ship chưa đủ cover carrier cho đơn/zone này.</p>
        )}
      </div>

      {/* P&L hai cột */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-2.5 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">Thu (khách trả)</div>
          <Row label="Giá bán + Ship" value={vnd(p.gmvVnd)} />
          <Row label="− Discount/Refund" value={vnd((p.gmvVnd - p.thuThuanVnd))} red />
          <div className="flex justify-between font-semibold border-t border-border/60 pt-1"><span>= Thu thuần</span><span>{vnd(p.thuThuanVnd)}</span></div>
        </div>
        <div className="rounded-lg border border-border p-2.5 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400 font-semibold">Chi (trả đối tác)</div>
          <Row label="Giá vốn + Ship" value={p.tongChiVnd == null ? '—' : vnd(p.marginSp.costVnd + p.marginShip.costVnd)} />
          <Row label="Transaction fee" value={p.feeMissing ? 'chưa có phí GD' : vnd(p.tongChiVnd! - p.marginSp.costVnd - p.marginShip.costVnd)} amber />
          <div className="flex justify-between font-semibold border-t border-border/60 pt-1"><span>= Tổng chi</span><span>{vnd(p.tongChiVnd)}</span></div>
        </div>
      </div>

      {/* Revenue banner */}
      <div className={`flex items-center justify-between rounded-lg border p-3 ${(p.revenueVnd ?? 0) >= 0 ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-red-500/50 bg-red-500/5'}`}>
        <span className={`font-bold ${(p.revenueVnd ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>REVENUE mình tạo ra</span>
        <span className={`font-bold text-lg ${(p.revenueVnd ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {p.revenueVnd == null ? 'thiếu dữ liệu' : `${vnd(p.revenueVnd)} · ${pctTxt(p.revenuePct)} / GMV`}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, red, amber }: { label: string; value: string; red?: boolean; amber?: boolean }) {
  return (
    <div className={`flex justify-between ${red ? 'text-red-600 dark:text-red-400' : amber ? 'text-amber-600 dark:text-amber-400' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Lắp vào OrderEditForm (thay khối "Shipping cost" cũ ở chế độ xem)**

Trong `components/shopify-orders/OrdersTable.tsx`, ở `OrderEditForm` return: thay nguyên `<section>` "Shipping cost" (khối `computeShipComparison` + bảng Rev/engine/billed/biên) bằng:

```tsx
import { OrderPnlPanel } from './OrderPnlPanel';
// ...
{/* P&L panel (read-only). Chi tiết ship engine-vs-billed giữ ở drill-down dưới. */}
<section>
  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">P&L đơn hàng</div>
  <OrderPnlPanel detail={detail} />
</section>
```

Giữ nguyên: header (ngày xử lý/đi hàng), `<AddressVerifyCard>`, bảng Line items, khối weight/note (Edit mode), footer (Sửa/Lưu/Huỷ). KHÔNG xoá `computeShipComparison` import nếu còn dùng ở drill-down; nếu không còn tham chiếu, xoá import để tránh lint unused.

- [ ] **Step 3: Verify types + build**

Run: `npx tsc --noEmit 2>&1 | grep -iE "OrderPnlPanel|OrdersTable"`
Expected: rỗng. Sau đó `npm run build` chạy tới hết (route list in ra).

- [ ] **Step 4: Verify thủ công (chạy app)**

Mở 1 đơn đã có billed (vd #MBLVD27682): kiểm
- Margin Ship đỏ (thu < billed) + dòng cảnh báo.
- Banner Revenue hiện số + % /GMV.
- "Transaction fee" hiện "chưa có phí GD".
- Đơn thiếu giá vốn → Margin SP "thiếu giá vốn", Revenue "thiếu dữ liệu".

- [ ] **Step 5: Commit**

```bash
git add components/shopify-orders/OrderPnlPanel.tsx components/shopify-orders/OrdersTable.tsx
git commit -m "feat(orders): panel P&L 2 cột THU/CHI + cân đối margin SP/Ship trong order detail"
```

---

## Self-Review notes

- Spec §2 công thức ↔ Task 1 `computeOrderPnl` (Revenue + 2 margin) ✓
- Spec §5 layout (margin checks → 2 cột → banner → drilldown → Sửa) ↔ Task 3 ✓
- Spec §3 nguồn dữ liệu ↔ Task 2 (discount=totalDiscount, refund=shopify_order_refunds, vốn=costOverride??default, ship=billed||engine) ✓
- Spec §4 transaction fee → **Plan B** (panel hiện "chưa có phí GD" tới khi Plan B nạp) ✓
- Spec §6 edge (thiếu vốn, engine fallback, FX null, refund) ↔ Task 1 tests + Task 3 render ✓

## Tiếp theo: Plan B
Sau khi Plan A xong & verify, viết `2026-06-17-order-transaction-fee-sync.md`: schema `shopify_orders.transaction_fee`, thêm field vào order sync GraphQL + upsert, script backfill, rồi đổi `transactionFeeVnd: null` ở Task 2 thành số thực (quy VND).
