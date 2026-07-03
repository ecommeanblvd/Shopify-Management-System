# Ship hộ — So sánh giá line + confirm-to-create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Form tạo đơn ship hộ hiện bảng so sánh giá mọi line ship (cước/giá thu/margin) → user chọn 1 line + confirm mới tạo đơn.

**Architecture:** 1 helper thuần (`summarizeLine`) + 1 server action (`quoteShipHoLines` quote mọi enabled account) + refactor `NewOrderForm.tsx` (bỏ dropdown carrier → nút so sánh + bảng radio + confirm). Tái dùng `quoteShipHoOrder`/`applyMarkup`/`createShipHoOrder`. Không đổi backend/schema.

**Tech Stack:** Next.js App Router (server action + client component), Vitest, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-ship-ho-line-compare-design.md`.
- KHÔNG đổi schema/`orders-actions.ts`/`quote-adapter.ts`; KHÔNG thêm dependency.
- Line = mỗi carrier account **`enabled`**; line **không quote được → ẩn**; cột: cước carrier · giá thu · margin; sort giá thu tăng dần.
- Preview KHÔNG ghi DB; tạo đơn qua `createShipHoOrder(carrierAccountId=line đã chọn)` (đã tự re-quote snapshot).
- Đổi input ảnh hưởng giá → **clear bảng + lựa chọn** (buộc so sánh lại).
- Trên nhánh `feat/ship-ho-form-geo` (form đã có country/city dropdown + phone từ feature trước). Chạy trước push: `tsc --noEmit` + `vitest run` + eslint xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `features/ship-ho/quote-lines-logic.ts` (+test) | `summarizeLine(cost, markup)` thuần |
| `features/ship-ho/quote-lines-actions.ts` (create) | `quoteShipHoLines(input)` + type `LineQuote` |
| `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx` (modify) | bỏ dropdown carrier → nút So sánh + bảng + Confirm |
| `app/(dashboard)/f/ship-ho/new/page.tsx` (modify) | bỏ truyền `accounts` (form không dùng nữa) |

---

### Task 1: `summarizeLine` (thuần)

**Files:**
- Create: `features/ship-ho/quote-lines-logic.ts`
- Test: `features/ship-ho/quote-lines-logic.test.ts`

**Interfaces:**
- Consumes: `applyMarkup` từ `./markup`.
- Produces: `summarizeLine(carrierCostVnd: number, markupPercent: number): { chargedVnd: number; marginVnd: number }`.

- [ ] **Step 1: Write the failing test** `features/ship-ho/quote-lines-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine', () => {
  it('charged = cost + markup%, margin = charged − cost', () => {
    expect(summarizeLine(100000, 20)).toEqual({ chargedVnd: 120000, marginVnd: 20000 });
  });
  it('markup 0 → charged = cost, margin 0', () => {
    expect(summarizeLine(150000, 0)).toEqual({ chargedVnd: 150000, marginVnd: 0 });
  });
  it('làm tròn VND (theo applyMarkup)', () => {
    // 100000 * 1.155 = 115500
    expect(summarizeLine(100000, 15.5)).toEqual({ chargedVnd: 115500, marginVnd: 15500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/quote-lines-logic.test.ts`
Expected: FAIL — "Cannot find module './quote-lines-logic'".

- [ ] **Step 3: Implement** `features/ship-ho/quote-lines-logic.ts`

```ts
/** THUẦN: từ cước carrier + markup% → giá thu + margin cho 1 line. */
import { applyMarkup } from './markup';

export function summarizeLine(
  carrierCostVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  const chargedVnd = applyMarkup(carrierCostVnd, markupPercent);
  return { chargedVnd, marginVnd: chargedVnd - carrierCostVnd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/quote-lines-logic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/quote-lines-logic.ts features/ship-ho/quote-lines-logic.test.ts
git commit -m "feat(ship-ho): summarizeLine (cước→giá thu+margin) thuần + test"
```

---

### Task 2: `quoteShipHoLines` server action

**Files:**
- Create: `features/ship-ho/quote-lines-actions.ts`

**Interfaces:**
- Consumes: `summarizeLine` (Task 1); `quoteShipHoOrder` (`./quote-adapter`); `requireManageShipHo` (`./require-manage`); `listAccounts` (`@/features/carrier-rates/actions`) — trả `{ id, name, carrierKey, enabled, … }`; `schema.shipHoPartners`.
- Produces:
  - `interface LineQuote { accountId: string; name: string; carrierKey: string | null; carrierCostVnd: number; chargedVnd: number; marginVnd: number }`
  - `interface QuoteLinesInput { partnerBrandSlug: string; weightKg: string; country: string; city?: string; postcode?: string; dimLengthCm?: string; dimWidthCm?: string; dimHeightCm?: string; packagingType?: 'bag' | 'box' | null }`
  - `quoteShipHoLines(input: QuoteLinesInput): Promise<{ lines: LineQuote[]; error?: string }>`

- [ ] **Step 1: Implement** `features/ship-ho/quote-lines-actions.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { quoteShipHoOrder } from './quote-adapter';
import { summarizeLine } from './quote-lines-logic';
import { listAccounts } from '@/features/carrier-rates/actions';

export interface LineQuote {
  accountId: string;
  name: string;
  carrierKey: string | null;
  carrierCostVnd: number;
  chargedVnd: number;
  marginVnd: number;
}

export interface QuoteLinesInput {
  partnerBrandSlug: string;
  weightKg: string;
  country: string;
  city?: string;
  postcode?: string;
  dimLengthCm?: string;
  dimWidthCm?: string;
  dimHeightCm?: string;
  packagingType?: 'bag' | 'box' | null;
}

/**
 * Quote MỌI carrier account đang bật cho 1 kiện ship hộ → giá thu (cost+markup
 * partner) + margin từng line. Line không quote được tuyến đó → BỎ (ẩn). Sort
 * theo giá thu tăng dần. KHÔNG ghi DB.
 */
export async function quoteShipHoLines(
  input: QuoteLinesInput,
): Promise<{ lines: LineQuote[]; error?: string }> {
  await requireManageShipHo();
  if (!input.partnerBrandSlug) return { lines: [], error: 'Thiếu partner' };
  if (!input.country?.trim()) return { lines: [], error: 'Thiếu quốc gia' };
  const w = Number(input.weightKg);
  if (!Number.isFinite(w) || w <= 0) return { lines: [], error: 'Cân nặng không hợp lệ' };

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, input.partnerBrandSlug))
    .limit(1);
  const markup = Number(partner?.markupPercent ?? '0');

  const accounts = (await listAccounts()).filter((a) => a.enabled);
  const dims =
    input.dimLengthCm && input.dimWidthCm && input.dimHeightCm
      ? { lengthCm: Number(input.dimLengthCm), widthCm: Number(input.dimWidthCm), heightCm: Number(input.dimHeightCm) }
      : null;

  const lines: LineQuote[] = [];
  for (const a of accounts) {
    const q = await quoteShipHoOrder({
      carrierAccountId: a.id,
      weightKg: w,
      dimensions: dims,
      packagingType: input.packagingType ?? null,
      destinationCountry: input.country.trim().toUpperCase(),
      destinationPostcode: input.postcode || undefined,
      destinationCity: input.city || undefined,
    });
    if (!q.ok) continue; // line không quote được tuyến này → ẩn
    const { chargedVnd, marginVnd } = summarizeLine(q.carrierCostVnd, markup);
    lines.push({
      accountId: a.id,
      name: a.name,
      carrierKey: a.carrierKey ?? null,
      carrierCostVnd: q.carrierCostVnd,
      chargedVnd,
      marginVnd,
    });
  }
  lines.sort((x, y) => x.chargedVnd - y.chargedVnd);
  return { lines };
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0. (Nếu `listAccounts` không có field `enabled`/`carrierKey` như giả định, mở `features/carrier-rates/actions.ts` xác nhận tên field và chỉnh cho khớp — KHÔNG đổi `actions.ts`.)

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/quote-lines-actions.ts
git commit -m "feat(ship-ho): quoteShipHoLines — quote mọi enabled line + markup + sort"
```

---

### Task 3: Refactor `NewOrderForm.tsx` — so sánh line + confirm

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`
- Modify: `app/(dashboard)/f/ship-ho/new/page.tsx`

**Interfaces:**
- Consumes: `quoteShipHoLines`, `LineQuote` (Task 2); `createShipHoOrder` (đã có). Không còn dùng `listAccounts` trong form.

**Bối cảnh:** `NewOrderForm` hiện (sau feature geo) là client component: props `{ partners, accounts, userEmail }`; state `f` gồm `{ code, partnerBrandSlug, recipientName, phone, country, city, postcode, address1, weightKg, dimLengthCm, dimWidthCm, dimHeightCm, packagingType, carrierAccountId }`; có helper `set(k)` cho input text, `SearchSelect` cho country/city, và `submit()` gọi `createShipHoOrder(...)` với `carrierAccountId` + `carrierKey` (từ `accounts.find`). READ file trước khi sửa.

- [ ] **Step 1: Bỏ prop `accounts` + carrierAccountId khỏi form** — trong `NewOrderForm.tsx`:
  - Xoá `accounts` khỏi props + interface `AccountOpt` (nếu có) + tham số.
  - Xoá `carrierAccountId` khỏi state `f` (khởi tạo).
  - Xoá block JSX dropdown "Carrier account".
  - Thêm imports:

```tsx
import { quoteShipHoLines, type LineQuote } from '@/features/ship-ho/quote-lines-actions';
```

- [ ] **Step 2: Thêm state so sánh + helper invalidate**

```tsx
  const [lines, setLines] = useState<LineQuote[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareErr, setCompareErr] = useState<string | null>(null);
```

Sửa **mọi setter field** để clear kết quả so sánh (đổi input → so sánh lại). Thay helper `set` hiện tại + các `SearchSelect onChange` bằng cách gọi qua 1 patch chung:

```tsx
  // cập nhật field + huỷ bảng so sánh cũ (giá phụ thuộc input)
  const patch = (partial: Partial<typeof f>) => {
    setF((prev) => ({ ...prev, ...partial }));
    setLines([]); setSelectedAccountId(''); setCompareErr(null);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => patch({ [k]: e.target.value } as Partial<typeof f>);
```

Và đổi 2 `SearchSelect`:
- Country `onChange={(v) => patch({ country: v, city: '' })}`
- City `onChange={(v) => patch({ city: v })}`
- Phone input `onChange={(e) => patch({ phone: e.target.value })}` (phone không ảnh hưởng giá nhưng patch vẫn an toàn — clear rồi so sánh lại; chấp nhận).

- [ ] **Step 3: Nút "So sánh giá line" + xử lý** — chèn thay chỗ dropdown carrier cũ (trước nút submit):

```tsx
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={comparing || !f.partnerBrandSlug || !f.country || !f.weightKg}
            onClick={() =>
              start(async () => {
                setComparing(true); setCompareErr(null); setLines([]); setSelectedAccountId('');
                const r = await quoteShipHoLines({
                  partnerBrandSlug: f.partnerBrandSlug, weightKg: f.weightKg, country: f.country,
                  city: f.city || undefined, postcode: f.postcode || undefined,
                  dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
                  dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
                });
                setComparing(false);
                if (r.error) { setCompareErr(r.error); return; }
                setLines(r.lines);
              })
            }
          >
            {comparing ? 'Đang tính…' : 'So sánh giá line'}
          </Button>
          {compareErr && <p className="text-sm text-red-600 mt-1">{compareErr}</p>}
        </div>
```

> NOTE: `start` là `useTransition` đã có trong form. Nếu form dùng tên khác cho pending/transition, dùng đúng tên đó.

- [ ] **Step 4: Bảng lines (radio chọn)** — ngay sau nút so sánh:

```tsx
        {lines.length > 0 && (
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b text-muted-foreground">
                <tr className="[&>th]:text-left [&>th]:p-2">
                  <th></th><th>Line</th><th>Cước carrier</th><th>Giá thu</th><th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.accountId}
                      className={`border-b cursor-pointer [&>td]:p-2 ${selectedAccountId === l.accountId ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
                      onClick={() => setSelectedAccountId(l.accountId)}>
                    <td><input type="radio" name="ship-line" checked={selectedAccountId === l.accountId} onChange={() => setSelectedAccountId(l.accountId)} /></td>
                    <td>{l.name}{l.carrierKey ? ` · ${l.carrierKey}` : ''}</td>
                    <td>{l.carrierCostVnd.toLocaleString('vi-VN')} ₫</td>
                    <td className="font-medium">{l.chargedVnd.toLocaleString('vi-VN')} ₫</td>
                    <td>{l.marginVnd.toLocaleString('vi-VN')} ₫</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!comparing && lines.length === 0 && f.partnerBrandSlug && f.country && f.weightKg && !compareErr && (
          <p className="text-sm text-muted-foreground">Bấm “So sánh giá line”. Nếu không có line nào áp dụng cho tuyến này, kiểm tra cân/địa chỉ.</p>
        )}
```

- [ ] **Step 5: Đổi submit → Confirm & tạo đơn với line đã chọn**

Thay nút "Tạo đơn & tính giá" cũ bằng:

```tsx
        <Button
          onClick={submit}
          disabled={pending || !selectedAccountId}
        >
          {pending ? 'Đang tạo…' : 'Confirm & tạo đơn'}
        </Button>
```

Và sửa `submit()`: bỏ `acc = accounts.find(...)`; lấy line đã chọn:

```tsx
  const submit = () =>
    start(async () => {
      setErr(null);
      const line = lines.find((l) => l.accountId === selectedAccountId);
      if (!line) { setErr('Chọn 1 line ship trước'); return; }
      const dial = f.country ? dialCodeFor(f.country) : null;
      const recipientPhone = f.phone.trim() ? (dial ? `+${dial} ${f.phone.trim()}` : f.phone.trim()) : undefined;
      const r = await createShipHoOrder({
        code: f.code, partnerBrandSlug: f.partnerBrandSlug, recipientName: f.recipientName,
        recipientPhone, country: f.country, city: f.city, postcode: f.postcode, address1: f.address1,
        weightKg: f.weightKg, dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
        dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
        carrierKey: line.carrierKey ?? undefined, carrierAccountId: line.accountId, createdBy: userEmail,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else router.push(`/f/ship-ho/${r.id}`);
    });
```

(Giữ `dialCodeFor` import + `pending`/`start`/`router`/`setErr`/`userEmail` như file hiện có.)

- [ ] **Step 6: Bỏ `accounts` khỏi page** — trong `app/(dashboard)/f/ship-ho/new/page.tsx`:
  - Bỏ `listAccounts` khỏi `Promise.all` (chỉ còn `listShipHoPartners()`), bỏ import `listAccounts` nếu không dùng nữa, và bỏ prop `accounts={...}` khi render `<NewOrderForm>`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/ship-ho"` → no errors.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx" "app/(dashboard)/f/ship-ho/new/page.tsx"
git commit -m "feat(ship-ho): form so sánh giá line + confirm-to-create (bỏ auto-áp carrier)"
```

---

## Self-Review

**1. Spec coverage:**
- §3 action `quoteShipHoLines` (quote mọi enabled account, ẩn line lỗi, sort, markup) → Task 2; helper `summarizeLine` → Task 1. ✔
- §4 form: bỏ dropdown, nút So sánh (disable khi thiếu partner/country/cân), bảng cột cước/thu/margin, radio chọn, Confirm & tạo đơn, invalidate khi đổi input, message rỗng → Task 3. ✔
- §5 create dùng line đã chọn qua `createShipHoOrder`, không đổi backend → Task 3 (chỉ đổi cách lấy carrierAccountId). ✔
- §6 test thuần `summarizeLine` → Task 1. ✔
- §7 YAGNI: không cache/không auto-chọn/không đụng import lô → không task nào làm. ✔

**2. Placeholder scan:** không TBD/TODO; code cụ thể từng step. 2 NOTE (Task 2 field listAccounts, Task 3 tên `start`) là kiểm chứng thực tế với file hiện có.

**3. Type consistency:**
- `summarizeLine(number, number): {chargedVnd, marginVnd}` (Task 1) dùng ở Task 2. ✔
- `LineQuote {accountId,name,carrierKey,carrierCostVnd,chargedVnd,marginVnd}` + `quoteShipHoLines(QuoteLinesInput)` (Task 2) dùng ở Task 3 (`lines`, `l.accountId/name/carrierKey/carrierCostVnd/chargedVnd/marginVnd`, gọi `quoteShipHoLines({...})`). ✔
- `createShipHoOrder` input fields (Task 3 submit) = interface đã có (`carrierAccountId`, `carrierKey`, `recipientPhone`, …). ✔
- `patch`/`set` (Task 3) đồng bộ clear `lines`/`selectedAccountId`. ✔

## Execution Handoff (điền sau khi lưu plan)
