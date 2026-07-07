# Ship-hộ FedEx: Residential (Pha 1) + Direct Signature opt-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate ship-hộ FedEx tính đúng phí Residential (mặc định US/CA — Pha 1) và cho phép brand chọn Direct Signature (opt-in, gate theo nước), trong khi giữ nguyên hành vi "nội bộ luôn tính DS".

**Architecture:** Cắm 2 cờ có sẵn của engine (`isResidential`, `signatureOptIn`) vào các caller `quote()`. Đổi 1 dòng data DS từ `always`→`when_billed` rồi mỗi caller tự quyết cờ theo ngữ cảnh: nội bộ `true` (gate theo nước), ship-hộ theo lựa chọn brand. KHÔNG sửa engine. FedEx Address Validation API (residential chính xác từng địa chỉ) là **Pha 2**, chỉ viết contract, KHÔNG code ở plan này.

**Tech Stack:** TypeScript, Next.js, Drizzle (Postgres), vitest, engine thuần `features/carrier-rates/engine/quote.ts`.

## Global Constraints

- KHÔNG sửa `features/carrier-rates/engine/quote.ts` — 2 cờ `isResidential`/`signatureOptIn` đã đủ.
- Đổi DS `always`→`when_billed`: MỌI caller nội bộ phải truyền `signatureOptIn=true` (gate theo nước) để KHÔNG rớt DS nội bộ. `features/shipments/reconcile.ts` đã tự suy từ bill (`signatureOptIn: Number(r.billedSignature ?? 0) > 0`) — KHÔNG đụng.
- Phí residential giữ scope **US/CA** (theo `residential_fixed.country_codes`). Pha 1 mặc định `isResidential = country ∈ {US,CA}` — khớp `features/carrier-rates/checkout-rates.ts:32` và `push/recalc.ts:152` đã làm.
- DS fee = 92.700₫; nước có DS = allowlist tĩnh `FEDEX_DIRECT_SIGNATURE_COUNTRIES` (operator review được).
- Trước mỗi push: `npx tsc --noEmit` + `npx vitest run` phải xanh (quy tắc repo). Đổi data DS trên prod qua `railway run` + verify.

## File Structure

- Create `features/carrier-rates/residential-default.ts` — helper `isDefaultResidential(country)` (DRY, dùng ở brand-estimate; giữ inline cũ ở checkout-rates để YAGNI).
- Create `features/carrier-rates/direct-signature.ts` — `FEDEX_DIRECT_SIGNATURE_COUNTRIES` + `countrySupportsDirectSignature(iso)` + `DIRECT_SIGNATURE_FEE_VND`.
- Create `scripts/set-fedex-ds-when-billed.ts` — đổi dòng DS `always`→`when_billed` (idempotent, --apply).
- Modify `features/ship-ho/brand-estimate.ts` — thêm `isResidential` (default) + `signatureOptIn` (từ parcel.directSignature) + note; `EstimateParcel` thêm `directSignature?`; `BrandEstimate` thêm `directSignatureAvailable`/`directSignatureFeeVnd`.
- Modify `features/ship-ho/quote-adapter.ts` — `quoteShipHoOrder` nhận + truyền `signatureOptIn`.
- Modify các caller nội bộ (truyền `signatureOptIn = countrySupportsDirectSignature(country)`):
  `features/carrier-rates/checkout-rates.ts`, `features/carrier-rates/push/recalc.ts`,
  `features/shopify-orders/sync/resolve-shipping-estimate.ts`,
  `features/shopify-orders/sync/batch-shipping-estimator.ts`,
  `features/carrier-rates/compare/build-comparison.ts`.
- Modify `docs/mmp-outbound-integration.md` (hoặc doc contract MMP hiện có) — thêm contract Pha 2 (street) + directSignature.
- Tests: `residential-default.test.ts`, `direct-signature.test.ts`, mở rộng `brand-estimate` test.

---

### Task 1: Residential mặc định US/CA cho estimate ship-hộ (Pha 1 — sửa lỗi thiếu phí)

**Files:**
- Create: `features/carrier-rates/residential-default.ts`
- Create: `features/carrier-rates/residential-default.test.ts`
- Modify: `features/ship-ho/brand-estimate.ts` (quote call ~dòng 69; notes)

**Interfaces:**
- Produces: `isDefaultResidential(country: string): boolean` — true khi ISO-2 ∈ {US, CA}.

