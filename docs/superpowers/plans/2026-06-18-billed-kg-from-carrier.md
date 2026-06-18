# Đối soát — "KG carrier" từ hoá đơn carrier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị cân carrier THẬT (`shipment_charges.billing_weight_kg`, từ hoá đơn FBO/DHL) trong bảng đối soát thành cột mới "KG carrier", đổi tên cột engine cũ "KG bill" → "KG dự kiến", và tô màu khi hai số lệch.

**Architecture:** `reconcile.ts` đã select từ `shipment_charges`; thêm cột `billing_weight_kg` vào select + field `billedWeightKg` trên `ReconcileRow`. Một helper thuần `carrierWeightCell()` quyết định text ("—" khi null) + cờ lệch (so với `chargeableKg`). `ReconcileTable.tsx` đổi nhãn cột cũ và thêm cột mới dùng helper. Không đụng import/parser hoá đơn (kg đã ghi sẵn) hay engine/schema.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM, React (server-rendered table), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-billed-kg-from-carrier-design.md` (authoritative).
- Cột mới lấy `shipment_charges.billing_weight_kg` — CÙNG dòng charge mà `reconcile.ts` đã dùng cho `billedTotal`. Không tạo query/charge-row mới.
- `null` (chưa import hoá đơn) → hiển thị "—". KHÔNG fallback sang số engine. Số `0` hợp lệ vẫn hiện "0".
- Đổi nhãn cột hiện "KG bill" → "KG dự kiến"; cột mới nhãn "KG carrier".
- Tô amber (tái dùng class `text-amber-600 dark:text-amber-400`) cho ô "KG carrier" CHỈ khi `billedWeightKg !== null && chargeableKg !== null && billedWeightKg !== chargeableKg`.
- Không đổi: import/parser FBO/DHL, engine/quote, schema DB.
- Parse số theo convention sẵn có: `r.x != null ? Number(r.x) : null`.
- Commands: `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files>`, `npm run build`. Commit body kết thúc bằng `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `features/shipments/reconcile-view.ts` (modify) — thêm helper thuần `carrierWeightCell` + type `CarrierWeightCell`.
- `features/shipments/reconcile-view.test.ts` (modify) — test helper; cập nhật factory `row()` thêm `billedWeightKg`.
- `features/shipments/reconcile.ts` (modify) — thêm `billedWeightKg` vào `ReconcileRow`, vào select, vào row mapping.
- `components/shipping-reconcile/ReconcileTable.tsx` (modify) — đổi nhãn cột + thêm cột "KG carrier" + bump `colSpan`.

---

## Task 1: Helper thuần `carrierWeightCell` + field trên ReconcileRow

**Files:**
- Modify: `features/shipments/reconcile-view.ts`
- Modify: `features/shipments/reconcile.ts` (chỉ thêm field vào `interface ReconcileRow`)
- Test: `features/shipments/reconcile-view.test.ts`

**Interfaces:**
- Produces:
  - `interface CarrierWeightCell { text: string; mismatch: boolean }`
  - `function carrierWeightCell(billedWeightKg: number | null, chargeableKg: number | null): CarrierWeightCell`
  - `ReconcileRow.billedWeightKg: number | null` (cân carrier thật từ hoá đơn; null khi chưa import).

- [ ] **Step 1: Write the failing test**

Thêm vào cuối `features/shipments/reconcile-view.test.ts` (import sẽ thêm ở Step 3):

```ts
describe('carrierWeightCell', () => {
  it('null billed weight → "—", không lệch', () => {
    expect(carrierWeightCell(null, 2)).toEqual({ text: '—', mismatch: false });
  });
  it('bằng chargeable → hiện số, không lệch', () => {
    expect(carrierWeightCell(2.5, 2.5)).toEqual({ text: '2.5', mismatch: false });
  });
  it('khác chargeable → hiện số, có lệch', () => {
    expect(carrierWeightCell(2.5, 2)).toEqual({ text: '2.5', mismatch: true });
  });
  it('chargeable null → hiện số, không lệch (không có gì để so)', () => {
    expect(carrierWeightCell(2.5, null)).toEqual({ text: '2.5', mismatch: false });
  });
  it('0 là hợp lệ, không phải "—"', () => {
    expect(carrierWeightCell(0, 0)).toEqual({ text: '0', mismatch: false });
  });
});
```

