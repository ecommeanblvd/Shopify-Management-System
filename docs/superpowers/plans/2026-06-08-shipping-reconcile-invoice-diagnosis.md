# Invoice Diagnosis (per-dong) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho mỗi đơn trong module Đối soát phí ship, giải thích từng đồng lệch giữa hóa đơn carrier và giá engine, truy ngược cân nặng carrier đã tính, và đưa verdict nguyên nhân.

**Architecture:** Một hàm thuần `diagnoseReconcileRow()` (không DB, test được) chứa toàn bộ logic phân rã + phân loại + truy ngược cân. `reconcile.ts` build dữ liệu engine cần (bảng giá zone, %fuel/CK/VAT, chargeable weight, tier khớp) rồi gọi hàm này và gắn `diagnosis` vào mỗi `ReconcileRow`. `ReconcileDetailPanel.tsx` render banner verdict + dòng truy cân + tag nguyên nhân.

**Tech Stack:** TypeScript, Vitest, Drizzle, Next.js (app router fork), React/Tailwind.

**Spec:** [docs/superpowers/specs/2026-06-08-shipping-reconcile-invoice-diagnosis-design.md](../specs/2026-06-08-shipping-reconcile-invoice-diagnosis-design.md)

---

## File Structure

- `features/shipments/reconcile-diagnose.ts` — **create**: pure logic + types (`diagnoseReconcileRow`, `ReconcileDiagnosis`, `DiagnoseInput`).
- `features/shipments/reconcile-diagnose.test.ts` — **create**: unit tests (identity invariant + each cause).
- `features/carrier-rates/engine/quote.ts` — **modify**: ensure breakdown exposes `chargeableWeightKg`, matched `tierUpperKg`, `fuelPercent`, `discountPercent`, `vatPercent` (add only what's missing).
- `features/shipments/reconcile.ts` — **modify**: build `DiagnoseInput` per row, attach `diagnosis` to `ReconcileRow`.
- `components/shipping-reconcile/ReconcileDetailPanel.tsx` — **modify**: render diagnosis.

---

## Task 1: Pure diagnosis module + types (TDD)

This is the testable core. It takes plain numbers — no DB, no engine objects.

**Files:**
- Create: `features/shipments/reconcile-diagnose.ts`
- Test: `features/shipments/reconcile-diagnose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/shipments/reconcile-diagnose.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { diagnoseReconcileRow, type DiagnoseInput } from './reconcile-diagnose';

// FedEx Saudi Arabia ladder (gross list price per tier upperKg), abbreviated.
const SA_RATES = [
  { upperKg: 0.5, rate: 2_799_450 },
  { upperKg: 1.0, rate: 3_733_900 },
  { upperKg: 1.5, rate: 4_200_000 },   // engine tier for 1.5kg (illustrative)
  { upperKg: 2.0, rate: 5_598_900 },   // billed base maps here -> heavier weight
];

function baseInput(over: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    billed: { base: 4_200_000, discount: -2_100_000, fuel: 0, remote: 0,
              demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_100_000 },
    engine: { base: 4_200_000, discount: -2_100_000, fuel: 0, remote: 0,
              demand: 0, residential: 0, vat: 0, total: 2_100_000 },
    engineChargeableWeightKg: 1.5,
    engineTierUpperKg: 1.5,
    zoneRates: SA_RATES,
    billedFuelableBase: 4_200_000,
    fuelPercent: 0,
    discountPercent: 50,
    vatPercent: 0,
    ...over,
  };
}

describe('diagnoseReconcileRow — identity invariant', () => {
  it('Σ component deltas (incl. residual) === totalDelta, exact', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 5_598_900, discount: -2_816_292, fuel: 821_597, remote: 550_000,
                demand: 119_100, signature: 0, vat: 208_614, gogreen: 0, elevatedRisk: 0, total: 4_481_919 },
      engine: { base: 4_200_000, discount: -2_100_000, fuel: 513_811, remote: 0,
                demand: 119_100, residential: 0, vat: 139_991, total: 1_889_884 },
      billedFuelableBase: 5_598_900 + 550_000,
    }));
    const sum = d.components.reduce((a, c) => a + c.delta, 0);
    expect(sum).toBe(d.totalDelta);
    expect(d.totalDelta).toBe(4_481_919 - 1_889_884);
  });
});

describe('diagnoseReconcileRow — exact match', () => {
  it('totalDelta 0 -> verdict KHỚP TUYỆT ĐỐI, severity match', () => {
    const d = diagnoseReconcileRow(baseInput());
    expect(d.totalDelta).toBe(0);
    expect(d.severity).toBe('match');
    expect(d.verdict).toContain('KHỚP TUYỆT ĐỐI');
  });
});

describe('diagnoseReconcileRow — SAI_CAN', () => {
  it('billed base maps to a higher tier -> SAI_CAN with impliedWeight', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 5_598_900, discount: -2_799_450, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_799_450 },
    }));
    const base = d.components.find((c) => c.key === 'base')!;
    expect(base.cause).toBe('SAI_CAN');
    expect(d.severity).toBe('weight');
    expect(d.impliedWeight).not.toBeNull();
    expect(d.impliedWeight!.tierUpperKg).toBe(2.0);
    expect(d.impliedWeight!.rangeKg).toEqual([1.5, 2.0]);
    expect(d.impliedWeight!.engineChargeableKg).toBe(1.5);
  });
});

describe('diagnoseReconcileRow — THIEU_CAU_HINH_REMOTE', () => {
  it('billed remote > 0 while engine remote 0 -> config gap', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 4_200_000, discount: -2_100_000, fuel: 0, remote: 550_000,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_650_000 },
    }));
    const rem = d.components.find((c) => c.key === 'remote')!;
    expect(rem.cause).toBe('THIEU_CAU_HINH_REMOTE');
    expect(d.severity).toBe('config');
  });
});

describe('diagnoseReconcileRow — LECH_RATE_CARD', () => {
  it('billed base matches no tier -> rate card mismatch, impliedWeight null', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 4_999_999, discount: -2_499_999, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_500_000 },
    }));
    const base = d.components.find((c) => c.key === 'base')!;
    expect(base.cause).toBe('LECH_RATE_CARD');
    expect(d.impliedWeight).toBeNull();
    expect(d.severity).toBe('ratecard');
  });
});

describe('diagnoseReconcileRow — LECH_CHIET_KHAU', () => {
  it('discount percent differs -> discount mismatch', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 4_200_000, discount: -1_680_000, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_520_000 },
    }));
    const disc = d.components.find((c) => c.key === 'discount')!;
    expect(disc.cause).toBe('LECH_CHIET_KHAU');
    expect(d.severity).toBe('discount');
  });
});

describe('diagnoseReconcileRow — rounding residual', () => {
  it('a few-dong gap lands in residual with LAM_TRON', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 4_200_000, discount: -2_100_000, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_100_003 },
    }));
    const res = d.components.find((c) => c.key === 'residual')!;
    expect(res.delta).toBe(3);
    expect(res.cause).toBe('LAM_TRON');
    expect(d.severity).toBe('rounding');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run features/shipments/reconcile-diagnose.test.ts`
Expected: FAIL — cannot find module `./reconcile-diagnose`.

- [ ] **Step 3: Implement `reconcile-diagnose.ts`**

Create `features/shipments/reconcile-diagnose.ts`:

```typescript
/**
 * Pure invoice-diagnosis layer for ship-cost reconciliation.
 *
 * Decomposes the billed-vs-engine delta down to the dong, attributes each
 * dong to a cause, and reverse-engineers the weight tier the carrier billed
 * at. No DB / no engine objects — takes plain numbers so it is unit-testable.
 *
 * Zero tolerance: a row "matches" only when totalDelta === 0. Any residual
 * after explaining every component lands in an explicit `residual` line
 * (LAM_TRON), never hidden under a tolerance band. By construction:
 *   Σ components[].delta === totalDelta   (the reconciliation identity)
 */

export type DiagnosisCause =
  | 'KHOP'
  | 'SAI_CAN'
  | 'THIEU_CAU_HINH_REMOTE'
  | 'REMOTE_KHONG_KHOP'
  | 'LECH_RATE_CARD'
  | 'LECH_CHIET_KHAU'
  | 'LECH_FUEL'
  | 'PHAI_SINH'
  | 'KHONG_KHOP'
  | 'LAM_TRON';

export type DiagnosisSeverity =
  | 'match' | 'weight' | 'config' | 'ratecard' | 'discount' | 'rounding';

export type ComponentKey =
  | 'base' | 'discount' | 'fuel' | 'remote' | 'demand'
  | 'signature' | 'vat' | 'gogreen' | 'elevatedRisk' | 'residual';

export interface ComponentDelta {
  key: ComponentKey;
  billed: number;
  engine: number;
  delta: number;
  cause: DiagnosisCause;
}

export interface ImpliedWeight {
  tierUpperKg: number;
  rangeKg: [number, number];
  engineChargeableKg: number;
  deltaTiers: number;
}

export interface ReconcileDiagnosis {
  totalDelta: number;
  components: ComponentDelta[];
  impliedWeight: ImpliedWeight | null;
  verdict: string;
  severity: DiagnosisSeverity;
}

export interface DiagnoseInput {
  billed: {
    base: number | null; discount: number | null; fuel: number | null;
    remote: number | null; demand: number | null; signature: number | null;
    vat: number | null; gogreen: number | null; elevatedRisk: number | null;
    total: number;
  };
  engine: {
    base: number; discount: number; fuel: number; remote: number;
    demand: number; residential: number; vat: number; total: number;
  };
  engineChargeableWeightKg: number;
  engineTierUpperKg: number;
  /** Package-appropriate gross list rate ladder, ascending by upperKg. */
  zoneRates: Array<{ upperKg: number; rate: number }>;
  /** base + fuelable surcharges on the BILLED side (engine isFuelable rule). */
  billedFuelableBase: number;
  fuelPercent: number;
  discountPercent: number;
  vatPercent: number;
}

const r = (n: number): number => Math.round(n);
const n0 = (v: number | null): number => (v == null ? 0 : v);

/** Invert a billed gross base into a weight tier (exact list-rate match). */
function invertWeight(
  billedBase: number,
  zoneRates: Array<{ upperKg: number; rate: number }>,
  engineTierUpperKg: number,
  engineChargeableKg: number,
): { cause: 'SAI_CAN' | 'LECH_RATE_CARD'; implied: ImpliedWeight | null } {
  const idx = zoneRates.findIndex((z) => r(z.rate) === r(billedBase));
  if (idx < 0) return { cause: 'LECH_RATE_CARD', implied: null };
  const tier = zoneRates[idx];
  if (tier.upperKg <= engineTierUpperKg) {
    // Matched a tier but not heavier — treat the price gap as a card mismatch.
    return { cause: 'LECH_RATE_CARD', implied: null };
  }
  const prevUpper = idx > 0 ? zoneRates[idx - 1].upperKg : 0;
  const engineIdx = zoneRates.findIndex((z) => z.upperKg === engineTierUpperKg);
  const deltaTiers = engineIdx >= 0 ? idx - engineIdx : 1;
  return {
    cause: 'SAI_CAN',
    implied: {
      tierUpperKg: tier.upperKg,
      rangeKg: [prevUpper, tier.upperKg],
      engineChargeableKg,
      deltaTiers,
    },
  };
}

export function diagnoseReconcileRow(input: DiagnoseInput): ReconcileDiagnosis {
  const b = input.billed;
  const e = input.engine;
  const totalDelta = r(b.total - e.total);

  const components: ComponentDelta[] = [];
  let impliedWeight: ImpliedWeight | null = null;

  // base
  const baseBilled = n0(b.base);
  const baseDelta = r(baseBilled - e.base);
  let baseCause: DiagnosisCause = 'KHOP';
  if (baseDelta !== 0) {
    if (baseBilled === 0) {
      baseCause = 'KHONG_KHOP';
    } else {
      const inv = invertWeight(baseBilled, input.zoneRates, input.engineTierUpperKg, input.engineChargeableWeightKg);
      baseCause = inv.cause;
      impliedWeight = inv.implied;
    }
  }
  components.push({ key: 'base', billed: baseBilled, engine: e.base, delta: baseDelta, cause: baseCause });

  // discount
  const discBilled = n0(b.discount);
  const discDelta = r(discBilled - e.discount);
  let discCause: DiagnosisCause = 'KHOP';
  if (discDelta !== 0) {
    discCause = baseBilled > 0 ? 'LECH_CHIET_KHAU' : 'KHONG_KHOP';
  }
  components.push({ key: 'discount', billed: discBilled, engine: e.discount, delta: discDelta, cause: discCause });

  // remote
  const remBilled = n0(b.remote);
  const remDelta = r(remBilled - e.remote);
  let remCause: DiagnosisCause = 'KHOP';
  if (remDelta !== 0) {
    remCause = remBilled > 0 && e.remote === 0 ? 'THIEU_CAU_HINH_REMOTE' : 'REMOTE_KHONG_KHOP';
  }
  components.push({ key: 'remote', billed: remBilled, engine: e.remote, delta: remDelta, cause: remCause });

  // fuel
  const fuelBilled = n0(b.fuel);
  const fuelDelta = r(fuelBilled - e.fuel);
  let fuelCause: DiagnosisCause = 'KHOP';
  if (fuelDelta !== 0) {
    const impliedPct = input.billedFuelableBase > 0 ? (fuelBilled / input.billedFuelableBase) * 100 : null;
    const pctMatches = impliedPct != null && Math.abs(impliedPct - input.fuelPercent) < 0.05;
    fuelCause = pctMatches ? 'PHAI_SINH' : 'LECH_FUEL';
  }
  components.push({ key: 'fuel', billed: fuelBilled, engine: e.fuel, delta: fuelDelta, cause: fuelCause });

  // demand
  const demBilled = n0(b.demand);
  const demDelta = r(demBilled - e.demand);
  components.push({ key: 'demand', billed: demBilled, engine: e.demand, delta: demDelta, cause: demDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // signature  (engine side = residential)
  const sigBilled = n0(b.signature);
  const sigDelta = r(sigBilled - e.residential);
  components.push({ key: 'signature', billed: sigBilled, engine: e.residential, delta: sigDelta, cause: sigDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // vat
  const vatBilled = n0(b.vat);
  const vatDelta = r(vatBilled - e.vat);
  let vatCause: DiagnosisCause = 'KHOP';
  if (vatDelta !== 0) {
    // VAT is derived from the post-discount subtotal — treat as downstream.
    vatCause = 'PHAI_SINH';
  }
  components.push({ key: 'vat', billed: vatBilled, engine: e.vat, delta: vatDelta, cause: vatCause });

  // gogreen (engine has no gogreen line -> engine 0)
  const ggBilled = n0(b.gogreen);
  components.push({ key: 'gogreen', billed: ggBilled, engine: 0, delta: r(ggBilled), cause: ggBilled === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // elevatedRisk (engine has no line -> engine 0)
  const erBilled = n0(b.elevatedRisk);
  components.push({ key: 'elevatedRisk', billed: erBilled, engine: 0, delta: r(erBilled), cause: erBilled === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // residual = whatever is left so the identity holds exactly.
  const explained = components.reduce((a, c) => a + c.delta, 0);
  const residual = r(totalDelta - explained);
  components.push({ key: 'residual', billed: 0, engine: 0, delta: residual, cause: residual === 0 ? 'KHOP' : 'LAM_TRON' });

  // verdict — priority order
  const has = (cause: DiagnosisCause) => components.some((c) => c.cause === cause);
  let verdict: string;
  let severity: DiagnosisSeverity;
  if (totalDelta === 0) {
    verdict = 'KHỚP TUYỆT ĐỐI (0đ)';
    severity = 'match';
  } else if (has('SAI_CAN') && impliedWeight) {
    const [lo, hi] = impliedWeight.rangeKg;
    verdict = `Carrier tính ở mức cân cao hơn: ${lo}–${hi} kg (bậc ≤ ${hi} kg) vs hệ thống ${impliedWeight.engineChargeableKg} kg`;
    severity = 'weight';
  } else if (has('THIEU_CAU_HINH_REMOTE')) {
    verdict = 'Hệ thống thiếu cấu hình vùng xa cho nước này — cần bổ sung';
    severity = 'config';
  } else if (has('LECH_RATE_CARD')) {
    verdict = 'Bảng giá hệ thống khác hóa đơn — cần cập nhật rate card';
    severity = 'ratecard';
  } else if (has('LECH_CHIET_KHAU')) {
    verdict = 'Chiết khấu hợp đồng không khớp';
    severity = 'discount';
  } else {
    verdict = `Chỉ lệch do làm tròn (${residual}đ)`;
    severity = 'rounding';
  }

  return { totalDelta, components, impliedWeight, verdict, severity };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run features/shipments/reconcile-diagnose.test.ts`
Expected: PASS (all cases, including the identity invariant).

- [ ] **Step 5: Commit**

```bash
git add features/shipments/reconcile-diagnose.ts features/shipments/reconcile-diagnose.test.ts
git commit -m "feat(reconcile): pure per-dong invoice diagnosis"
```

---

## Task 2: Expose engine internals needed for diagnosis

The diagnosis needs, per quoted row: `chargeableWeightKg`, the matched tier `upperKg`, the package-appropriate zone rate ladder, and `fuelPercent` / `discountPercent` / `vatPercent`. Some may already be on the breakdown.

**Files:**
- Modify: `features/carrier-rates/engine/quote.ts`

- [ ] **Step 1: Read what the breakdown already exposes**

Read `features/carrier-rates/engine/quote.ts` from the `QuoteBreakdown` interface (around line 186) through the end of `quote()` (around line 641). Confirm whether each of these is already present on the returned breakdown:
`chargeableWeightKg`, the matched tier object or its `upperKg`, `fuelPercent`, `discountPercent`, `vatPercent`.

- [ ] **Step 2: Add only the missing fields to `QuoteBreakdown`**

For each field NOT already present, add it to the `QuoteBreakdown` interface and set it in the object `quote()` returns. Use the variables already computed inside `quote()` (the chargeable weight, the matched tier, and the percent values are all already calculated for the math — just surface them). Do not change any existing arithmetic.

Example shape (only add the ones missing):

```typescript
export interface QuoteBreakdown {
  // ...existing fields unchanged...
  chargeableWeightKg: number;
  matchedTierUpperKg: number;
  fuelPercent: number;
  discountPercent: number;
  vatPercent: number;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (existing call sites unaffected — fields are additive).

- [ ] **Step 4: Commit**

```bash
git add features/carrier-rates/engine/quote.ts
git commit -m "feat(engine): expose chargeable weight, matched tier, and percents on quote breakdown"
```

---

## Task 3: Build the zone rate ladder + wire diagnosis into reconcile.ts

`reconcile.ts` already has `snap` (the account snapshot) and the resolved zone in scope when it calls `quote()`. Build the package-appropriate rate ladder from the zone and call `diagnoseReconcileRow`.

**Files:**
- Modify: `features/shipments/reconcile.ts`

- [ ] **Step 1: Add `diagnosis` to the `ReconcileRow` interface**

In `features/shipments/reconcile.ts`, add to `export interface ReconcileRow` (after `deltaPct`):

```typescript
  diagnosis: import('./reconcile-diagnose').ReconcileDiagnosis | null;
```

- [ ] **Step 2: Build the rate ladder + diagnosis where the row is built**

In the loop in `reconcileShipments()`, after the successful `quote()` (where `q.ok` is true, near `sumEngine += q.breakdown.carrierCost`), resolve the zone for `r.shipCountry` from `snap` (use the same zone-resolution the engine uses — `snap.zonesByCountry.get(r.shipCountry)`), then build the ascending ladder. Pick the package-appropriate map exactly as `quote()` did (Pak vs Package): if the engine used the Pak rate for this row, use `pakRateByTierUpper`, else `rateByTierUpper`; fall back to `rateByTierUpper` when a tier is absent from the Pak map.

```typescript
const zone = snap.zonesByCountry.get(r.shipCountry);
const tiers = snap.weightTiers; // sorted ascending by upperKg
const zoneRates = zone
  ? tiers
      .map((t) => {
        const rate = (zone.pakRateByTierUpper?.get(t.upperKg) ?? zone.rateByTierUpper.get(t.upperKg));
        return rate != null ? { upperKg: t.upperKg, rate } : null;
      })
      .filter((x): x is { upperKg: number; rate: number } => x !== null)
  : [];

const billedFuelableBase = Number(r.billedBase ?? 0) + Number(r.billedRemote ?? 0); // remote_fixed is fuelable by default
const diagnosis = diagnoseReconcileRow({
  billed: {
    base: r.billedBase != null ? Number(r.billedBase) : null,
    discount: r.billedDiscount != null ? Number(r.billedDiscount) : null,
    fuel: r.billedFuel != null ? Number(r.billedFuel) : null,
    remote: r.billedRemote != null ? Number(r.billedRemote) : null,
    demand: r.billedDemand != null ? Number(r.billedDemand) : null,
    signature: r.billedSignature != null ? Number(r.billedSignature) : null,
    vat: r.billedVat != null ? Number(r.billedVat) : null,
    gogreen: r.billedGogreen != null ? Number(r.billedGogreen) : null,
    elevatedRisk: null,
    total: Number(r.billedTotal),
  },
  engine: {
    base: q.breakdown.base,
    discount: q.breakdown.discount,
    fuel: q.breakdown.fuel,
    remote: q.breakdown.remote,
    demand: q.breakdown.demand,
    residential: q.breakdown.residential,
    vat: q.breakdown.vat,
    total: q.breakdown.carrierCost,
  },
  engineChargeableWeightKg: q.breakdown.chargeableWeightKg,
  engineTierUpperKg: q.breakdown.matchedTierUpperKg,
  zoneRates,
  billedFuelableBase,
  fuelPercent: q.breakdown.fuelPercent,
  discountPercent: q.breakdown.discountPercent,
  vatPercent: q.breakdown.vatPercent,
});
```

Then pass `diagnosis` into `buildRow` — add a parameter to `buildRow` and set `diagnosis` on the returned object. For unmatched rows (every `buildRow(r, null, ...)` call), pass `null`.

- [ ] **Step 3: Update `buildRow` signature + default**

Change `buildRow` to accept `diagnosis: ReconcileDiagnosis | null = null` and include `diagnosis` in the returned object. Confirm the import at the top: `import { diagnoseReconcileRow, type ReconcileDiagnosis } from './reconcile-diagnose';`

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `snap.zonesByCountry`, `snap.weightTiers`, `zone.rateByTierUpper`, or `zone.pakRateByTierUpper` have different names, read `features/carrier-rates/engine/load.ts` (the `CarrierAccountSnapshot` / `ZoneSnap` types) and use the actual names.

- [ ] **Step 5: Verify against the real DB (sanity, not a unit test)**

Create `/tmp/diag.ts`:

```typescript
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';
async function main() {
  const { rows } = await reconcileShipmentsWithStatus({ carrierKey: 'fedex' });
  const row = rows.find((r) => r.orderNumber === '#MBLVD28314');
  if (!row) { console.log('order not found'); process.exit(0); }
  console.log('verdict:', row.diagnosis?.verdict, '| severity:', row.diagnosis?.severity);
  console.log('impliedWeight:', row.diagnosis?.impliedWeight);
  const sum = (row.diagnosis?.components ?? []).reduce((a, c) => a + c.delta, 0);
  console.log('identity holds:', sum === row.diagnosis?.totalDelta, '(sum', sum, 'totalDelta', row.diagnosis?.totalDelta, ')');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx tsx -r tsconfig-paths/register /tmp/diag.ts`
Expected: a verdict prints and `identity holds: true`. Then `rm /tmp/diag.ts`.

- [ ] **Step 6: Commit**

```bash
git add features/shipments/reconcile.ts
git commit -m "feat(reconcile): attach per-dong diagnosis to each row"
```

---

## Task 4: Render diagnosis in the detail panel

**Files:**
- Modify: `components/shipping-reconcile/ReconcileDetailPanel.tsx`

- [ ] **Step 1: Add a verdict banner + implied-weight line + per-component cause tags**

In `components/shipping-reconcile/ReconcileDetailPanel.tsx`, above the existing breakdown `<table>`, render the diagnosis when present. Add this block at the top of the returned JSX (inside the `engineTotal !== null` branch):

```tsx
{row.diagnosis && (
  <div className="mb-4 space-y-2">
    <div className={`rounded-md px-3 py-2 text-sm font-medium ${severityClass(row.diagnosis.severity)}`}>
      {row.diagnosis.verdict}
    </div>
    {row.diagnosis.impliedWeight && (
      <p className="text-xs text-muted-foreground">
        Truy ngược: carrier tính như thể{' '}
        <span className="font-semibold">
          {row.diagnosis.impliedWeight.rangeKg[0]}–{row.diagnosis.impliedWeight.rangeKg[1]} kg
        </span>{' '}
        (bậc ≤ {row.diagnosis.impliedWeight.tierUpperKg} kg), hệ thống dùng{' '}
        <span className="font-semibold">{row.diagnosis.impliedWeight.engineChargeableKg} kg</span>
        {row.diagnosis.impliedWeight.deltaTiers > 0 ? ` — lệch ${row.diagnosis.impliedWeight.deltaTiers} bậc` : ''}.
      </p>
    )}
  </div>
)}
```

Add these helpers near `fmtVnd` (top of file):

```tsx
const CAUSE_LABEL: Record<string, string> = {
  KHOP: '', SAI_CAN: 'sai cân', THIEU_CAU_HINH_REMOTE: 'thiếu cấu hình vùng xa',
  REMOTE_KHONG_KHOP: 'remote không khớp', LECH_RATE_CARD: 'lệch rate card',
  LECH_CHIET_KHAU: 'lệch chiết khấu', LECH_FUEL: 'lệch % fuel',
  PHAI_SINH: 'phái sinh', KHONG_KHOP: 'không khớp', LAM_TRON: 'làm tròn',
};

function severityClass(s: string): string {
  switch (s) {
    case 'match': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'weight': return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'config': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'ratecard': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'discount': return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    default: return 'bg-muted text-muted-foreground';
  }
}
```

- [ ] **Step 2: Show the cause tag on each component row of the existing table**

The existing `lines(row)` table maps fixed labels. Add a 5th cell that looks up the matching component's cause by key. Map each display line to a diagnosis component key: base→`base`, fuel→`fuel`, remote→`remote`, demand→`demand`, signature→`signature`, vat→`vat`. In the `lines()` return, add a `compKey` to each entry, then in the row render add:

```tsx
<td className="py-1 text-right font-sans text-[11px] text-muted-foreground">
  {(() => {
    const c = row.diagnosis?.components.find((x) => x.key === l.compKey);
    return c && c.cause !== 'KHOP' ? CAUSE_LABEL[c.cause] : '';
  })()}
</td>
```

Add the matching empty `<th></th>` to the table head so columns align.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the browser (authed)**

Start dev server: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx next dev`. Load `/f/shipping-reconcile`, expand `#MBLVD28314`. Expected: a red "Carrier tính ở mức cân cao hơn…" banner, the implied-weight line, and cause tags ("thiếu cấu hình vùng xa" on remote, etc.).

- [ ] **Step 5: Commit**

```bash
git add components/shipping-reconcile/ReconcileDetailPanel.tsx
git commit -m "feat(reconcile): show invoice diagnosis in detail panel"
```

---

## Task 5: Full verification

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint (CI gate — errors fail CI)**

Run: `npm run lint`
Expected: 0 errors (warnings OK). Fix any `react/no-unescaped-entities` from new Vietnamese strings by using `{'...'}` or `&quot;`.

- [ ] **Step 3: Tests**

Run: `npx vitest run features/shipments`
Expected: all PASS (diagnosis + existing reconcile-view tests).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A && git commit -m "chore(reconcile): diagnosis verification cleanup" || echo "nothing to commit"
```
