# Ship hộ — Giá offer markup base-only (Plan A: production) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi công thức giá thu partner ship hộ sang markup CHỈ trên cước base (`charged = carrierCost + base×markup%`), fuel/phụ phí/VAT pass-through nguyên giá FedEx, kèm sàn markup ≥ 30% và clear đơn test Kalisa để tính lại.

**Architecture:** Một core thuần `offer-pricing.ts` là nguồn sự thật công thức; `quote-adapter` bổ sung `pickBaseVnd` để lấy base về VND và trả kèm `baseVnd`; luồng quote-line + requote đơn gọi core; `partners-actions` chặn markup < 30% (create + update); UI hiện badge cảnh báo; một action clear+requote cho đơn Kalisa.

**Tech Stack:** Next.js (App Router, breaking-changes fork — đọc `node_modules/next/dist/docs/` nếu chạm API Next), Drizzle ORM (PostgreSQL), Vitest, React client component.

## Global Constraints

- Ngôn ngữ UI + commit message: tiếng Việt.
- Công thức chốt: `chargedVnd = round(carrierCostVnd) + round(baseVnd × markupPercent/100)`; `marginVnd = round(baseVnd × markupPercent/100)`; margin clamp ≥ 0.
- Markup tính trên `breakdown.base` (base **công bố**, cost currency) đã quy về VND.
- `pickBaseVnd`: costCurrency='VND' → `base`; displayCurrency='VND' → `round(base / fxCostPerDisplay)`; khác → fail reason `non_vnd_currency`.
- Sàn: `MIN_MARKUP_PERCENT = 30`. Chặn lưu partner khi markup < 30 (create + update). Đơn vị markup là **phần trăm** (30 = 30%).
- KHÔNG migration DB (dùng lại cột `carrierCostVnd/markupPercent/chargedVnd/quoteBreakdown`).
- Đơn đã quote KHÔNG đổi giá; chỉ đơn test Kalisa được clear thủ công.
- Trước push: `npx tsc --noEmit` + `npx vitest run` phải xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `pickBaseVnd` + adapter trả `baseVnd`

**Files:**
- Modify: `features/ship-ho/quote-adapter.ts`
- Test: `features/ship-ho/quote-adapter.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `pickBaseVnd(snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number }, breakdown: { base: number }): { ok: true; vnd: number } | { ok: false; reason: string }`
  - `ShipHoQuoteResult` nhánh ok thêm `baseVnd: number` (dùng ở Task 3, 4).

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `features/ship-ho/quote-adapter.test.ts` (giữ import cũ, thêm `pickBaseVnd`):

```ts
import { pickBaseVnd } from './quote-adapter';

