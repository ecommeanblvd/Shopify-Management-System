# Dịch vụ bổ sung (addon_fixed) — Direct Signature DHL/FedEx — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loại surcharge mới `addon_fixed` ("Dịch vụ bổ sung") với 2 chế độ `always`/`when_billed`; migrate DHL Direct Signature ra khỏi bucket peak, khai giá FedEx Direct Signature để đối soát kiểm giá thay vì pass-through mù.

**Architecture:** Enum + cột `apply_mode` mới trong `carrier_surcharges`; engine thuần (`quote.ts`) thêm 2 trường breakdown `addons` (always, vào total) và `addonReference` (when_billed, chỉ tham chiếu); đối soát đổi nguồn dòng signature sang `addons` và kiểm giá billed với `addonReference`. Data migrate qua script dry-run/--apply (pattern `scripts/migrate-warehouse-staging.ts`) vì enum value mới không dùng được trong cùng transaction với `ALTER TYPE ADD VALUE`.

**Tech Stack:** Drizzle (migrations qua `drizzle-kit generate`), Vitest (TDD pure engine), Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-06-11-addon-services-direct-signature-design.md`

**Hằng số tra cứu sẵn (production, đã verify 2026-06-11):**
- Account DHL: `name = 'DHL Express Vietnam — Worldwide Export 2026'` (key dhl)
- Account FedEx: `name = 'FedEx Vietnam — International Priority (IP) 2026'` (key fedex)
- 2 dòng DHL cần re-kind: `kind='peak_fixed' AND note ILIKE '%Direct Signature%'` (130k ends 2026-01-05, 150k starts 2026-01-05, fuelable=false, active=true)
- FedEx cần insert: 88.000 (ends 2026-01-05) / 92.700 (starts 2026-01-05), fuelable=true

---

### Task 1: Schema — enum `addon_fixed` + cột `apply_mode`

**Files:**
- Modify: `db/schema.ts` (enum `carrierSurchargeKindEnum` ~dòng 365; bảng `carrierSurcharges` ~dòng 409)
- Generate: `db/migrations/0056_*.sql`

- [ ] **Step 1.1: Sửa `db/schema.ts`**

Enum — thêm value cuối danh sách (KHÔNG đổi thứ tự value cũ):

```ts
export const carrierSurchargeKindEnum = pgEnum('carrier_surcharge_kind', [
  'fuel_percent',
  'peak_fixed',
  // ... các value hiện có giữ nguyên thứ tự ...
  'contract_discount_pct',
  // Dịch vụ bổ sung cố định/lô hàng (Direct Signature DHL/FedEx).
  // apply_mode quyết định: 'always' cộng vào quote; 'when_billed' chỉ là
  // giá tham chiếu cho đối soát.
  'addon_fixed',
]);
```

Bảng `carrierSurcharges` — thêm cột sau `fuelable`/`vatable` (đặt cạnh các cột override):

```ts
  // Chế độ áp dụng — chỉ có nghĩa với kind='addon_fixed':
  //   'always'      → engine cộng vào mọi quote (DHL Direct Signature).
  //   'when_billed' → KHÔNG vào quote; đối soát dùng làm giá tham chiếu
  //                   kiểm khi bill có dòng này (FedEx Direct Signature).
  applyMode: text('apply_mode').notNull().default('always'),
```

- [ ] **Step 1.2: Generate + migrate**

```bash
npx drizzle-kit generate --name addon-fixed-apply-mode
npx drizzle-kit migrate
```

Expected: file `db/migrations/0056_addon-fixed-apply-mode.sql` chứa
`ALTER TYPE "public"."carrier_surcharge_kind" ADD VALUE 'addon_fixed';` và
`ALTER TABLE "carrier_surcharges" ADD COLUMN "apply_mode" text DEFAULT 'always' NOT NULL;`
— migrate chạy sạch trên DB (.env).

- [ ] **Step 1.3: Kiểm + commit**

Run: `npx tsc --noEmit` → sạch.

```bash
git add db/schema.ts db/migrations
git commit -m "feat(carrier-rates): schema addon_fixed + apply_mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Engine — addons/addonReference (TDD)

**Files:**
- Modify: `features/carrier-rates/engine/quote.ts`
- Modify: `features/carrier-rates/engine/load.ts:116-137`
- Test: `features/carrier-rates/engine/quote.test.ts`

