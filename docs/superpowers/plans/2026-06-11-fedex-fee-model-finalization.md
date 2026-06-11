# FedEx fee model hoàn chỉnh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FedEx Direct Signature + US import fee auto-apply, FedEx fuel base gồm demand+signature; đối soát bóc phí nhập bị gộp trong cột VAT để đơn FedEx US khớp 0đ.

**Architecture:** Gần như toàn bộ là đổi dữ liệu cấu hình (engine đã hỗ trợ `apply_mode='always'` + `fuelable` per-row). Thêm 2 chỉnh ở `reconcile-diagnose.ts`: tách phí nhập ẩn trong VAT, và verdict cho đơn engine-tính-ký-nhận-bill-không-thu.

**Tech Stack:** Drizzle, Vitest (TDD), Next.js.

**Spec:** `docs/superpowers/specs/2026-06-11-fedex-fee-model-finalization-design.md`

**State hiện tại (production 2026-06-11), account FedEx `'FedEx Vietnam — International Priority (IP) 2026'`:**
- Signature (addon_fixed): 3 dòng `when_billed`, `fuelable=true` sẵn — 88k (2025-06-01→2026-01-01), 92.7k (2026-01-01→null), 92.7k (null→2025-06-01). Có excludedCountryCodes 13 nước.
- Import fee (country_fixed US): 2 dòng `when_billed`, fuelable null — 37.4k (2025), 68.3k (2026).
- Demand (demand_per_kg): 4 dòng châu Mỹ `fuelable=null` (US/PR, CA, MX, LAC — value 11.300); 4 dòng đã `fuelable=true` (MEISA/IL/EU).

---

### Task 1: Đối soát — bóc phí nhập trong VAT + verdict ký nhận (TDD)

**Files:**
- Modify: `features/shipments/reconcile-diagnose.ts`
- Test: `features/shipments/reconcile-diagnose.test.ts`

- [ ] **Step 1.1: Test FAIL trước** — describe mới (pattern input hiện có):

```ts
describe('FedEx fee model — phí nhập gộp VAT + ký nhận always (spec 2026-06-11)', () => {
  // (a) US đủ: engine countryFixed 68_300, b.importHandling=0, b.elevatedRisk=0,
  //     b.vat = trueVat + 68_300, vatPercent 8, signature engine=billed.
  //     → component vat.delta nhỏ (≈0, dùng trueVat), elevatedRisk.delta ≈0
  //       (68_300 bóc từ VAT khớp engine countryFixed). totalDelta 0 → KHỚP.
  // (b) US thiếu ký nhận: engine addons 92_700 (always), billed signature 0
  //     → signature KHONG_KHOP (delta -92_700), verdict 'tính phí ký nhận nhưng hóa đơn không thu'.
  // (c) đơn thường non-US: engine countryFixed 0 → KHÔNG bóc VAT, vat component như cũ (regression).
  // (d) DHL ER: b.elevatedRisk>0 (phí nằm đúng cột) → KHÔNG bóc, giữ nguyên.
});
```

(Viết đầy đủ theo builder thật.) Run → (a)(b) FAIL.

- [ ] **Step 1.2: Implement — tách phí nhập (đặt TRƯỚC component vat)**

Trong `diagnoseReconcileRow`, trước khi push component `vat`:

```ts
  // Phí nhập khẩu (FedEx US) bị gộp trong cột VAT của bill (VAT phẳng 8% —
  // spec 2026-06-11). Bóc ra khi engine CÓ phí nhập (countryFixed>0) NHƯNG
  // bill không để ở cột riêng (importHandling/elevatedRisk = 0) → phần dư
  // trong cột VAT chính là phí nhập. Đơn thường: countryFixed=0 → không bóc.
  let vatBilled = n0(b.vat);
  let importBundled = 0;
  if (input.vatPercent > 0 && r(n0(e.countryFixed ?? null)) > 0
      && n0(b.importHandling ?? null) === 0 && n0(b.elevatedRisk) === 0) {
    const trueVat = r(b.total * input.vatPercent / (100 + input.vatPercent));
    const excess = r(vatBilled - trueVat);
    if (Math.abs(excess) > 1000) { importBundled = excess; vatBilled = trueVat; }
  }
```

Component `vat`: đổi `n0(b.vat)` → `vatBilled` (cả chỗ tính `vatDelta` và chỗ push). Component `elevatedRisk`: `erBilled = r(n0(b.elevatedRisk) + n0(b.importHandling ?? null) + importBundled)`.

Bất biến Σ giữ nguyên: `trueVat + importBundled === vat column`.

- [ ] **Step 1.3: Implement — verdict ký nhận engine-thu-bill-không**