- [ ] **Step 1: Test cho helper**

```ts
// features/carrier-rates/residential-default.test.ts
import { describe, it, expect } from 'vitest';
import { isDefaultResidential } from './residential-default';

describe('isDefaultResidential', () => {
  it('true cho US và CA (nơi FedEx có phí residential)', () => {
    expect(isDefaultResidential('US')).toBe(true);
    expect(isDefaultResidential('CA')).toBe(true);
    expect(isDefaultResidential('us')).toBe(true); // case-insensitive
  });
  it('false cho nước khác', () => {
    expect(isDefaultResidential('GB')).toBe(false);
    expect(isDefaultResidential('VN')).toBe(false);
    expect(isDefaultResidential('')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test → FAIL** (`npx vitest run features/carrier-rates/residential-default.test.ts`) — "Cannot find module './residential-default'".

- [ ] **Step 3: Implement helper**

```ts
// features/carrier-rates/residential-default.ts
/**
 * Nước áp phí residential FedEx (theo residential_fixed.country_codes = US/CA).
 * Pha 1: mặc định coi đơn tới US/CA là nhà dân (67–85% đơn US/CA là residential —
 * khớp checkout-rates.ts:32 & push/recalc.ts:152). Pha 2 (FedEx Address Validation)
 * sẽ chính xác từng địa chỉ khi MMP gửi street.
 */
export const RESIDENTIAL_DEFAULT_COUNTRIES = ['US', 'CA'] as const;

export function isDefaultResidential(country: string): boolean {
  return (RESIDENTIAL_DEFAULT_COUNTRIES as readonly string[]).includes(country.trim().toUpperCase());
}
```

- [ ] **Step 4: Chạy test → PASS.**

- [ ] **Step 5: Dùng trong brand-estimate.** Ở `features/ship-ho/brand-estimate.ts`:
  - Thêm import: `import { isDefaultResidential } from '@/features/carrier-rates/residential-default';`
  - Trong lệnh `quote(snap, { ... })` (hiện dòng ~69), thêm field: `isResidential: isDefaultResidential(country),`
  - Sau khi có `res.breakdown`, thêm note khi residential>0. Sửa hàm `neutralNotes()` → nhận cờ, hoặc thêm sau khi build lines:
    ```ts
    const notes = neutralNotes();
    if (res.breakdown.residential > 0) {
      notes.push('Địa chỉ nhà dân (US/CA) — đã gồm phụ phí giao nhà dân của hãng.');
    }
    ```
    và trả `notes` này thay cho `neutralNotes()` trong object estimate.

- [ ] **Step 6: Test brand-estimate US residential.** Trong `features/ship-ho/brand-estimate.test.ts` (nếu chưa có, tạo — mock partner active + snapshot FedEx), thêm case: parcel country 'US' weight 1 → estimate.lines "Phụ phí vùng/địa chỉ" > phiên bản không-residential đúng bằng `84400 × factor` chênh lệch, và notes chứa 'nhà dân'. (Nếu test brand-estimate cần DB/snapshot thật khó mock, thay bằng test thuần: gọi `quote()` với isDefaultResidential('US') và assert breakdown.residential=84400 — đã có fixture FedEx trong repo.)

- [ ] **Step 7: tsc + full vitest xanh, commit.**

```bash
npx tsc --noEmit && npx vitest run
git add features/carrier-rates/residential-default.ts features/carrier-rates/residential-default.test.ts features/ship-ho/brand-estimate.ts features/ship-ho/brand-estimate.test.ts
git commit -m "fix(ship-ho): estimate mặc định US/CA=residential (Pha 1) — sửa thiếu phí giao nhà dân"
```

---

### Task 2: Config nước có Direct Signature

**Files:**
- Create: `features/carrier-rates/direct-signature.ts`
- Create: `features/carrier-rates/direct-signature.test.ts`

**Interfaces:**
- Produces: `countrySupportsDirectSignature(iso: string): boolean`; `DIRECT_SIGNATURE_FEE_VND = 92700`; `FEDEX_DIRECT_SIGNATURE_COUNTRIES: string[]`.

- [ ] **Step 1: Test**

```ts
// features/carrier-rates/direct-signature.test.ts
import { describe, it, expect } from 'vitest';
import { countrySupportsDirectSignature, FEDEX_DIRECT_SIGNATURE_COUNTRIES, DIRECT_SIGNATURE_FEE_VND } from './direct-signature';

