# So sánh giá ship trong chi tiết đơn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chi tiết đơn hiện 3 số ship (Rev khách trả · Engine ước tính · Billed thực tế) quy về VND + biên lãi/lỗ ship.

**Architecture:** Helper thuần `computeShipComparison` (FX normalize + biên, TDD); `getOrderDetail` luôn tính cả engine lẫn billed + expose FX; OrdersTable render bảng 3 dòng + nút đặt tỉ giá khi thiếu FX.

**Tech Stack:** Next.js App Router, Drizzle, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-06-11-order-ship-comparison-design.md`

**Hằng số:** FX `fxCostPerOrderCurrency` = số đơn vị cost-currency (VND) cho 1 đơn-vị order-currency. Rev(order ccy) × fx = Rev(VND). costCurrency kỳ vọng 'VND' = tiền engine/billed.

---

### Task 1: Helper `computeShipComparison` (pure, TDD)

**Files:**
- Create: `features/shopify-orders/ship-comparison.ts`
- Test: `features/shopify-orders/ship-comparison.test.ts`

- [ ] **Step 1.1: Test FAIL trước**

```ts
import { describe, it, expect } from 'vitest';
import { computeShipComparison } from './ship-comparison';

describe('computeShipComparison', () => {
  const base = { orderCurrency: 'VND', costCurrency: 'VND', fxCostPerOrderCurrency: null,
    shippingRevenue: 200000, engineCostVnd: 150000, billedCostVnd: null, overrideVnd: null };
  it('(a) đơn VND: revVnd = revenue, biên theo engine khi chưa billed', () => {
    const r = computeShipComparison(base);
    expect(r.revVnd).toBe(200000); expect(r.costVnd).toBe(150000);
    expect(r.costBasis).toBe('engine'); expect(r.marginVnd).toBe(50000); expect(r.needsFx).toBe(false);
  });
  it('(b) đơn USD có FX: rev×fx, biên VND theo billed', () => {
    const r = computeShipComparison({ ...base, orderCurrency: 'USD', fxCostPerOrderCurrency: 25000,
      shippingRevenue: 10, billedCostVnd: 180000 });
    expect(r.revVnd).toBe(250000); expect(r.costVnd).toBe(180000);
    expect(r.costBasis).toBe('billed'); expect(r.marginVnd).toBe(70000);
  });
  it('(c) đơn USD thiếu FX → needsFx, không tính biên', () => {
    const r = computeShipComparison({ ...base, orderCurrency: 'USD', fxCostPerOrderCurrency: null });
    expect(r.needsFx).toBe(true); expect(r.revVnd).toBeNull(); expect(r.marginVnd).toBeNull();
  });
  it('(d) override đứng trên billed/engine', () => {
    const r = computeShipComparison({ ...base, billedCostVnd: 180000, overrideVnd: 120000 });
    expect(r.costVnd).toBe(120000); expect(r.costBasis).toBe('override');
  });
  it('(e) marginPct theo Rev', () => {
    const r = computeShipComparison(base);
    expect(r.marginPct).toBeCloseTo(25, 4); // 50000/200000
  });
  it('(f) rev 0 → marginPct null', () => {
    const r = computeShipComparison({ ...base, shippingRevenue: 0, engineCostVnd: 0 });
    expect(r.marginPct).toBeNull();
  });
});
```

Run: `npx vitest run features/shopify-orders/ship-comparison.test.ts` → FAIL.

- [ ] **Step 1.2: Implement**

```ts
export interface ShipComparisonInput {
  shippingRevenue: number;          // tiền đơn
  orderCurrency: string;
  costCurrency: string | null;      // kỳ vọng 'VND'
  fxCostPerOrderCurrency: number | null;
  engineCostVnd: number | null;
  billedCostVnd: number | null;
  overrideVnd: number | null;
}
export interface ShipComparison {
  revVnd: number | null;
  engineCostVnd: number | null;
  billedCostVnd: number | null;
  costVnd: number | null;
  costBasis: 'override' | 'billed' | 'engine' | null;
  marginVnd: number | null;
  marginPct: number | null;
  needsFx: boolean;
}
const VND = 'VND';
export function computeShipComparison(i: ShipComparisonInput): ShipComparison {
  const cc = i.costCurrency ?? VND;
  // Rev quy về tiền cost (VND): cùng tiền → giữ nguyên; khác tiền → ×fx; thiếu fx → null.
  const sameCcy = i.orderCurrency === cc;
  const needsFx = !sameCcy && i.fxCostPerOrderCurrency == null;
  const revVnd = sameCcy ? i.shippingRevenue
    : i.fxCostPerOrderCurrency != null ? Math.round(i.shippingRevenue * i.fxCostPerOrderCurrency)
    : null;
  // cost ưu tiên override > billed > engine.
  let costVnd: number | null = null; let costBasis: ShipComparison['costBasis'] = null;
  if (i.overrideVnd != null) { costVnd = i.overrideVnd; costBasis = 'override'; }
  else if (i.billedCostVnd != null) { costVnd = i.billedCostVnd; costBasis = 'billed'; }
  else if (i.engineCostVnd != null) { costVnd = i.engineCostVnd; costBasis = 'engine'; }
  const marginVnd = revVnd != null && costVnd != null ? revVnd - costVnd : null;
  const marginPct = marginVnd != null && revVnd ? (marginVnd / revVnd) * 100 : null;
  return { revVnd, engineCostVnd: i.engineCostVnd, billedCostVnd: i.billedCostVnd,
    costVnd, costBasis, marginVnd, marginPct, needsFx };
}
```

- [ ] **Step 1.3:** vitest file PASS; tsc sạch. Commit `feat(orders): helper computeShipComparison (FX normalize + biên)` + trailer.

---

### Task 2: `getOrderDetail` expose engine + billed + FX

**Files:**
- Modify: `features/shopify-orders/order-actions.ts` (OrderShippingDetail + getOrderDetail shipping compute ~155-285)

- [ ] **Step 2.1:** `OrderShippingDetail` thêm 5 trường:

```ts
  /** Cost engine ước tính (cost currency = VND), tính LUÔN kể cả khi đã có
   *  hóa đơn — để bảng so sánh hiện cả engine lẫn billed. null khi engine
   *  không định giá được. */
  engineCostVnd: number | null;
  /** Cost thực tế từ shipping_invoices khớp tracking (VND). null khi chưa có. */
  billedCostVnd: number | null;
  /** Tiền của đơn (order.currency) + tiền cost (order.costCurrency) + tỉ giá,
   *  cho UI quy đổi Rev về VND. */
  orderCurrency: string;
  costCurrency: string | null;
  fxCostPerOrderCurrency: number | null;