- [ ] **Step 2.1: Viết test FAIL trước** (theo pattern test peak_fixed hiện có ~dòng 717; dùng helper snapshot của file test — đọc các test cạnh đó để lấy đúng helper dựng snap):

```ts
describe('addon_fixed (Dịch vụ bổ sung)', () => {
  it("apply_mode='always' cộng vào total, fuelable=false nằm NGOÀI fuel base (DHL Direct Signature)", () => {
    // snap có fuel 50%, base 1,000,000; addon 150,000 always, fuelable=false
    // → fuel = 500,000 (không tính addon); total có +150,000.
    // expect(q.breakdown.addons).toBe(150000);
    // expect(q.breakdown.fuel).toBe(500000);
    // expect(q.breakdown.addonReference).toBe(0);
  });
  it("apply_mode='when_billed' KHÔNG vào total — chỉ xuất hiện ở addonReference (FedEx)", () => {
    // addon 92,700 when_billed, fuelable=true
    // → breakdown.addons = 0; addonReference = 92700;
    //   carrierCost KHÔNG đổi so với snap không có addon; fuel KHÔNG đổi.
  });
  it('gate theo startsAt/endsAt như mọi surcharge', () => {
    // addon always 130,000 ends 2026-01-05 + 150,000 starts 2026-01-05;
    // effectiveDate 2025-12-15 → addons=130000; 2026-02-01 → addons=150000.
  });
});
```

(Code test viết ĐẦY ĐỦ theo helper thật của file — 3 case trên là bắt buộc.)

Run: `npx vitest run features/carrier-rates/engine/quote.test.ts` → FAIL (chưa có field).

- [ ] **Step 2.2: Implement `quote.ts`**

1. Type: `SurchargeKind` thêm `| 'addon_fixed'`; `SurchargeSnap` thêm:

```ts
  /** Chế độ áp dụng của addon_fixed. Kind khác bỏ qua. NULL → 'always'. */
  applyMode?: 'always' | 'when_billed' | null;
```

2. `isFuelable` switch: thêm `case 'addon_fixed':` vào nhóm `return false`
   (default ngoài fuel base; DHL giữ false, FedEx set per-row true nhưng
   when_billed không vào quote nên không ảnh hưởng).

3. Tính tổng (đặt cạnh `const peak = ...` ~dòng 503):

```ts
  // Dịch vụ bổ sung (Direct Signature...): 'always' vào quote;
  // 'when_billed' chỉ là giá tham chiếu cho đối soát, KHÔNG vào total.
  const addons = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'addon_fixed')
    .filter((s) => (s.applyMode ?? 'always') === 'always')
    .reduce((sum, s) => sum + s.value, 0);
  const addonReference = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'addon_fixed')
    .filter((s) => s.applyMode === 'when_billed')
    .reduce((sum, s) => sum + s.value, 0);
```

4. `rowContribution` switch (~dòng 620): thêm

```ts
      case 'addon_fixed':
        return (s.applyMode ?? 'always') === 'always' ? s.value : 0;
```

   (đảm bảo when_billed không lọt vào fuelable/vatable subtotal qua đường này).

5. `QuoteBreakdown` interface: sau `peak: number;` thêm

```ts
  /** Dịch vụ bổ sung apply_mode='always' (DHL Direct Signature). Vào total. */
  addons: number;
  /** Giá tham chiếu addon when_billed (FedEx Direct Signature) — KHÔNG vào total. */
  addonReference: number;
```

6. Cộng `addons` vào tổng đúng nơi `peak` đang được cộng (cùng subtotal,
   qua cùng đường fuelable/vatable per-row — soi chỗ `peak` tham gia
   subtotal và làm y hệt cho `addons`). Breakdown return thêm
   `addons: Math.round(addons), addonReference: Math.round(addonReference),`.

7. `load.ts` surcharges.map thêm:

```ts
      applyMode: (s.applyMode === 'when_billed' ? 'when_billed' : 'always') as 'always' | 'when_billed',
```

- [ ] **Step 2.3: Test pass + toàn suite**

Run: `npx vitest run features/carrier-rates/engine/quote.test.ts` → 3 test mới PASS.
Run: `npx vitest run` → toàn suite xanh (các test cũ không vỡ — addons mặc định 0).
Run: `npx tsc --noEmit` → chú ý các chỗ destructure QuoteBreakdown thiếu field mới (recalc.ts, markets/reconciliation.ts nếu có) — bổ sung field cho compile sạch, KHÔNG đổi logic của chúng.

