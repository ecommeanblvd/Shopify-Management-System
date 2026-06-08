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
