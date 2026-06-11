# FedEx US import handling → when_billed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `country_fixed` hỗ trợ `apply_mode='when_billed'`; FedEx US import handling thôi tự cộng vào quote, chỉ kiểm khi bill có; đối soát fuel credit gộp demand.

**Architecture:** Tái dùng cột `apply_mode` (đã có) trên kind `country_fixed`: when_billed → `countryFixedReference` thay vì vào quote. Đối soát dùng reference để nhận pass-through dòng `elevatedRisk`/`importHandling`. Data đổi 2 dòng FedEx US qua script.

**Tech Stack:** Drizzle, Vitest (TDD), Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-06-11-fedex-import-handling-when-billed-design.md`

**Hằng số (production 2026-06-11):** FedEx account `'FedEx Vietnam — International Priority (IP) 2026'`; 2 dòng country_fixed US: 37.400 (2025-01-01→2026-01-01), 68.300 (2026-01-01→null), note '...import handling...'. Baseline fleet: total delta 29.062.284đ (0,62%), FedEx delta0=864, config=263; 284 đơn FedEx US, 12 có import handling thật (giá 68.300/78.000).

---

### Task 1: Engine — country_fixed apply_mode + countryFixedReference (TDD)

**Files:**
- Modify: `features/carrier-rates/engine/quote.ts`
- Test: `features/carrier-rates/engine/quote.test.ts`

- [ ] **Step 1.1: Test FAIL trước** — describe mới `country_fixed apply_mode` (dùng `makeSnap` helper + country override như các test addon, vd country 'US'):

```ts
describe('country_fixed apply_mode (import handling when_billed)', () => {
  it("apply_mode='when_billed' KHÔNG vào quote — hiện ở countryFixedReference", () => {
    // country_fixed 68_300 country_codes ['US'] applyMode 'when_billed', quote tới US
    // → breakdown.countryFixed = 0, countryFixedReference = 68_300,
    //   carrierCost & fuel KHÔNG đổi so với snap không có row này.
  });
  it("apply_mode='always'/null vẫn vào quote như cũ", () => {
    // cùng row nhưng applyMode null/always, quote US
    // → countryFixed = 68_300, countryFixedReference = 0.
  });
  it('when_billed gate theo nước: quote tới VN (ngoài country_codes) → reference = 0', () => {
    // row US-only when_billed, quote VN → countryFixed = 0, reference = 0.
  });
});
```

(Viết đầy đủ theo helper thật.) Run vitest file → FAIL.

- [ ] **Step 1.2: Implement `quote.ts`**

1. `countryFixed` sum (~dòng 521-524) — tách theo applyMode:

```ts
  // Country-scoped FLAT per-shipment fee. apply_mode='when_billed' (FedEx US
  // import handling) KHÔNG vào quote — chỉ countryFixedReference cho đối soát;
  // các dòng always/null (DHL Elevated Risk) vào countryFixed như cũ.
  const countryFixedRows = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'country_fixed')
    .filter((s) => (!s.countryCodes || s.countryCodes.includes(country)) && !isCountryExcluded(s, country));
  const countryFixed = countryFixedRows
    .filter((s) => (s.applyMode ?? 'always') === 'always')
    .reduce((sum, s) => sum + s.value, 0);
  const countryFixedReference = countryFixedRows
    .filter((s) => s.applyMode === 'when_billed')
    .reduce((sum, s) => sum + s.value, 0);
```

2. `rowContribution` case `country_fixed` (~dòng 651) thêm điều kiện applyMode:

```ts
      case 'country_fixed':
        return (!s.countryCodes || s.countryCodes.includes(country))
          && !isCountryExcluded(s, country)
          && (s.applyMode ?? 'always') === 'always'
          ? s.value : 0;
```

(nếu case hiện tại chưa có `isCountryExcluded` thì thêm luôn cho nhất quán.)

3. `QuoteBreakdown` thêm sau `countryFixed: number;`:

```ts
  /** country_fixed apply_mode='when_billed' (FedEx US import handling) —
   *  KHÔNG vào total, chỉ giá tham chiếu đối soát. */
  countryFixedReference: number;
```

4. Breakdown return thêm `countryFixedReference: Math.round(countryFixedReference),`.

- [ ] **Step 1.3:** vitest file pass; `npx vitest run` xanh; `npx tsc --noEmit` sạch (bổ sung field cho consumer nếu kêu — máy móc).

- [ ] **Step 1.4: Commit**

```bash
git add features/carrier-rates/engine
git commit -m "feat(engine): country_fixed when_billed + countryFixedReference

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Đối soát — import handling pass-through + fuel-on-demand (TDD)