```

- [ ] **Step 2.2:** Trong getOrderDetail, sau khối `defaultShipping` (giữ nguyên cho breakdown), tính riêng:

```ts
  // billed: lấy từ invoice nếu khối default đã khớp invoice (cùng query), hoặc
  // truy thẳng — defaultShipping.source==='invoice' nghĩa là rawAmount là billed.
  const billedCostVnd = defaultShipping.source === 'invoice' ? defaultShipping.rawAmount : null;
  // engine: tính LUÔN (kể cả khi đã có billed) để bảng so sánh có cả hai.
  // Nếu khối default đã là engine_estimate thì tái dùng rawAmount, khỏi gọi lại.
  let engineCostVnd: number | null =
    defaultShipping.source === 'engine_estimate' ? defaultShipping.rawAmount : null;
  if (engineCostVnd === null) {
    const effW = order.shipWeightKgOverride !== null ? Number(order.shipWeightKgOverride)
      : order.shipWeightKg !== null ? Number(order.shipWeightKg) : null;
    const est = await resolveShippingEstimate({
      shipCountry: order.shipCountry, shipCity: order.shipCity, shipPostcode: order.shipPostcode,
      shipWeightKg: effW, effectiveDate: order.processedAtShopify ?? undefined,
      shippingCarrierKey: order.shippingCarrierKey ?? null,
    });
    engineCostVnd = est.source !== 'unknown' ? est.costAmount : null;
  }