Trong nhánh verdict dominant (đặt SAU nhánh nước-miễn, TRƯỚC nhánh sai-bảng-giá-signature):

```ts
    } else if (dominant.key === 'signature' && dominant.delta < 0
        && !e.addonExcludedForCountry) {
      // Engine tính ký nhận (always) nhưng hóa đơn không thu.
      verdict = 'Hệ thống tính phí ký nhận nhưng hóa đơn không thu — kiểm tra (đơn lẽ ra phải có ký nhận?)';
      severity = 'config';
```

- [ ] **Step 1.4:** vitest diagnose pass cả mới lẫn cũ; toàn suite xanh; tsc sạch.

- [ ] **Step 1.5: Commit**

```bash
git add features/shipments/reconcile-diagnose.ts
git commit -m "feat(reconcile): bóc phí nhập gộp trong VAT + verdict ký nhận always

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Data script đổi cấu hình FedEx

**Files:**
- Create: `scripts/migrate-fedex-fee-model.ts`

- [ ] **Step 2.1: Script** (dry-run mặc định/--apply, transaction, assert rowCount, idempotent):

```ts
/** Migration MỘT LẦN (spec 2026-06-11 fedex-fee-model-finalization):
 *  (1) Direct Signature (addon_fixed) → apply_mode always (đã fuelable=true).
 *  (2) US import handling (country_fixed) → apply_mode always (giữ không fuel).
 *  (3) Demand (demand_per_kg) → fuelable=true (FedEx fuel cả demand+sig).
 *  DHL KHÔNG đụng.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX = 'FedEx Vietnam — International Priority (IP) 2026';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const before = await db.execute(sql`
    SELECT cs.kind, cs.value::int, cs.apply_mode, cs.fuelable, cs.country_codes
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX} AND cs.kind IN ('addon_fixed','country_fixed','demand_per_kg')
    ORDER BY cs.kind, cs.value`);
  console.table(before.rows);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.transaction(async (tx) => {
    const sig = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode='always',
        note = replace(cs.note, 'when_billed', 'always')
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='addon_fixed' AND cs.note ILIKE '%Direct Signature%'`);
    if (Number(sig.rowCount ?? 0) !== 3) throw new Error(`signature ${sig.rowCount}/3 — rollback`);

    const imp = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode='always'
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='country_fixed' AND cs.note ILIKE '%import handling%'`);
    if (Number(imp.rowCount ?? 0) !== 2) throw new Error(`import fee ${imp.rowCount}/2 — rollback`);

    const dem = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET fuelable=true
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='demand_per_kg' AND (cs.fuelable IS NULL OR cs.fuelable=false)`);
    console.log(`✓ signature→always(3), import→always(2), demand fuelable+(${dem.rowCount})`);
  });
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2.2:** Chạy DRY-RUN (`npx tsx scripts/migrate-fedex-fee-model.ts`) — in state hiện tại. KHÔNG --apply (Task 3).

- [ ] **Step 2.3: Commit**

```bash
git add scripts/migrate-fedex-fee-model.ts
git commit -m "feat(carrier-rates): script FedEx signature/import-fee always + demand fuelable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Apply + fleet verify + push

- [ ] **Step 3.1:** Probe BASELINE trước apply (pattern probe-fleet: `getReconcileCached(true)` → total/delta + FedEx delta0 + severity; lưu lại số).
- [ ] **Step 3.2:** Dry-run lần cuối rồi `npx tsx scripts/migrate-fedex-fee-model.ts --apply`.
- [ ] **Step 3.3:** Probe verify DATA: signature 3 dòng `always`, import fee 2 dòng `always`, mọi demand_per_kg `fuelable=true`; DHL country_fixed (ER) vẫn `always`/nguyên.
- [ ] **Step 3.4:** Probe fleet SAU apply. Kỳ vọng:
  - **FedEx delta0 TĂNG mạnh** (đơn US đủ signature+import-fee giờ khớp 0đ).
  - Tổng delta GIẢM.
  - ~97 đơn US không có signature trên bill → verdict "tính ký nhận nhưng bill không"; ~22 đơn không có import fee → lệch; ~6 đơn demand-fuel lệch. In danh sách để báo operator.
  - **DHL: KHÔNG đổi** (delta0 676 giữ nguyên). non-US FedEx: kiểm không regress bất ngờ (so severity trước/sau).
  - **NẾU DHL hoặc non-US regress** → DỪNG, báo lại trước khi push (có thể cần thu hẹp phạm vi demand fuelable). Script idempotent + có thể viết revert.
- [ ] **Step 3.5:** `npx tsc --noEmit && npx vitest run && npx eslint .` sạch/xanh; `npx next build` pass.
- [ ] **Step 3.6:** `git push origin main`; sau deploy mở Đối soát `?refresh=1`.
