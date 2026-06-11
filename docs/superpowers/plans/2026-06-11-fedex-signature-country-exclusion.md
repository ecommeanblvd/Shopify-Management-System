# FedEx Direct Signature — nước miễn + mốc giá — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surcharge có danh sách nước miễn (`excluded_country_codes`); FedEx Direct Signature thành 3 dòng giá đúng mốc operator; đối soát flag bill thu signature ở nước miễn thay vì pass-through.

**Architecture:** Cột jsonb mới + filter exclusion generic trong engine thuần; cờ `addonExcludedForCountry` chảy từ breakdown → reconcile → diagnose để ra verdict khiếu nại; data sửa qua script dry-run/--apply.

**Tech Stack:** Drizzle, Vitest (TDD), Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-06-11-fedex-signature-country-exclusion-design.md`

**Hằng số:** `EXCLUDED = ['SA','QA','IL','IQ','OM','KZ','JO','MC','LU','CY','CZ','PE','AO']`; account FedEx `'FedEx Vietnam — International Priority (IP) 2026'`; baseline fleet (11/06): total delta 29.062.284đ (0,62%), DHL delta0=676, FedEx delta0=864, FedEx passthrough=101.

---

### Task 1: Schema — `excluded_country_codes`

**Files:**
- Modify: `db/schema.ts` (bảng `carrierSurcharges`, cạnh `countryCodes` ~dòng 427)
- Generate: `db/migrations/0057_*.sql`

- [ ] **Step 1.1:** Thêm cột vào `carrierSurcharges`:

```ts
  // Danh sách nước MIỄN (ISO-2, jsonb) — dòng surcharge KHÔNG áp dụng khi
  // nước đích nằm trong danh sách. NULL = không miễn nước nào. Đối ngẫu với
  // countryCodes (danh sách BAO GỒM); nếu có cả hai, exclusion thắng.
  // Dùng đầu tiên cho FedEx Direct Signature (13 nước miễn, spec 2026-06-11).
  excludedCountryCodes: jsonb('excluded_country_codes'),
```

- [ ] **Step 1.2:** `npx drizzle-kit generate --name surcharge-excluded-countries && npx drizzle-kit migrate`
Expected: 0057 chỉ có `ADD COLUMN "excluded_country_codes" jsonb;` — migrate sạch.

- [ ] **Step 1.3:** `npx tsc --noEmit` sạch. Commit:

```bash
git add db/schema.ts db/migrations
git commit -m "feat(carrier-rates): cột excluded_country_codes cho surcharge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Engine — exclusion theo nước + cờ addonExcludedForCountry (TDD)

**Files:**
- Modify: `features/carrier-rates/engine/quote.ts`
- Modify: `features/carrier-rates/engine/load.ts` (surcharges.map ~dòng 116-137)
- Test: `features/carrier-rates/engine/quote.test.ts` (describe `addon_fixed` hiện có)

- [ ] **Step 2.1: Test FAIL trước** — thêm vào describe addon_fixed (dùng helper snapshot hiện có của file, country của input quote):

```ts
  it('when_billed bị miễn theo nước: addonReference=0 + addonExcludedForCountry=true', () => {
    // addon when_billed 92_700 với excludedCountryCodes ['SA','CZ'];
    // quote tới SA → breakdown.addonReference = 0, addonExcludedForCountry = true,
    // total/fuel không đổi so với snap không addon.
  });
  it('nước ngoài danh sách miễn: reference bình thường, flag=false', () => {
    // cùng row, quote tới US → addonReference = 92_700, addonExcludedForCountry = false.
  });
  it('addon always không exclusions (DHL) không bị ảnh hưởng', () => {
    // addon always 150_000 excludedCountryCodes=null, quote tới SA
    // → addons = 150_000, flag = false.
  });
```

(Viết đầy đủ theo helper thật; 3 case bắt buộc.) Run vitest file → FAIL.

- [ ] **Step 2.2: Implement `quote.ts`**

1. `SurchargeSnap` thêm (cạnh `countryCodes`):

```ts
  /** Nước MIỄN (ISO-2 upper) — row không áp dụng khi đích nằm trong danh
   *  sách. NULL = không miễn. Exclusion thắng countryCodes. */
  excludedCountryCodes?: string[] | null;
```

2. Helper (đặt cạnh `isApplicable`):