Cập nhật import dòng đầu file:
```ts
import { mergeStatus, netBase, carrierWeightCell, type StatusRecord } from './reconcile-view';
```

Và thêm `billedWeightKg: null,` vào object trả về của factory `row()` (cạnh `chargeableKg: 1,`) để `ReconcileRow` literal vẫn hợp lệ kiểu sau Step 2:
```ts
    ... shopifyWeightKg: 1, weightKg: 1, chargeableKg: 1, billedWeightKg: null, labelDate: null,
```

- [ ] **Step 2: Add `billedWeightKg` to `ReconcileRow`**

Trong `features/shipments/reconcile.ts`, ngay sau field `chargeableKg` (dòng 38) trong `interface ReconcileRow`:

```ts
  /** Weight the engine actually priced: max(actual, dim) after carrier
   *  rounding. NULL when the engine produced no quote. */
  chargeableKg: number | null;
  /** Cân carrier THẬT tính phí trên hoá đơn (shipment_charges.billing_weight_kg,
   *  nguồn FBO/DHL). NULL khi chưa import hoá đơn carrier cho shipment này. */
  billedWeightKg: number | null;
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run features/shipments/reconcile-view.test.ts`
Expected: FAIL — `carrierWeightCell` chưa export (và/hoặc factory thiếu field nếu Step 2 chưa xong).

- [ ] **Step 4: Implement the helper**

Trong `features/shipments/reconcile-view.ts`, thêm (ví dụ ngay sau `netBase`, dòng ~67):

```ts
export interface CarrierWeightCell { text: string; mismatch: boolean }

/** Ô "KG carrier": cân carrier thật từ hoá đơn. NULL → "—". Tô lệch khi khác
 *  cân dự kiến (engine max(cân,dim)+làm tròn) và cả hai đều có số. */
export function carrierWeightCell(
  billedWeightKg: number | null,
  chargeableKg: number | null,
): CarrierWeightCell {
  if (billedWeightKg === null) return { text: '—', mismatch: false };
  const mismatch = chargeableKg !== null && billedWeightKg !== chargeableKg;
  return { text: String(billedWeightKg), mismatch };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run features/shipments/reconcile-view.test.ts`
Expected: PASS (helper tests + các test cũ vẫn xanh).

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint features/shipments/reconcile-view.ts features/shipments/reconcile-view.test.ts features/shipments/reconcile.ts`
Expected: clean. (Nếu tsc báo nơi khác dựng `ReconcileRow` literal thiếu `billedWeightKg`, đó là Task 2 sẽ điền cho `reconcile.ts`; nếu là file test/khác → thêm `billedWeightKg: null`.)

- [ ] **Step 7: Commit**

```bash
git add features/shipments/reconcile-view.ts features/shipments/reconcile-view.test.ts features/shipments/reconcile.ts
git commit -m "feat(reconcile): helper carrierWeightCell + field billedWeightKg trên ReconcileRow"
```

---

## Task 2: Đưa dữ liệu vào row + cột UI "KG carrier"

**Files:**
- Modify: `features/shipments/reconcile.ts` (select + row mapping)
- Modify: `components/shipping-reconcile/ReconcileTable.tsx` (nhãn + cột + colSpan)

**Interfaces:**
- Consumes: `ReconcileRow.billedWeightKg` (Task 1), `carrierWeightCell` (Task 1).

- [ ] **Step 1: Thêm `billedWeightKg` vào select**

Trong `features/shipments/reconcile.ts`, trong khối select, ngay sau `billedImportHandling` (dòng 151):

```ts
      billedImportHandling: schema.shipmentCharges.importHandling,
      billedWeightKg: schema.shipmentCharges.billingWeightKg,
```

- [ ] **Step 2: Map vào row**

Trong cùng file, trong object trả về (cạnh `chargeableKg: engine?.chargeableWeightKg ?? null,` dòng 511):

```ts
    chargeableKg: engine?.chargeableWeightKg ?? null,
    billedWeightKg: r.billedWeightKg != null ? Number(r.billedWeightKg) : null,