- [ ] **Step 2.4: Commit**

```bash
git add features/carrier-rates/engine
git commit -m "feat(engine): addon_fixed — addons (always) + addonReference (when_billed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Data script — re-kind DHL, insert FedEx

**Files:**
- Create: `scripts/migrate-addon-signature.ts`

- [ ] **Step 3.1: Viết script** (pattern dry-run mặc định / `--apply` như `scripts/migrate-warehouse-staging.ts`):

```ts
/** Migration MỘT LẦN (spec 2026-06-11 addon-services):
 *  (1) re-kind 2 dòng DHL Direct Signature: peak_fixed → addon_fixed (always);
 *  (2) insert 2 dòng FedEx Direct Signature (when_billed, fuelable=true).
 *  Idempotent: chạy lại không nhân đôi (match theo note 'Direct Signature').
 *  npx tsx scripts/migrate-addon-signature.ts            # dry-run
 *  npx tsx scripts/migrate-addon-signature.ts --apply    # ghi thật
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';
const BOUNDARY = '2026-01-05';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');

  // (1) DHL re-kind
  const dhl = await db.execute(sql`
    SELECT cs.id, cs.value::int, cs.starts_at::date, cs.ends_at::date
    FROM carrier_surcharges cs
    WHERE cs.kind = 'peak_fixed' AND cs.note ILIKE '%Direct Signature%'`);
  console.log(`DHL peak_fixed 'Direct Signature' cần re-kind: ${dhl.rows.length} (kỳ vọng 2)`);
  console.table(dhl.rows);

  // (2) FedEx insert (idempotent — đếm dòng addon_fixed Direct Signature hiện có)
  const fedexExisting = await db.execute(sql`
    SELECT count(*)::int AS n FROM carrier_surcharges cs
    JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'addon_fixed'
      AND cs.note ILIKE '%Direct Signature%'`);
  const already = Number((fedexExisting.rows[0] as { n: number }).n);
  console.log(`FedEx addon_fixed Direct Signature hiện có: ${already} (0 = sẽ insert 2)`);

  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.execute(sql`
    UPDATE carrier_surcharges
    SET kind = 'addon_fixed', apply_mode = 'always'
    WHERE kind = 'peak_fixed' AND note ILIKE '%Direct Signature%'`);
  console.log('✓ DHL re-kinded');

  if (already === 0) {
    await db.execute(sql`
      INSERT INTO carrier_surcharges
        (carrier_account_id, kind, value, fuelable, active, apply_mode, starts_at, ends_at, note)
      SELECT ca.id, 'addon_fixed', v.value, true, true, 'when_billed', v.starts_at::timestamp, v.ends_at::timestamp, v.note
      FROM carrier_accounts ca,
        (VALUES
          (88000,  NULL,        ${BOUNDARY}, 'Direct Signature — 88k đến trước 05/01/2026 (when_billed)'),
          (92700,  ${BOUNDARY}, NULL,        'Direct Signature — 92.7k từ 05/01/2026 (when_billed)')
        ) AS v(value, starts_at, ends_at, note)
      WHERE ca.name = ${FEDEX_ACCOUNT}`);
    console.log('✓ FedEx inserted 2 rows');
  } else {
    console.log('FedEx rows đã tồn tại — bỏ qua insert.');
  }
  console.log('ÁP DỤNG XONG. Nhớ refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

(Chỉnh kiểu cast `::timestamp`/NULL trong VALUES cho Postgres chấp nhận —
nếu drizzle sql template kêu ca, đổi sang 2 INSERT riêng có/không starts_at.)

- [ ] **Step 3.2: Chạy DRY-RUN (không --apply), dán output vào report**

Run: `npx tsx scripts/migrate-addon-signature.ts`
Expected: DHL 2 dòng (130k/150k), FedEx hiện có 0. KHÔNG chạy --apply ở task này (Task 6 sẽ chạy).

- [ ] **Step 3.3: Commit**

```bash
git add scripts/migrate-addon-signature.ts
git commit -m "feat(carrier-rates): script migrate Direct Signature sang addon_fixed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Đối soát — dòng signature dùng addons + kiểm giá when_billed (TDD)

**Files:**
- Modify: `features/shipments/reconcile.ts` (~dòng 307-320 engine map; ~dòng 391 ReconcileRow)
- Modify: `features/shipments/reconcile-diagnose.ts` (interface engine ~dòng 84-100; nhánh signature ~dòng 284-303)
- Test: `features/shipments/reconcile-diagnose.test.ts` (file test diagnose hiện có — tìm đúng tên bằng `ls features/shipments/*diagnose*test*`)

- [ ] **Step 4.1: Test FAIL trước** — 3 case (dựng input theo pattern test diagnose hiện có):

```ts
// (a) FedEx: billed.signature = 92700, engine.addons = 0, addonReference = 92700,
//     fuel khớp → component signature có cause 'PHI_TUY_CHON'.
// (b) FedEx sai giá: billed.signature = 100000, addonReference = 92700, fuel khớp
//     → cause 'KHONG_KHOP' (KHÔNG được PHI_TUY_CHON).
// (c) DHL: engine.addons = 150000, billed.signature = 150000 → 'KHOP'
//     (engine.peak = 0 — không còn fold).
```

Run vitest file đó → FAIL.

- [ ] **Step 4.2: Implement**

`reconcile-diagnose.ts` — interface `engine` thêm (cạnh `peak?`):

```ts
    /** Dịch vụ bổ sung always (DHL Direct Signature). Nguồn dòng signature. */
    addons?: number;
    /** Giá tham chiếu addon when_billed (FedEx) — kiểm giá pass-through. */
    addonReference?: number;