describe('pickBaseVnd', () => {
  it('costCurrency VND → base nguyên', () => {
    const r = pickBaseVnd(
      { costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000 },
      { base: 90000 },
    );
    expect(r).toEqual({ ok: true, vnd: 90000 });
  });
  it('displayCurrency VND → base / fxCostPerDisplay, làm tròn', () => {
    const r = pickBaseVnd(
      { costCurrency: 'USD', displayCurrency: 'VND', fxCostPerDisplay: 0.25 },
      { base: 4.75 },
    );
    // 4.75 / 0.25 = 19 → 19
    expect(r).toEqual({ ok: true, vnd: 19 });
  });
  it('không có VND → fail reason non_vnd', () => {
    const r = pickBaseVnd(
      { costCurrency: 'USD', displayCurrency: 'EUR', fxCostPerDisplay: 1.1 },
      { base: 4.75 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('non_vnd');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/quote-adapter.test.ts`
Expected: FAIL — `pickBaseVnd` chưa export.

- [ ] **Step 3: Thêm `pickBaseVnd` + `baseVnd` vào adapter**

Trong `features/ship-ho/quote-adapter.ts`:

(a) Sửa type kết quả — nhánh ok thêm `baseVnd`:

```ts
export type ShipHoQuoteResult =
  | { ok: true; carrierCostVnd: number; baseVnd: number; zone: string; breakdown: QuoteBreakdown }
  | { ok: false; reason: string };
```

(b) Thêm hàm thuần (đặt ngay sau `pickCarrierCostVnd`):

```ts
/** THUẦN: quy base (cost currency) về VND, cùng quy tắc chọn tiền như carrierCost. */
export function pickBaseVnd(
  snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number },
  breakdown: { base: number },
): { ok: true; vnd: number } | { ok: false; reason: string } {
  if (snap.costCurrency === 'VND') return { ok: true, vnd: Math.round(breakdown.base) };
  if (snap.displayCurrency === 'VND') return { ok: true, vnd: Math.round(breakdown.base / snap.fxCostPerDisplay) };
  return {
    ok: false,
    reason: `non_vnd_currency(cost=${snap.costCurrency},display=${snap.displayCurrency})`,
  };
}
```

(c) Trong `quoteShipHoOrder`, sau khối `const vnd = pickCarrierCostVnd(...)` (đã có), thêm trước `return`:

```ts
  const baseVnd = pickBaseVnd(snap, res.breakdown);
  if (!baseVnd.ok) return { ok: false, reason: baseVnd.reason };

  return { ok: true, carrierCostVnd: vnd.vnd, baseVnd: baseVnd.vnd, zone: res.zone, breakdown: res.breakdown };
```

(Xoá dòng `return { ok: true, carrierCostVnd: vnd.vnd, zone: res.zone, breakdown: res.breakdown };` cũ.)

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npx vitest run features/ship-ho/quote-adapter.test.ts`
Expected: PASS toàn bộ (cả `pickCarrierCostVnd` cũ).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: FAIL ở `orders-actions.ts`/`quote-lines-actions.ts` nếu chúng đọc kết quả cũ — CHẤP NHẬN tạm ở task này nếu chỉ do thiếu `baseVnd` usage; sẽ được xử ở Task 3/4. Nếu lỗi khác, sửa. (Ghi chú: thêm field mới vào union không phá chỗ đọc hiện tại, nên tsc dự kiến vẫn PASS.)

- [ ] **Step 6: Commit**

```bash
git add features/ship-ho/quote-adapter.ts features/ship-ho/quote-adapter.test.ts
git commit -m "feat(ship-ho): pickBaseVnd + quoteShipHoOrder trả baseVnd

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Core `computeOffer` + hằng `MIN_MARKUP_PERCENT`

**Files:**
- Create: `features/ship-ho/offer-pricing.ts`
- Test: `features/ship-ho/offer-pricing.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `MIN_MARKUP_PERCENT = 30`
  - `computeOffer(carrierCostVnd: number, baseVnd: number, markupPercent: number): { chargedVnd: number; marginVnd: number }`

- [ ] **Step 1: Viết test thất bại**

Tạo `features/ship-ho/offer-pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOffer, MIN_MARKUP_PERCENT } from './offer-pricing';

describe('computeOffer', () => {
  it('margin = base×markup%, charged = carrierCost + margin', () => {
    // base 100k, markup 30% → margin 30k; carrierCost 250k → charged 280k
    expect(computeOffer(250000, 100000, 30)).toEqual({ chargedVnd: 280000, marginVnd: 30000 });
  });
  it('margin CHỈ theo base — carrierCost lớn không đổi margin', () => {
    const a = computeOffer(250000, 100000, 30);
    const b = computeOffer(999000, 100000, 30);
    expect(a.marginVnd).toBe(b.marginVnd); // 30000
    expect(b.chargedVnd).toBe(999000 + 30000);
  });
  it('markup 0 → margin 0, charged = carrierCost', () => {
    expect(computeOffer(250000, 100000, 0)).toEqual({ chargedVnd: 250000, marginVnd: 0 });
  });
  it('làm tròn VND', () => {
    // base 100000 × 15.5% = 15500
    expect(computeOffer(200000, 100000, 15.5)).toEqual({ chargedVnd: 215500, marginVnd: 15500 });
  });
  it('markup âm không cho margin âm (clamp ≥ 0)', () => {
    expect(computeOffer(200000, 100000, -50)).toEqual({ chargedVnd: 200000, marginVnd: 0 });
  });
  it('MIN_MARKUP_PERCENT = 30', () => {
    expect(MIN_MARKUP_PERCENT).toBe(30);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/offer-pricing.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết implementation**

Tạo `features/ship-ho/offer-pricing.ts`:

```ts
/**
 * THUẦN: giá thu partner ship hộ. Markup CHỈ trên cước base; fuel/phụ phí/VAT
 * pass-through nguyên giá carrier (đã nằm trong carrierCostVnd).
 *   chargedVnd = carrierCostVnd + base×markup%   → margin = base×markup%
 */
export const MIN_MARKUP_PERCENT = 30;

export function computeOffer(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  const marginVnd = Math.max(0, Math.round(baseVnd * (markupPercent / 100)));
  return { chargedVnd: Math.round(carrierCostVnd) + marginVnd, marginVnd };
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npx vitest run features/ship-ho/offer-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/offer-pricing.ts features/ship-ho/offer-pricing.test.ts
git commit -m "feat(ship-ho): offer-pricing core — markup base-only + MIN_MARKUP_PERCENT

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Áp core vào quote-line

**Files:**
- Modify: `features/ship-ho/quote-lines-logic.ts`
- Modify: `features/ship-ho/quote-lines-actions.ts`
- Test: `features/ship-ho/quote-lines-logic.test.ts`

**Interfaces:**
- Consumes: `computeOffer` (Task 2); `q.baseVnd` từ `quoteShipHoOrder` (Task 1).
- Produces: `summarizeLine(carrierCostVnd: number, baseVnd: number, markupPercent: number): { chargedVnd: number; marginVnd: number }`.

- [ ] **Step 1: Cập nhật test cho chữ ký mới**

Thay toàn bộ nội dung `features/ship-ho/quote-lines-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine', () => {
  it('charged = carrierCost + base×markup, margin = base×markup', () => {
    // carrierCost 250k, base 100k, markup 30% → margin 30k, charged 280k
    expect(summarizeLine(250000, 100000, 30)).toEqual({ chargedVnd: 280000, marginVnd: 30000 });
  });
  it('markup 0 → charged = carrierCost, margin 0', () => {
    expect(summarizeLine(150000, 90000, 0)).toEqual({ chargedVnd: 150000, marginVnd: 0 });
  });
  it('margin không phụ thuộc phần phụ phí trong carrierCost', () => {
    expect(summarizeLine(500000, 100000, 30).marginVnd).toBe(30000);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/quote-lines-logic.test.ts`
Expected: FAIL — `summarizeLine` cũ nhận 2 tham số, giá trị sai.

- [ ] **Step 3: Sửa `summarizeLine`**

Thay toàn bộ `features/ship-ho/quote-lines-logic.ts`:

```ts
/** THUẦN: từ cước carrier + base + markup% → giá thu + margin cho 1 line. */
import { computeOffer } from './offer-pricing';

export function summarizeLine(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  return computeOffer(carrierCostVnd, baseVnd, markupPercent);
}
```

- [ ] **Step 4: Cập nhật lời gọi trong `quote-lines-actions.ts`**

Trong `features/ship-ho/quote-lines-actions.ts`, dòng gọi `summarizeLine` hiện là:
```ts
    const { chargedVnd, marginVnd } = summarizeLine(q.carrierCostVnd, markup);
```
Đổi thành:
```ts
    const { chargedVnd, marginVnd } = summarizeLine(q.carrierCostVnd, q.baseVnd, markup);
```

- [ ] **Step 5: Chạy test + type-check**

Run: `npx vitest run features/ship-ho/quote-lines-logic.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/ship-ho/quote-lines-logic.ts features/ship-ho/quote-lines-logic.test.ts features/ship-ho/quote-lines-actions.ts
git commit -m "feat(ship-ho): quote-line dùng computeOffer (markup base-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Áp core vào requote đơn

**Files:**
- Modify: `features/ship-ho/orders-actions.ts`

**Interfaces:**
- Consumes: `computeOffer` (Task 2); `q.baseVnd` từ `quoteShipHoOrder` (Task 1).
- Produces: không có (ghi DB).

- [ ] **Step 1: Import core + bỏ applyMarkup**

Trong `features/ship-ho/orders-actions.ts`, khối import, thay:
```ts
import { applyMarkup } from './markup';
```
bằng:
```ts
import { computeOffer } from './offer-pricing';
```

- [ ] **Step 2: Đổi tính charged trong `requoteShipHoOrder`**

Tìm:
```ts
  const charged = applyMarkup(q.carrierCostVnd, Number(markupPercent));
```
Thay bằng:
```ts
  const { chargedVnd: charged } = computeOffer(q.carrierCostVnd, q.baseVnd, Number(markupPercent));
```

(Các dòng `.set({ carrierCostVnd: String(q.carrierCostVnd), markupPercent: String(markupPercent), chargedVnd: String(charged), ... })` giữ nguyên.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/ship-ho/orders-actions.ts
git commit -m "feat(ship-ho): requoteShipHoOrder dùng computeOffer (markup base-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sàn markup ≥ 30% (chặn create + update)

**Files:**
- Modify: `features/ship-ho/partners-actions.ts`
- Test: `features/ship-ho/partners-markup-floor.test.ts`

**Interfaces:**
- Consumes: `MIN_MARKUP_PERCENT` (Task 2).
- Produces: không có (validate + trả error).

- [ ] **Step 1: Viết test thuần cho hàm validate**

Tạo `features/ship-ho/partners-markup-floor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { markupFloorError } from './partners-actions';
import { MIN_MARKUP_PERCENT } from './offer-pricing';

describe('markupFloorError', () => {
  it('undefined (update không đổi markup) → null', () => {
    expect(markupFloorError(undefined)).toBeNull();
  });
  it('< 30 → có lỗi', () => {
    expect(markupFloorError('29.9')).toMatch(/30/);
  });
  it('= 30 → null', () => {
    expect(markupFloorError(String(MIN_MARKUP_PERCENT))).toBeNull();
  });
  it('không phải số → có lỗi', () => {
    expect(markupFloorError('abc')).toMatch(/hợp lệ|30/);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/partners-markup-floor.test.ts`
Expected: FAIL — `markupFloorError` chưa export.

- [ ] **Step 3: Thêm `markupFloorError` + gọi trong create/update**

Trong `features/ship-ho/partners-actions.ts`:

(a) Import + helper (đặt sau các import, trước hàm đầu tiên):

```ts
import { MIN_MARKUP_PERCENT } from './offer-pricing';

/** THUẦN: lỗi sàn markup, null nếu hợp lệ. undefined = không đổi (update). */
export function markupFloorError(markupPercent: string | undefined): string | null {
  if (markupPercent === undefined) return null;
  const mk = Number(markupPercent);
  if (!Number.isFinite(mk)) return 'markup không hợp lệ';
  if (mk < MIN_MARKUP_PERCENT) return `Markup phải ≥ ${MIN_MARKUP_PERCENT}% để đảm bảo margin rủi ro`;
  return null;
}
```

(b) Trong `createShipHoPartner`, thay khối:
```ts
  const mk = Number(input.markupPercent);
  if (!Number.isFinite(mk) || mk < 0) return { ok: false, error: 'markup không hợp lệ' };
```
bằng:
```ts
  const floorErr = markupFloorError(input.markupPercent);
  if (floorErr) return { ok: false, error: floorErr };
```

(c) Trong `updateShipHoPartner`, ngay sau `requireManageShipHo` (trước `try` update), thêm:
```ts
  const floorErr = markupFloorError(input.markupPercent);
  if (floorErr) return { ok: false, error: floorErr };
```

- [ ] **Step 4: Chạy test + type-check**

Run: `npx vitest run features/ship-ho/partners-markup-floor.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/partners-actions.ts features/ship-ho/partners-markup-floor.test.ts
git commit -m "feat(ship-ho): chặn markup partner < 30% (create + update)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Badge cảnh báo partner markup < 30%

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx`

**Interfaces:**
- Consumes: `MIN_MARKUP_PERCENT` (Task 2).
- Produces: không có (UI).

- [ ] **Step 1: Xác định chỗ render markup của partner**

Run: `grep -n "markupPercent\|markup" "app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx"`
Ghi lại dòng hiển thị `markupPercent` trong danh sách partner (vd `<td>{p.markupPercent}%</td>`).

- [ ] **Step 2: Thêm import hằng + badge**

Trên đầu `PartnersManager.tsx` (khối import), thêm:
```ts
import { MIN_MARKUP_PERCENT } from '@/features/ship-ho/offer-pricing';
```

Tại chỗ hiển thị markup (thay ô/dòng chứa `{p.markupPercent}%`), render kèm badge khi dưới sàn:
```tsx
{p.markupPercent}%{Number(p.markupPercent) < MIN_MARKUP_PERCENT && (
  <span className="ml-2 inline-block rounded bg-red-100 text-red-700 text-xs px-1.5 py-0.5">⚠ &lt; {MIN_MARKUP_PERCENT}%</span>
)}
```
(Điều chỉnh tên biến `p` cho khớp map hiện có tìm được ở Step 1.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx"
git commit -m "feat(ship-ho): badge cảnh báo partner markup < 30%

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Action clear + requote đơn test Kalisa

**Files:**
- Modify: `features/ship-ho/orders-actions.ts`

**Interfaces:**
- Consumes: `requoteShipHoOrder` (đã có).
- Produces: `clearAndRequoteOrder(orderId: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Thêm action `clearAndRequoteOrder`**

Trong `features/ship-ho/orders-actions.ts`, thêm hàm (sau `requoteShipHoOrder`):

```ts
/** Xoá snapshot giá của 1 đơn về draft rồi requote bằng công thức hiện hành. */
export async function clearAndRequoteOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  await db
    .update(schema.shipHoOrders)
    .set({
      status: 'draft',
      carrierCostVnd: null,
      markupPercent: null,
      chargedVnd: null,
      quoteBreakdown: null,
      quotedAt: null,
    })
    .where(eq(schema.shipHoOrders.id, orderId));
  return await requoteShipHoOrder(orderId);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/orders-actions.ts
git commit -m "feat(ship-ho): clearAndRequoteOrder — reset snapshot giá + requote

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Chạy clear cho đơn Kalisa (thủ công, môi trường có DATABASE_URL)**

Tra id đơn test Kalisa rồi gọi action (qua UI nút hoặc script tạm dùng `tsx`). Ví dụ script tạm `scripts/tmp-clear-kalisa.ts`:
```ts
import { db, schema } from '@/db/client';
import { eq, and } from 'drizzle-orm';
import { clearAndRequoteOrder } from '@/features/ship-ho/orders-actions';

const rows = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code })
  .from(schema.shipHoOrders)
  .where(eq(schema.shipHoOrders.partnerBrandSlug, 'kalisa'));
console.log('Kalisa orders:', rows);
for (const r of rows) console.log(r.code, await clearAndRequoteOrder(r.id));
```
Run: `npx dotenv -- npx tsx scripts/tmp-clear-kalisa.ts`
Expected: in ra `{ ok: true }` cho đơn Kalisa. Sau khi xong, xoá file script tạm (không commit). *(Nếu `requireManageShipHo` chặn ngoài request context, thay bằng UPDATE + requote trực tiếp trong script, bỏ qua auth.)*

---

### Task 8: Verify toàn bộ + đẩy nhánh

- [ ] **Step 1: Type-check toàn dự án**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS (0 failed). Đặc biệt các file: `offer-pricing`, `quote-adapter`, `quote-lines-logic`, `partners-markup-floor`.

- [ ] **Step 3: Đẩy nhánh (chỉ khi xanh)**

```bash
git push -u origin feat/ship-ho-offer-pricing
```

---

## Self-Review

**Spec coverage (Phần A):**
- A1 lấy base VND (`pickBaseVnd` + `baseVnd`) → Task 1. ✅
- A2 core `computeOffer` + `MIN_MARKUP_PERCENT` → Task 2. ✅
- A3 áp quote-line → Task 3. ✅
- A4 áp requote đơn → Task 4. ✅
- A5 sàn 30% chặn (create + update) → Task 5. ✅
- A5 badge cảnh báo → Task 6. ✅
- A6 clear Kalisa → Task 7. ✅
- Test: offer-pricing, quote-adapter(pickBaseVnd), quote-lines-logic, partners floor → Task 1,2,3,5. ✅
- Không migration (tôn trọng) → không task DB. ✅

**Placeholder scan:** không TBD/TODO; mọi step code đầy đủ. Task 6 Step 1 là bước khảo sát biến `p` có chủ đích (UI thực tế), không phải placeholder. ✅

**Type consistency:**
- `computeOffer(carrierCostVnd, baseVnd, markupPercent) → { chargedVnd, marginVnd }` dùng nhất quán Task 2/3/4. ✅
- `summarizeLine(carrierCostVnd, baseVnd, markupPercent)` khớp lời gọi Task 3 Step 4. ✅
- `pickBaseVnd(snap{costCurrency,displayCurrency,fxCostPerDisplay}, {base}) → {ok,vnd}|{ok,reason}` khớp Task 1. ✅
- `ShipHoQuoteResult.baseVnd` tiêu thụ ở Task 3/4. ✅
- `MIN_MARKUP_PERCENT` (offer-pricing) dùng ở Task 5/6. ✅
- `markupFloorError(string|undefined) → string|null` khớp create/update Task 5. ✅