describe('direct-signature config', () => {
  it('fee = 92.700đ', () => expect(DIRECT_SIGNATURE_FEE_VND).toBe(92700));
  it('US/GB/DE/AU/JP có DS', () => {
    for (const c of ['US', 'GB', 'DE', 'AU', 'JP']) expect(countrySupportsDirectSignature(c)).toBe(true);
  });
  it('case-insensitive + nước không có DS → false', () => {
    expect(countrySupportsDirectSignature('us')).toBe(true);
    expect(countrySupportsDirectSignature('VN')).toBe(false); // origin, không phải đích DS
    expect(countrySupportsDirectSignature('')).toBe(false);
  });
  it('list không rỗng và toàn ISO-2 upper', () => {
    expect(FEDEX_DIRECT_SIGNATURE_COUNTRIES.length).toBeGreaterThan(20);
    for (const c of FEDEX_DIRECT_SIGNATURE_COUNTRIES) expect(c).toMatch(/^[A-Z]{2}$/);
  });
});
```

- [ ] **Step 2: Chạy test → FAIL.**

- [ ] **Step 3: Implement.** Seed allowlist từ thị trường shop ship + nước FedEx phổ biến có Signature Options (operator review sau). ISO-2 upper.

```ts
// features/carrier-rates/direct-signature.ts
/**
 * Nước FedEx nhận Direct Signature Service. FedEx không công bố list máy-đọc
 * ("60+ nước, tự cập nhật") → allowlist tĩnh seed từ thị trường shop đang ship +
 * nước lớn có Signature Options; operator sửa 1 dòng khi cần.
 */
export const DIRECT_SIGNATURE_FEE_VND = 92700;

export const FEDEX_DIRECT_SIGNATURE_COUNTRIES: string[] = [
  'US', 'CA', 'MX',
  'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'AT', 'CH', 'IT', 'ES', 'PT',
  'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'HU', 'RO', 'GR',
  'AU', 'NZ', 'JP', 'KR', 'SG', 'HK', 'TW', 'MY', 'TH', 'PH', 'ID', 'IN', 'CN', 'VN',
  'AE', 'SA', 'IL', 'ZA', 'BR',
];