```

Nhánh signature (~dòng 284) thay thế:

```ts
  // signature — engine = residential_fixed + addon_fixed(always).
  // (Trước 2026-06-11 DHL book dưới peak_fixed và bị fold ở đây — nay
  // addon_fixed là chỗ ở chính thức; peak chỉ còn Premium, không fold nữa.)
  const sigBilled = n0(b.signature);
  const sigEngine = r(e.residential + n0(e.addons ?? null));
  const sigDelta = r(sigBilled - sigEngine);
  let sigCause: DiagnosisCause = sigDelta === 0 ? 'KHOP' : 'KHONG_KHOP';
  // Opt-in theo đơn (FedEx): chấp nhận pass-through CHỈ KHI số học fuel khớp
  // VÀ giá đúng bảng addon when_billed (addonReference). Chưa khai giá
  // (reference = 0) giữ hành vi cũ — không chặt hơn với carrier chưa cấu hình.
  const fuelComp = components.find((c) => c.key === 'fuel');
  const sigRef = n0(e.addonReference ?? null);
  if (sigDelta > 0 && sigEngine === 0 && fuelComp && fuelComp.cause !== 'LECH_FUEL'
      && (sigRef === 0 || sigBilled === sigRef)) {
    sigCause = 'PHI_TUY_CHON';
  }
  components.push({ key: 'signature', billed: sigBilled, engine: sigEngine, delta: sigDelta, cause: sigCause });
