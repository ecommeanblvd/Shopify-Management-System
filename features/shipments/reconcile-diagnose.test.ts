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
