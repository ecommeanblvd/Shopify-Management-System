import { describe, expect, it } from 'vitest';
import { diagnoseReconcileRow, type DiagnoseInput } from './reconcile-diagnose';

// FedEx Saudi Arabia NET ladder (account net price per tier upperKg).
// The invoice's applied base = list − discount must be matched against THIS.
const SA_RATES = [
  { upperKg: 0.5, rate: 800_000 },
  { upperKg: 1.0, rate: 1_000_000 },
  { upperKg: 1.5, rate: 1_116_981 },   // engine tier (net) for this fixture
  { upperKg: 2.0, rate: 1_500_000 },
  { upperKg: 8.0, rate: 2_782_608 },   // net base (list−discount) maps here -> heavier
];

function baseInput(over: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    // billed list base 1,116,981 with no discount -> net 1,116,981 == engine net
    billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0,
              demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 1_116_981 },
    engine: { base: 1_116_981, discount: 0, fuel: 0, remote: 0,
              demand: 0, residential: 0, vat: 0, total: 1_116_981 },
    engineChargeableWeightKg: 1.5,
    engineTierUpperKg: 1.5,
    zoneRates: SA_RATES,
    billedFuelableBase: 1_116_981,
    fuelPercent: 0,
    discountPercent: 0,
    vatPercent: 0,
    ...over,
  };
}

describe('diagnoseReconcileRow — identity invariant', () => {
  it('Σ component deltas (incl. residual) === totalDelta, exact (real #MBLVD28314)', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 5_598_900, discount: -2_816_292, fuel: 821_597, remote: 550_000,
                demand: 119_100, signature: 0, vat: 208_614, gogreen: 0, elevatedRisk: 0, total: 4_481_919 },
      engine: { base: 1_116_981, discount: 0, fuel: 513_811, remote: 0,
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

describe('diagnoseReconcileRow — net-base inversion -> SAI_CAN', () => {
  it('billed NET base (list − discount) maps to a higher tier -> SAI_CAN', () => {
    const d = diagnoseReconcileRow(baseInput({
      // list 5,598,900 − discount 2,816,292 = net 2,782,608 -> tier 8.0 kg
      billed: { base: 5_598_900, discount: -2_816_292, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_782_608 },
    }));
    const base = d.components.find((c) => c.key === 'base')!;
    expect(base.cause).toBe('SAI_CAN');
    // base component is reported on the NET basis
    expect(base.billed).toBe(2_782_608);
    expect(base.engine).toBe(1_116_981);
    expect(d.severity).toBe('weight');
    expect(d.impliedWeight).not.toBeNull();
    expect(d.impliedWeight!.tierUpperKg).toBe(8.0);
    expect(d.impliedWeight!.rangeKg).toEqual([2.0, 8.0]);
    expect(d.impliedWeight!.engineChargeableKg).toBe(1.5);
  });
});

describe('diagnoseReconcileRow — THIEU_CAU_HINH_REMOTE', () => {
  it('billed remote > 0 while engine remote 0 (base matches) -> config gap', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 550_000,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 1_666_981 },
    }));
    const rem = d.components.find((c) => c.key === 'remote')!;
    expect(rem.cause).toBe('THIEU_CAU_HINH_REMOTE');
    expect(d.severity).toBe('config');
  });
});

describe('diagnoseReconcileRow — LECH_RATE_CARD', () => {
  it('billed NET base matches no tier -> rate card mismatch, impliedWeight null', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 4_999_999, discount: 0, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 4_999_999 },
    }));
    const base = d.components.find((c) => c.key === 'base')!;
    expect(base.cause).toBe('LECH_RATE_CARD');
    expect(d.impliedWeight).toBeNull();
    expect(d.severity).toBe('ratecard');
  });
});

describe('diagnoseReconcileRow — DHL signature↔peak & gogreen↔perStep (real #MBLVD27109)', () => {
  // DHL models the signature fee as a peak_fixed surcharge and GoGreen as a
  // per_step_fixed surcharge. The billed invoice lists them as `signature`
  // and `gogreen`. Before the mapping fix these showed a false 150.000 +
  // 3.800 discrepancy ("cần cập nhật rate card") even though the totals match.
  const input = baseInput({
    billed: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
              demand: 0, signature: 150_000, vat: 95_079, gogreen: 3_800, elevatedRisk: 0, total: 1_283_555 },
    engine: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
              demand: 0, residential: 0, vat: 95_078, peak: 150_000, perStep: 3_800, total: 1_283_554 },
    billedFuelableBase: 803_632,
    fuelPercent: 28.75,
    vatPercent: 8,
  });

  it('signature reconciles against engine peak (delta 0, KHOP)', () => {
    const d = diagnoseReconcileRow(input);
    const sig = d.components.find((c) => c.key === 'signature')!;
    expect(sig.billed).toBe(150_000);
    expect(sig.engine).toBe(150_000);
    expect(sig.delta).toBe(0);
    expect(sig.cause).toBe('KHOP');
  });

  it('gogreen reconciles against engine perStep (delta 0, KHOP)', () => {
    const d = diagnoseReconcileRow(input);
    const gg = d.components.find((c) => c.key === 'gogreen')!;
    expect(gg.billed).toBe(3_800);
    expect(gg.engine).toBe(3_800);
    expect(gg.delta).toBe(0);
    expect(gg.cause).toBe('KHOP');
  });

  it('no false rate-card verdict — only the 1đ VAT rounding remains', () => {
    const d = diagnoseReconcileRow(input);
    expect(d.totalDelta).toBe(1);
    expect(d.verdict).not.toContain('cập nhật rate card');
    expect(d.severity).toBe('rounding');
    const residual = d.components.find((c) => c.key === 'residual')!;
    expect(residual.delta).toBe(0);
    // identity still holds
    expect(d.components.reduce((a, c) => a + c.delta, 0)).toBe(d.totalDelta);
  });
});

describe('diagnoseReconcileRow — rounding residual', () => {
  it('a few-dong gap lands in residual with LAM_TRON', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 1_116_984 },
    }));
    const res = d.components.find((c) => c.key === 'residual')!;
    expect(res.delta).toBe(3);
    expect(res.cause).toBe('LAM_TRON');
    expect(d.severity).toBe('rounding');
  });
});