```

- [ ] **Step 3: Verify type + build (data path)**

Run: `npx tsc --noEmit`
Expected: clean (field giờ được điền; không còn literal thiếu `billedWeightKg` trong `reconcile.ts`).

- [ ] **Step 4: Đổi nhãn cột cũ + thêm header cột mới**

Trong `components/shipping-reconcile/ReconcileTable.tsx`, thay dòng 264:

```tsx
              <th className="px-3 py-2 text-right" title="Cân dự kiến: engine max(cân thực, dim) + làm tròn bậc carrier — văn phòng kỳ vọng">KG dự kiến</th>
              <th className="px-3 py-2 text-right" title="Cân carrier THẬT tính phí trên hoá đơn (FBO/DHL); '—' nếu chưa import hoá đơn">KG carrier</th>
```

(dòng cũ chỉ có 1 `<th>…>KG bill</th>` — thay thành 2 dòng `<th>` trên.)

- [ ] **Step 5: Thêm ô dữ liệu cột mới**

Trong cùng file, ngay sau ô "KG dự kiến" (block `<td>…{r.chargeableKg}…</td>` kết thúc dòng 354), thêm:

```tsx
        <td className="px-3 py-2 text-right">
          {(() => {
            const c = carrierWeightCell(r.billedWeightKg, r.chargeableKg);
            if (c.text === '—') return '—';
            return (
              <span
                className={c.mismatch ? 'text-amber-600 dark:text-amber-400' : undefined}
                title={c.mismatch ? `Carrier tính khác văn phòng (dự kiến ${r.chargeableKg})` : undefined}
              >
                {c.text}
              </span>
            );
          })()}
        </td>
```

Thêm import ở đầu file (cạnh import từ reconcile-view nếu có, hoặc thêm mới):
```tsx
import { carrierWeightCell } from '@/features/shipments/reconcile-view';
```
(Kiểm tra: nếu file đã import gì đó từ `reconcile-view`, gộp `carrierWeightCell` vào import đó thay vì thêm dòng mới.)

- [ ] **Step 6: Bump `colSpan` 13 → 14**

Trong cùng file, đổi cả hai `colSpan={13}` → `colSpan={14}` (dòng 282 — empty-state; dòng 406 — detail panel row). Vì vừa thêm 1 cột.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx eslint components/shipping-reconcile/ReconcileTable.tsx features/shipments/reconcile.ts && npx vitest run features/shipments && npm run build`
Expected: tsc clean; eslint clean; shipments tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add features/shipments/reconcile.ts components/shipping-reconcile/ReconcileTable.tsx
git commit -m "feat(reconcile): cột KG carrier (kg hoá đơn thật) + đổi tên KG bill → KG dự kiến"
```

---

## Task 3: Verify toàn bộ + PR

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean; tất cả test pass; build OK.

- [ ] **Step 2: Xác nhận không lệch cột**

Đếm số `<th>` trong header `<tr>` của ReconcileTable và so với `colSpan` (phải bằng nhau, =14). Xác nhận thứ tự cột: KG Shopify · KG cân · KG dự kiến · KG carrier · Billed · …

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/billed-kg-from-carrier
gh pr create --base main --head feat/billed-kg-from-carrier --title "feat(reconcile): KG carrier từ hoá đơn thật (FBO/DHL)" --body "Spec docs/superpowers/specs/2026-06-18-billed-kg-from-carrier-design.md. Thêm cột KG carrier = shipment_charges.billing_weight_kg; đổi tên KG bill → KG dự kiến; tô lệch khi khác. Không đụng import/engine/schema.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes

- **Spec coverage:** field + select (T2 S1–S2), helper "—"/highlight (T1), relabel + cột mới (T2 S4–S5), colSpan (T2 S6), test (T1), edge "0 hợp lệ" + "null→—" (T1 tests). Tất cả mục spec có task.
- **Naming consistency:** `billedWeightKg`, `carrierWeightCell`, `CarrierWeightCell.{text,mismatch}` dùng nhất quán T1↔T2. Nhãn "KG dự kiến"/"KG carrier" khớp Global Constraints.
- **Edge:** dữ liệu `billing_weight_kg` lấy cùng dòng charge với `billedTotal` (không query mới) — đúng spec; multi-charge là hành vi reconcile sẵn có, ngoài phạm vi.