**Files:**
- Modify: `features/shipments/reconcile-diagnose.ts`
- Modify: `features/shipments/reconcile.ts`
- Test: `features/shipments/reconcile-diagnose.test.ts`

- [ ] **Step 2.1: Test FAIL trước** — describe mới (pattern input hiện có):

```ts
describe('import handling when_billed + fuel demand (spec 2026-06-11)', () => {
  // (a) bill importHandling 68_300, engine countryFixed 0, countryFixedReference 68_300,
  //     fuel khớp → component elevatedRisk cause 'PHI_TUY_CHON'.
  // (b) bill importHandling 78_000 ≠ reference 68_300 → 'KHONG_KHOP' + verdict 'sai bảng giá'.
  // (c) DHL: engine countryFixed 68_300 (auto) = billed elevatedRisk → 'KHOP' (regression).
  // (d) fuel: billed fuels signature(92_700)+demand(28_250), engine fuel base = net,
  //     signature pass-through, demand khớp → fuel cause 'PHAI_SINH' (không LECH_FUEL_BASE).
});
```

Run vitest → (a)(b)(d) FAIL.

- [ ] **Step 2.2: Implement `reconcile-diagnose.ts`**

1. `DiagnoseInput.engine` thêm `countryFixedReference?: number;`.

2. elevatedRisk component (~dòng 338-344) thay bằng:

```ts
  const erBilled = r(n0(b.elevatedRisk) + n0(b.importHandling ?? null));
  const erEngine = r(n0(e.countryFixed ?? null));
  const erRef = r(n0(e.countryFixedReference ?? null));
  const erDelta = r(erBilled - erEngine);
  let erCause: DiagnosisCause = erDelta === 0 ? 'KHOP' : 'KHONG_KHOP';
  // Phí xử lý hàng nhập opt-in (FedEx US): engine không tự cộng (when_billed).
  // Bill có + đúng giá tham chiếu → pass-through hợp lệ; sai giá → flag.
  if (erEngine === 0 && erBilled > 0 && erRef > 0) {
    erCause = erBilled === erRef ? 'PHI_TUY_CHON' : 'KHONG_KHOP';
  }
  components.push({ key: 'elevatedRisk', billed: erBilled, engine: erEngine, delta: erDelta, cause: erCause });
```

3. Fuel credit (~dòng 270-273) — mở rộng `explainedBySig` gộp demand:

```ts
      const sigPass = n0(b.signature) > 0 && r(e.residential + n0(e.addons ?? null)) === 0
        ? n0(b.signature) : 0;
      // FedEx có khi fuel cả Demand cùng signature (đo #MBLVD28665). Nhận CẢ
      // hai cơ sở: chỉ-signature, hoặc signature+demand (khi demand khớp).
      const demandMatched = r(n0(b.demand) - e.demand) === 0;
      const extraFueled = sigPass + (demandMatched ? n0(b.demand) : 0);
      const explainedBySig = sigPass > 0 && (
        Math.abs(fuelDelta - (input.fuelPercent / 100) * sigPass) <= 2
        || Math.abs(fuelDelta - (input.fuelPercent / 100) * extraFueled) <= 2);
```

4. Verdict dominant: nhánh elevatedRisk hiện có (~dòng 398) thêm phân biệt sai-bảng-giá when_billed TRƯỚC nhánh DHL config:

```ts
    } else if (dominant.key === 'elevatedRisk' && r(n0(e.countryFixed ?? null)) === 0
        && r(n0(e.countryFixedReference ?? null)) > 0 && dominant.delta > 0) {
      verdict = `Phí xử lý hàng nhập sai bảng giá: bill ${dominant.billed.toLocaleString('vi-VN')}đ ≠ ${r(n0(e.countryFixedReference ?? null)).toLocaleString('vi-VN')}đ — đối chiếu với carrier`;
      severity = 'config';
    } else if (dominant.key === 'elevatedRisk') {
      // ... giữ nguyên 2 message DHL ER hiện có ...
```

`reconcile.ts`: engine map thêm `countryFixedReference: q.breakdown.countryFixedReference,`.

- [ ] **Step 2.3:** vitest diagnose pass cả mới lẫn cũ; toàn suite xanh; tsc sạch.

- [ ] **Step 2.4: Commit**

```bash
git add features/shipments
git commit -m "feat(reconcile): import handling pass-through + fuel credit gộp demand

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI — apply_mode mở cho country_fixed

**Files:**
- Modify: `components/carrier-rates/SurchargeEditDialog.tsx`
- Modify: `features/carrier-rates/surcharges-actions.ts`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/surcharges/page.tsx`