```

(Xác nhận `est.costAmount` là số tiền cost-currency/VND — cùng nguồn `rawAmount` của khối default; nếu tên khác, dùng đúng field VND.)

- [ ] **Step 2.3:** Khối return `shipping: {...}` thêm:

```ts
      engineCostVnd,
      billedCostVnd,
      orderCurrency: order.currency,
      costCurrency: order.costCurrency ?? null,
      fxCostPerOrderCurrency: order.fxCostPerOrderCurrency !== null ? Number(order.fxCostPerOrderCurrency) : null,
```

- [ ] **Step 2.4:** tsc sạch; `npx vitest run` xanh (interface mở rộng — chỉ thêm field, không vỡ). Commit `feat(orders): getOrderDetail expose engineCostVnd/billedCostVnd/FX` + trailer.

---

### Task 3: UI bảng so sánh trong modal

**Files:**
- Modify: `components/shopify-orders/OrdersTable.tsx` (mục "Shipping cost" ~488-540)

- [ ] **Step 3.1:** Trong section Shipping cost, TRƯỚC/THAY phần render hiện tại, dựng bảng so sánh:

```tsx
// đầu component detail: tính comparison
const cmp = computeShipComparison({
  shippingRevenue: detail.shipping.shippingRevenue,
  orderCurrency: detail.shipping.orderCurrency,
  costCurrency: detail.shipping.costCurrency,
  fxCostPerOrderCurrency: detail.shipping.fxCostPerOrderCurrency,
  engineCostVnd: detail.shipping.engineCostVnd,
  billedCostVnd: detail.shipping.billedCostVnd,
  overrideVnd: detail.shipping.shippingCostOverride,  // override cùng tiền cost (VND)
});
```

Render bảng (dùng `fmt`/format VND hiện có; tất cả số VND):
- **Rev ship (khách trả)**: `cmp.revVnd` (nếu `orderCurrency !== 'VND'` hiện thêm `(detail.shipping.shippingRevenue + ' ' + orderCurrency)` trong ngoặc). Khi `needsFx` → hiện Rev tiền gốc + `<CostFxButton>` (props như chỗ COGS dùng) thay vì revVnd.
- **Hệ thống tính (engine)**: `cmp.engineCostVnd` hoặc "—"; GIỮ `<ShippingCostBreakdown>` mở rộng bên dưới khi `defaultSource==='engine_estimate'` (như cũ).
- **Billed thực tế**: `cmp.billedCostVnd` hoặc "Chưa có hóa đơn".
- **Biên ship**: `cmp.marginVnd` — màu `text-emerald-600` nếu ≥0, `text-red-600` nếu <0; kèm `cmp.marginPct?.toFixed(1)%`; nhãn nhỏ "(theo {costBasis})". Khi `marginVnd === null` (needsFx) → ẩn dòng biên, hiện hint "Đặt tỉ giá để xem biên".

Giữ nhánh `defaultSource==='unknown'` (UnknownShippingDiagnostic) như cũ ở dòng engine. Bỏ comment cũ "Shipping revenue ... deliberately NOT shown" (giờ đã hiện có chủ đích).

- [ ] **Step 3.2:** import `computeShipComparison` từ `@/features/shopify-orders/ship-comparison`. tsc + eslint sạch; `npx vitest run` xanh. Đọc lại JSX 1 lượt. Commit `feat(orders): bảng so sánh ship (Rev/engine/billed) + biên trong modal` + trailer.

---

### Task 4: Tổng kiểm + push

- [ ] **Step 4.1:** `npx tsc --noEmit && npx vitest run` (mong +6 test mới) && `npx eslint .` (0 errors).
- [ ] **Step 4.2:** `npx next build` pass.
- [ ] **Step 4.3:** (tuỳ chọn) probe 1 đơn Mirer (USD) có FX + 1 đơn meanblvd (VND) qua getOrderDetail script tạm để xác nhận 3 số + biên hợp lý; xoá probe.
- [ ] **Step 4.4:** Final review subagent toàn diff; `git push origin main`. Mở 1 đơn trong `/f/orders/[storeId]` xem bảng so sánh.