```

Verdict dominant: thêm nhánh cho `dominant.key === 'signature'` khi sai bảng giá
(đặt cùng chỗ các nhánh `dominant.key === 'elevatedRisk'`… hiện có):

```ts
    } else if (dominant.key === 'signature' && n0(e.addonReference ?? null) > 0) {
      verdict = `Direct Signature sai bảng giá: bill ${dominant.billed.toLocaleString('vi-VN')}đ ≠ ${n0(e.addonReference ?? null).toLocaleString('vi-VN')}đ — đối chiếu hóa đơn với biểu phí dịch vụ bổ sung`;
      severity = 'config';
```

`reconcile.ts` — engine map thêm `addons: q.breakdown.addons, addonReference: q.breakdown.addonReference,`;
`ReconcileRow` thêm `engineAddons: number | null;` (set từ `engine?.addons ?? null`)
và comment của `enginePeak` sửa thành "Premium (peak_fixed) — thường 0".
Dòng nào trong `buildRow` đang fold peak vào signature hiển thị (nếu có) đổi sang addons — grep `peak` trong reconcile.ts + ReconcileDetailPanel để bắt hết.

- [ ] **Step 4.3: Test pass + suite + commit**

Run: vitest file diagnose → 3 case PASS; `npx vitest run` toàn suite xanh; tsc sạch.

```bash
git add features/shipments
git commit -m "feat(reconcile): signature đối soát qua addon_fixed; kiểm giá FedEx when_billed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — breakdown, trang surcharges, dialog, detail panel

**Files:**
- Modify: `components/carrier-rates/QuoteForm.tsx:178` (vùng render breakdown)
- Modify: `app/(dashboard)/f/carrier-rates/[id]/surcharges/page.tsx` (KIND_META + KIND_ORDER + createAction)
- Modify: `components/carrier-rates/SurchargeEditDialog.tsx`
- Modify: `components/shipping-reconcile/ReconcileDetailPanel.tsx`
- Modify: `features/carrier-rates/surcharges-actions.ts` (persist applyMode)

- [ ] **Step 5.1: QuoteForm** — cạnh dòng `{ label: 'Peak / premium', ... }` thêm:

```ts
    { label: 'Dịch vụ bổ sung', value: breakdown.addons, muted: breakdown.addons === 0 },
```

- [ ] **Step 5.2: Trang surcharges** — `KIND_META` thêm entry (icon `PenLine` từ lucide-react, đã/thêm import):

```tsx
  addon_fixed: {
    label: 'Dịch vụ bổ sung',
    desc: 'Phí dịch vụ cộng thêm theo lô hàng (Direct Signature…). Chế độ "always" cộng vào mọi quote; "when_billed" chỉ dùng làm giá tham chiếu khi đối soát.',
    formula: "+ value (luôn) hoặc giá tham chiếu (khi bill có)",
    unit: 'amount',
    icon: <PenLine className="size-4" />,
    accent: 'text-violet-600 dark:text-violet-400',
    accentBg: 'bg-violet-500/10',
    supportsPerKg: false,
  },
```

Thêm `'addon_fixed'` vào `KIND_ORDER` (ngay sau `peak_fixed`). Mỗi dòng addon
trong section hiển thị badge chế độ: `Luôn cộng` / `Kiểm khi có bill` (đọc
`s.applyMode`). `createAction`/update action + `surcharges-actions.ts` đọc thêm
field `applyMode` từ formData (chỉ render input khi kind=addon_fixed; default 'always';
validate chỉ nhận 2 giá trị).

- [ ] **Step 5.3: SurchargeEditDialog** — khi `kind === 'addon_fixed'` render select:

```tsx
  <select name="applyMode" defaultValue={current?.applyMode ?? 'always'} className="...">
    <option value="always">Luôn cộng vào quote</option>
    <option value="when_billed">Chỉ kiểm khi bill có</option>
  </select>
```

(theo đúng markup/input style các field hiện có của dialog).

- [ ] **Step 5.4: ReconcileDetailPanel** — grep `peak`/`enginePeak` trong file:
dòng signature engine-side đổi nguồn sang `engineAddons`; nếu panel có dòng
"Peak/Premium" riêng thì giữ (sẽ là 0). Đảm bảo type row khớp Task 4.

- [ ] **Step 5.5: Kiểm + commit**

Run: `npx tsc --noEmit`; `npx eslint` các file đổi; `npx vitest run` xanh.

```bash
git add components app features
git commit -m "feat(ui): nhóm Dịch vụ bổ sung — breakdown, surcharges, đối soát panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Áp data + verify fleet + push

- [ ] **Step 6.1:** `npx tsx scripts/migrate-addon-signature.ts` (dry-run lần cuối — DHL 2, FedEx 0)
- [ ] **Step 6.2:** `npx tsx scripts/migrate-addon-signature.ts --apply`
- [ ] **Step 6.3:** Verify data:

```bash
# Kỳ vọng: addon_fixed = 4 dòng (2 DHL always + 2 FedEx when_billed);
# peak_fixed còn đúng 3 dòng Premium (active=false).
```

(viết probe tsx nhỏ SELECT kind, apply_mode, value, active đếm theo nhóm — in bảng.)

- [ ] **Step 6.4:** Verify reconcile không tệ đi: viết probe tsx gọi
`getReconcileCached(true)` (features/shipments/reconcile-cache.ts) in tổng số
dòng matched/mismatched theo carrier, so với mốc trước migrate (chạy probe này
1 lần TRƯỚC step 6.2 để có baseline). Kỳ vọng: DHL matched giữ nguyên; FedEx
matched không giảm (chỉ phân loại chính xác hơn).
- [ ] **Step 6.5:** `npx tsc --noEmit && npx vitest run && npx eslint .` → sạch/xanh (0 errors).
- [ ] **Step 6.6:** `npx next build` → pass.
- [ ] **Step 6.7:** `git push origin main`. Sau deploy mở trang Đối soát với `?refresh=1`.