const SET = new Set(FEDEX_DIRECT_SIGNATURE_COUNTRIES);
export function countrySupportsDirectSignature(iso: string): boolean {
  return SET.has(iso.trim().toUpperCase());
}
```

> **Lưu ý reviewer:** 'VN' trong list là để hỗ trợ tuyến inbound (đích VN) — với export ship-hộ (đích nước ngoài) không ảnh hưởng. Operator xác nhận danh sách khi review.

- [ ] **Step 4: Chạy test → PASS.**

- [ ] **Step 5: tsc + vitest, commit.**

```bash
npx tsc --noEmit && npx vitest run
git add features/carrier-rates/direct-signature.ts features/carrier-rates/direct-signature.test.ts
git commit -m "feat(carrier-rates): config nước FedEx có Direct Signature + fee 92.700"
```

---

### Task 3: Đổi dòng DS `always`→`when_billed` trên DB (script + verify prod)

**Files:**
- Create: `scripts/set-fedex-ds-when-billed.ts`

**Interfaces:**
- Consumes: DB `carrier_surcharges` (dòng `addon_fixed` note LIKE 'Direct Signature — always%').

- [ ] **Step 1: Viết script idempotent (dry-run mặc định, --apply ghi).**

```ts
// scripts/set-fedex-ds-when-billed.ts
import 'dotenv/config';
import { and, eq, like } from 'drizzle-orm';
import { db, schema } from '@/db/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const [acc] = await db.select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, 'fedex'), eq(schema.carrierAccounts.enabled, true)))
    .limit(1);
  if (!acc) throw new Error('no FedEx account');
  const rows = await db.select({ id: schema.carrierSurcharges.id, applyMode: schema.carrierSurcharges.applyMode, note: schema.carrierSurcharges.note })
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, acc.id),
      eq(schema.carrierSurcharges.kind, 'addon_fixed'),
      like(schema.carrierSurcharges.note, 'Direct Signature — always%'),
    ));
  console.log(`Tìm ${rows.length} dòng DS 'always':`, rows.map((r) => r.note?.slice(0, 40)));
  if (!apply) { console.log('DRY-RUN — chạy lại với --apply.'); return; }
  for (const r of rows) {
    await db.update(schema.carrierSurcharges).set({ applyMode: 'when_billed' }).where(eq(schema.carrierSurcharges.id, r.id));
  }
  console.log(`✓ Đổi ${rows.length} dòng → when_billed.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run prod** — `railway run npx tsx scripts/set-fedex-ds-when-billed.ts` → xác nhận đúng 1 dòng ('always từ 03/06/2026').

- [ ] **Step 3: LƯU Ý THỨ TỰ** — chỉ chạy `--apply` SAU khi Task 4 (callers nội bộ) đã deploy, nếu không estimate nội bộ rớt DS giữa chừng. (Trong subagent-driven: đánh dấu Task 3 apply là bước cuối, sau Task 4.) Ở bước này chỉ commit script.

```bash
git add scripts/set-fedex-ds-when-billed.ts
git commit -m "chore(carrier-rates): script đổi DS FedEx always→when_billed (chưa apply)"
```

---

### Task 4: Callers nội bộ truyền `signatureOptIn=true` (gate theo nước)

**Files:**
- Modify: `features/carrier-rates/checkout-rates.ts` (quote ~dòng 36)
- Modify: `features/carrier-rates/push/recalc.ts` (quote ~dòng 149; biến nước = `representative`)
- Modify: `features/shopify-orders/sync/resolve-shipping-estimate.ts` (quote ~dòng 177; biến = `country`)
- Modify: `features/shopify-orders/sync/batch-shipping-estimator.ts` (quote ~dòng 172; biến = `country`)
- Modify: `features/carrier-rates/compare/build-comparison.ts` (quote ~dòng 69; biến = `country`)

**Interfaces:**
- Consumes: `countrySupportsDirectSignature` (Task 2).

- [ ] **Step 1: Mỗi file** — import `countrySupportsDirectSignature` và thêm field `signatureOptIn` vào object truyền cho `quote(...)`:
  - checkout-rates.ts: `signatureOptIn: countrySupportsDirectSignature(args.country),`
  - push/recalc.ts: `signatureOptIn: countrySupportsDirectSignature(representative),`
  - resolve-shipping-estimate.ts: `signatureOptIn: countrySupportsDirectSignature(country),`
  - batch-shipping-estimator.ts: `signatureOptIn: countrySupportsDirectSignature(country),`
  - build-comparison.ts: `signatureOptIn: countrySupportsDirectSignature(country),`

- [ ] **Step 2: Test hồi quy** — với FedEx US, quote có `signatureOptIn=true` → `breakdown.addons` gồm 92.700 (DS). Thêm 1 test thuần ở `features/carrier-rates/direct-signature.test.ts` hoặc test engine: `quote(fedexSnap, { destinationCountry:'US', weightKg:1, signatureOptIn:true })` → `breakdown.addons` chứa DS; `signatureOptIn:false` → không. (Chỉ có tác dụng SAU khi DS = when_billed; test này khoá hành vi mong đợi để Task 3 apply an toàn.)

- [ ] **Step 3: tsc + full vitest xanh, commit.**

```bash
npx tsc --noEmit && npx vitest run
git add features/carrier-rates/checkout-rates.ts features/carrier-rates/push/recalc.ts features/shopify-orders/sync/resolve-shipping-estimate.ts features/shopify-orders/sync/batch-shipping-estimator.ts features/carrier-rates/compare/build-comparison.ts
git commit -m "feat(carrier-rates): callers nội bộ truyền signatureOptIn=true (gate nước) — giữ DS nội bộ khi DS→when_billed"
```

---

### Task 5: Ship-hộ opt-in DS (brand-estimate + quote-adapter + contract fields)

**Files:**
- Modify: `features/ship-ho/brand-estimate.ts` (EstimateParcel, BrandEstimate, quote call, response)
- Modify: `features/ship-ho/quote-adapter.ts` (`quoteShipHoOrder` passthrough)

**Interfaces:**
- Consumes: `countrySupportsDirectSignature`, `DIRECT_SIGNATURE_FEE_VND` (Task 2).
- Produces: `EstimateParcel.directSignature?: boolean`; `BrandEstimate.directSignatureAvailable: boolean`; `BrandEstimate.directSignatureFeeVnd: number`.

- [ ] **Step 1: brand-estimate.ts**
  - `EstimateParcel` thêm: `directSignature?: boolean;`
  - `BrandEstimate` thêm: `directSignatureAvailable: boolean; directSignatureFeeVnd: number;`
  - Trong `quote(snap, { ... })` thêm: `signatureOptIn: (parcel.directSignature ?? false) && countrySupportsDirectSignature(country),`
  - Return estimate thêm: `directSignatureAvailable: countrySupportsDirectSignature(country), directSignatureFeeVnd: DIRECT_SIGNATURE_FEE_VND,`
  - import Task 2.

- [ ] **Step 2: quote-adapter.ts** — `ShipHoQuoteInput` thêm `signatureOptIn?: boolean;`; trong `quote(snap, {...})` thêm `signatureOptIn: input.signatureOptIn ?? false,`. (Đơn ship-hộ thật lấy từ lựa chọn brand lưu trên order — nơi tạo order truyền vào; mặc định false.)

- [ ] **Step 3: Test brand-estimate DS** — parcel US directSignature=true → estimate có DS trong "Phụ phí vùng/địa chỉ" + `directSignatureAvailable=true`; directSignature=false → không có DS. parcel nước không hỗ trợ (vd 'CD') directSignature=true → `directSignatureAvailable=false` và KHÔNG cộng DS.

- [ ] **Step 4: tsc + full vitest xanh, commit.**

```bash
npx tsc --noEmit && npx vitest run
git add features/ship-ho/brand-estimate.ts features/ship-ho/quote-adapter.ts
git commit -m "feat(ship-ho): Direct Signature opt-in cho estimate + order ship-hộ (gate theo nước)"
```

---

### Task 6: Apply DS→when_billed trên prod + verify + contract doc MMP

**Files:**
- Modify: doc contract MMP (`docs/mmp-outbound-integration.md` hoặc doc tương đương)

- [ ] **Step 1: Deploy Task 1–5** (push main, chờ Railway SUCCESS) — callers nội bộ đã truyền signatureOptIn=true TRƯỚC khi apply DS.

- [ ] **Step 2: Apply** — `railway run npx tsx scripts/set-fedex-ds-when-billed.ts --apply` → xác nhận đổi 1 dòng.

- [ ] **Step 3: Verify prod** — reproduce quote FedEx US weight 1:
  - internal (signatureOptIn=true): breakdown.addons chứa 92.700.
  - ship-hộ estimate không chọn DS: KHÔNG có 92.700; chọn DS: có.
  - residential (US): breakdown.residential=84.400.

- [ ] **Step 4: Contract doc MMP** — thêm mục:
  - Request `parcel` thêm optional `directSignature: boolean` (brand chọn ký nhận) và (Pha 2) `streetLines: string[]`, `stateOrProvinceCode?: string` để SMS gọi FedEx Address Validation.
  - Response `estimate` thêm `directSignatureAvailable: boolean`, `directSignatureFeeVnd: number` — MMP chỉ hiện toggle DS khi `directSignatureAvailable=true`.
  - Ghi rõ: Pha 1 residential mặc định US/CA=nhà dân; Pha 2 (chính xác từng địa chỉ) bật khi MMP gửi `streetLines`.

- [ ] **Step 5: Commit doc.**

```bash
git add docs/mmp-outbound-integration.md
git commit -m "docs(mmp): contract directSignature + street cho residential Pha 2"
```

---

## Self-Review

- **Spec coverage:** B Pha 1 (Task 1) ✓; DS opt-in nội bộ/ship-hộ + gate nước (Task 2,4,5) ✓; DS data (Task 3,6) ✓; contract MMP + Pha 2 note (Task 6) ✓. FedEx API module (Pha 2) CHỦ Ý hoãn theo lựa chọn CEO — ghi ở contract.
- **Thứ tự an toàn:** callers nội bộ (Task 4) deploy TRƯỚC khi apply DS→when_billed (Task 6 step 2) — nếu không nội bộ rớt DS. Đã ghi rõ ở Task 3 step 3 + Task 6 step 1-2.
- **Type consistency:** `countrySupportsDirectSignature`/`isDefaultResidential`/`DIRECT_SIGNATURE_FEE_VND` dùng nhất quán mọi task; `EstimateParcel.directSignature`, `BrandEstimate.directSignatureAvailable/FeeVnd` khớp giữa Task 5 & 6.
- **Rủi ro:** Task 4 sót caller → nội bộ rớt DS. Giảm thiểu: test hồi quy Task 4 step 2 + verify prod Task 6 step 3.