```ts
/** True khi row bị MIỄN cho nước đích (excluded_country_codes chứa nước). */
function isCountryExcluded(s: SurchargeSnap, country: string): boolean {
  return !!s.excludedCountryCodes?.includes(country);
}
```

3. Khối addon (~dòng 516-525) thay bằng:

```ts
  // Dịch vụ bổ sung (Direct Signature...): 'always' vào quote;
  // 'when_billed' chỉ là giá tham chiếu cho đối soát, KHÔNG vào total.
  // Row có excluded_country_codes chứa nước đích bị loại; nếu vì thế mà
  // không còn row nào, cờ addonExcludedForCountry bật để đối soát biết
  // "carrier không được thu ở nước này" (≠ "chưa cấu hình").
  const addonRowsByDate = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'addon_fixed');
  const addonRows = addonRowsByDate.filter((s) => !isCountryExcluded(s, country));
  const addons = addonRows
    .filter((s) => (s.applyMode ?? 'always') === 'always')
    .reduce((sum, s) => sum + s.value, 0);
  const addonReference = addonRows
    .filter((s) => s.applyMode === 'when_billed')
    .reduce((sum, s) => sum + s.value, 0);
  const addonExcludedForCountry = addonRowsByDate.some((s) => isCountryExcluded(s, country));
```

(`country` đã có trong scope của `quote()` — biến đích upper-case sẵn dùng cho demand/country_fixed; xác nhận tên biến khi sửa.)

4. `rowContribution` case addon_fixed thêm điều kiện nước:

```ts
      case 'addon_fixed':
        return (s.applyMode ?? 'always') === 'always' && !isCountryExcluded(s, country)
          ? s.value : 0;
```

(Generic cho kind khác: KHÔNG sửa các case khác trong nhiệm vụ này — YAGNI, spec chỉ cần addon.)

5. `QuoteBreakdown` thêm `addonExcludedForCountry: boolean;` (sau `addonReference`), return thêm field (không round — boolean).

6. `load.ts` map thêm:

```ts
      excludedCountryCodes: Array.isArray(s.excludedCountryCodes)
        ? (s.excludedCountryCodes as string[]).map((c) => c.toUpperCase())
        : null,
```

- [ ] **Step 2.3:** vitest file pass; `npx vitest run` toàn suite xanh; tsc sạch (bổ sung field boolean cho consumer QuoteBreakdown nào kêu — máy móc, không đổi logic).

- [ ] **Step 2.4:** Commit:

```bash
git add features/carrier-rates/engine
git commit -m "feat(engine): surcharge miễn theo nước + cờ addonExcludedForCountry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Đối soát — verdict nước miễn (TDD)

**Files:**
- Modify: `features/shipments/reconcile-diagnose.ts`
- Modify: `features/shipments/reconcile.ts`
- Test: `features/shipments/reconcile-diagnose.test.ts` (describe addon_fixed hiện có)

- [ ] **Step 3.1: Test FAIL trước** — 2 case (pattern input của describe addon_fixed hiện có):

```ts
  // (a) FedEx SA: billed.signature = 92_700, engine.addons = 0,
  //     addonReference = 0, addonExcludedForCountry = true, shipCountry 'SA',
  //     fuel khớp → component signature cause 'KHONG_KHOP' (KHÔNG PHI_TUY_CHON)
  //     và verdict chứa 'nước được miễn (SA)'.
  // (b) regression: cùng input nhưng addonExcludedForCountry=false +
  //     addonReference=92_700 → vẫn PHI_TUY_CHON như hiện tại.
```

Run vitest file → (a) FAIL.

- [ ] **Step 3.2: Implement**

`reconcile-diagnose.ts`:
1. `DiagnoseInput.engine` thêm `addonExcludedForCountry?: boolean;`;
   `DiagnoseInput` thêm `shipCountry?: string;` (top-level, cạnh vatPercent).
2. Gate PHI_TUY_CHON hiện tại (nhánh signature) thêm điều kiện
   `&& !e.addonExcludedForCountry`:

```ts
  if (sigDelta > 0 && sigEngine === 0 && fuelComp && fuelComp.cause !== 'LECH_FUEL'
      && !e.addonExcludedForCountry
      && (sigRef === 0 || sigBilled === sigRef)) {
    sigCause = 'PHI_TUY_CHON';
  }