- [ ] **Step 3.1: Dialog** — đổi điều kiện render select applyMode từ `kind === 'addon_fixed'` sang `(kind === 'addon_fixed' || kind === 'country_fixed')`. Sửa text mô tả cho trung tính (vd: "Luôn cộng: engine cộng vào mọi quote. Chỉ kiểm khi bill có: không vào quote — chỉ giá tham chiếu đối soát (FedEx US import handling, Direct Signature).").

- [ ] **Step 3.2: surcharges-actions** — `createSurcharge` (gate applyMode hiện `kind === 'addon_fixed'`) và `updateSurcharge` (`existing.kind === 'addon_fixed'`): mở thành `(kind === 'addon_fixed' || kind === 'country_fixed')`. Khi không phải 2 kind đó vẫn ép `'always'`.

- [ ] **Step 3.3: page.tsx** — `createAction`/`updateAction` đọc `applyMode` từ formData cho cả `country_fixed` (đổi điều kiện gate giống dialog). Badge chế độ trong section: hiện cho cả country_fixed (đổi điều kiện `row.kind === 'addon_fixed'` → 2 kind).

- [ ] **Step 3.4:** tsc + eslint files đổi + vitest xanh. Commit:

```bash
git add components features app
git commit -m "feat(ui): chế độ áp dụng mở cho country_fixed (import handling)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Data script chuyển 2 dòng US import handling

**Files:**
- Create: `scripts/migrate-fedex-import-handling-when-billed.ts`

- [ ] **Step 4.1: Script** (pattern `scripts/migrate-fedex-signature-rules.ts` — dry-run mặc định, --apply, transaction, in account, assert rowCount, idempotent):

```ts
/** Migration MỘT LẦN (spec 2026-06-11 fedex-import-handling-when-billed):
 *  2 dòng FedEx US import handling (country_fixed) → apply_mode='when_billed'.
 *  Engine thôi tự cộng; đối soát kiểm khi bill có. DHL country_fixed (ER) KHÔNG đụng.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const rows = await db.execute(sql`
    SELECT ca.name AS account, cs.id, cs.value::int, cs.apply_mode,
           cs.country_codes, cs.starts_at::date AS from_d, cs.ends_at::date AS to_d, cs.note
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'country_fixed'
      AND cs.note ILIKE '%import handling%'
    ORDER BY cs.starts_at NULLS FIRST`);
  console.table(rows.rows);
  console.log(`Dòng cần chuyển: ${rows.rows.length} (kỳ vọng 2)`);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.transaction(async (tx) => {
    const u = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode = 'when_billed'
      FROM carrier_accounts ca
      WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
        AND cs.kind = 'country_fixed' AND cs.note ILIKE '%import handling%'`);
    if (Number(u.rowCount ?? 0) !== 2) throw new Error(`UPDATE ${u.rowCount}/2 — rollback`);
    console.log('✓ 2 dòng US import handling → when_billed');
  });
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4.2:** Chạy DRY-RUN (`npx tsx scripts/migrate-fedex-import-handling-when-billed.ts`) — 2 dòng. KHÔNG --apply (Task 5).

- [ ] **Step 4.3: Commit**

```bash
git add scripts/migrate-fedex-import-handling-when-billed.ts
git commit -m "feat(carrier-rates): script US import handling sang when_billed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Apply + fleet verify + push

- [ ] **Step 5.1:** Probe baseline TRƯỚC apply (pattern probe-fleet cũ: `getReconcileCached(true)` in total/delta + FedEx delta0 + severity).
- [ ] **Step 5.2:** Dry-run lần cuối rồi `npx tsx scripts/migrate-fedex-import-handling-when-billed.ts --apply`.
- [ ] **Step 5.3:** Probe verify data: 2 dòng FedEx country_fixed US `apply_mode='when_billed'`; DHL country_fixed ER giữ 'always'.
- [ ] **Step 5.4:** Probe fleet sau apply. Kỳ vọng: FedEx delta0 TĂNG (≥272 đơn US hết cộng dư 68.300), tổng delta GIẢM. In các đơn US import-handling còn flag (giá 78.000) + #MBLVD28665 giờ severity gì. DHL không đổi.
- [ ] **Step 5.5:** `npx tsc --noEmit && npx vitest run && npx eslint .` sạch/xanh; `npx next build` pass.
- [ ] **Step 5.6:** `git push origin main`; sau deploy mở Đối soát `?refresh=1`.