```

3. Verdict dominant-signature: nhánh nước miễn đặt TRƯỚC nhánh sai-bảng-giá:

```ts
    } else if (dominant.key === 'signature' && e.addonExcludedForCountry) {
      verdict = `FedEx thu Direct Signature ở nước được miễn (${input.shipCountry ?? '?'}) — khiếu nại với carrier`;
      severity = 'config';
    } else if (dominant.key === 'signature' && n0(e.addonReference ?? null) > 0
        && dominant.billed !== n0(e.addonReference ?? null)) {
```

`reconcile.ts`: engine map thêm `addonExcludedForCountry: q.breakdown.addonExcludedForCountry,`; lời gọi `diagnoseReconcileRow({...})` truyền `shipCountry: r.shipCountry,`.

- [ ] **Step 3.3:** vitest diagnose pass cả mới lẫn cũ; toàn suite xanh; tsc sạch. Commit:

```bash
git add features/shipments
git commit -m "feat(reconcile): flag Direct Signature thu ở nước miễn — verdict khiếu nại

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Data script + UI exclusions

**Files:**
- Create: `scripts/migrate-fedex-signature-rules.ts`
- Modify: `features/carrier-rates/surcharges-actions.ts`
- Modify: `components/carrier-rates/SurchargeEditDialog.tsx`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/surcharges/page.tsx`

- [ ] **Step 4.1: Script** (pattern `scripts/migrate-addon-signature.ts` — dry-run mặc định, --apply, idempotent, in account name, assert rowCount):

```ts
/** Migration MỘT LẦN (spec 2026-06-11 fedex-signature-country-exclusion):
 *  FedEx Direct Signature: 2 dòng → 3 dòng đúng mốc operator + 13 nước miễn.
 *    92.700 |        NULL → 2025-06-01
 *    88.000 |  2025-06-01 → 2026-01-01   (sửa từ ends 2026-01-05)
 *    92.700 |  2026-01-01 → NULL          (sửa từ starts 2026-01-05)
 *  DHL KHÔNG đụng. Idempotent: match theo (account, kind addon_fixed, note).
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';
const EXCLUDED = ['SA','QA','IL','IQ','OM','KZ','JO','MC','LU','CY','CZ','PE','AO'];

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const rows = await db.execute(sql`
    SELECT ca.name AS account, cs.id, cs.value::int, cs.apply_mode,
           cs.starts_at::date AS from_d, cs.ends_at::date AS to_d, cs.excluded_country_codes
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'addon_fixed'
      AND cs.note ILIKE '%Direct Signature%'
    ORDER BY cs.value, cs.starts_at NULLS FIRST`);
  console.table(rows.rows);
  const hasPreJune = rows.rows.some((r) => Number((r as { value: number }).value) === 92700
    && (r as { to_d: string | null }).to_d !== null);
  console.log(`Dòng hiện có: ${rows.rows.length} — pre-June row: ${hasPreJune ? 'CÓ' : 'CHƯA (sẽ insert)'}`);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  // (1) Sửa mốc 2 dòng hiện có + set excluded list
  const u88 = await db.execute(sql`
    UPDATE carrier_surcharges cs SET
      starts_at = '2025-06-01'::timestamp, ends_at = '2026-01-01'::timestamp,
      excluded_country_codes = ${JSON.stringify(EXCLUDED)}::jsonb,
      note = 'Direct Signature — 88k 01/06/2025→31/12/2025, miễn 13 nước (when_billed)'
    FROM carrier_accounts ca
    WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
      AND cs.kind = 'addon_fixed' AND cs.value = 88000`);
  const u927 = await db.execute(sql`
    UPDATE carrier_surcharges cs SET
      starts_at = '2026-01-01'::timestamp, ends_at = NULL,
      excluded_country_codes = ${JSON.stringify(EXCLUDED)}::jsonb,
      note = 'Direct Signature — 92.7k từ 01/01/2026, miễn 13 nước (when_billed)'
    FROM carrier_accounts ca
    WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
      AND cs.kind = 'addon_fixed' AND cs.value = 92700 AND cs.ends_at IS NULL`);
  if (Number(u88.rowCount ?? 0) !== 1 || Number(u927.rowCount ?? 0) !== 1) {
    throw new Error(`UPDATE lệch kỳ vọng: 88k=${u88.rowCount}, 92.7k=${u927.rowCount} (mỗi cái phải 1)`);
  }
  console.log('✓ Sửa mốc 2 dòng hiện có');
  // (2) Insert dòng pre-June nếu chưa có
  if (!hasPreJune) {
    const ins = await db.execute(sql`
      INSERT INTO carrier_surcharges
        (carrier_account_id, kind, value, fuelable, active, apply_mode, ends_at, excluded_country_codes, note)
      SELECT ca.id, 'addon_fixed', 92700, true, true, 'when_billed',
             '2025-06-01'::timestamp, ${JSON.stringify(EXCLUDED)}::jsonb,
             'Direct Signature — 92.7k đến trước 01/06/2025, miễn 13 nước (when_billed)'
      FROM carrier_accounts ca WHERE ca.name = ${FEDEX_ACCOUNT}`);
    if (Number(ins.rowCount ?? 0) !== 1) throw new Error(`Insert pre-June được ${ins.rowCount}/1`);
    console.log('✓ Insert dòng pre-June 92.7k');
  } else console.log('Dòng pre-June đã có — bỏ qua.');
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

LƯU Ý idempotency của UPDATE 92.7k: điều kiện `ends_at IS NULL` để lần chạy
lại không đụng dòng pre-June (ends 2025-06-01). Chạy lại toàn script: u88
match 1 (giá trị đã đúng — vô hại), u927 match 1 (dòng from-2026), insert skip.

- [ ] **Step 4.2: Chạy DRY-RUN** (`npx tsx scripts/migrate-fedex-signature-rules.ts`) — 2 dòng hiện có, pre-June CHƯA. KHÔNG --apply (Task 5).

- [ ] **Step 4.3: UI + actions**

`surcharges-actions.ts`:
- `SurchargeRow` + SELECT + map thêm `excludedCountryCodes` (y hệt pattern `countryCodes` dòng 15/40/62).
- `CreateSurchargeInput`/`UpdateSurchargeInput` thêm `excludedCountryCodes?: string;` — parse qua `parseCountryCodes` sẵn có (dòng 118), create/update persist (mirror dòng 136-147/188-189).

`SurchargeEditDialog.tsx`: trong block `kind === 'addon_fixed'` (sau select applyMode) thêm input mirror block countryCodes (dòng 159-176):

```tsx
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Nước miễn (ISO-2)
              </Label>
              <Input
                name="excludedCountryCodes"
                defaultValue={(defaultExcludedCountryCodes ?? []).join(', ')}
                placeholder="VD: SA, QA, IL — bỏ trống nếu áp dụng mọi nước"
                className="font-mono uppercase tracking-widest text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Phí KHÔNG áp dụng khi nước đích nằm trong danh sách này
                (FedEx miễn Direct Signature cho 13 nước).
              </p>
            </div>
```

(prop `defaultExcludedCountryCodes?: string[] | null` thêm vào Props; 2 chỗ dùng dialog trong page truyền `row.excludedCountryCodes` / undefined cho Add.)

`page.tsx`: createAction/updateAction đọc `excludedCountryCodes` từ formData khi kind addon_fixed (mirror applyMode); dòng addon trong section hiện text nhỏ khi có exclusions: `Miễn {n} nước` với `title={codes.join(', ')}` (n ≤ 3 thì in thẳng mã).

- [ ] **Step 4.4:** tsc + eslint files đổi + vitest xanh. Commit:

```bash
git add scripts features components app
git commit -m "feat(carrier-rates): script 3 mốc giá FedEx signature + UI nước miễn

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Apply + fleet verify + push

- [ ] **Step 5.1:** Dry-run lần cuối rồi `npx tsx scripts/migrate-fedex-signature-rules.ts --apply`.
- [ ] **Step 5.2:** Probe verify data: 3 dòng FedEx addon đúng mốc + excluded 13 nước; 2 dòng DHL nguyên trạng (không excluded).
- [ ] **Step 5.3:** Probe fleet (pattern probe-fleet cũ: `getReconcileCached(true)` in total/delta + per-carrier delta0 + severity):
Kỳ vọng so baseline (total delta 29.062.284đ; FedEx delta0=864, passthrough=101):
tổng tiền KHÔNG đổi; FedEx passthrough 101→99; config 262→264 (2 đơn SA/CZ chuyển nhóm);
DHL không đổi. In rõ 2 đơn bị flag (lọc verdict chứa 'nước được miễn') để báo operator.
- [ ] **Step 5.4:** `npx tsc --noEmit && npx vitest run && npx eslint .` sạch/xanh; `npx next build` pass.
- [ ] **Step 5.5:** `git push origin main`; sau deploy mở Đối soát `?refresh=1`.
