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

describe('diagnoseReconcileRow — SAI_ZONE (real #MBLVD28869, FedEx Monaco)', () => {
  // Carrier billed Monaco at Zone M while our country→zone map puts MC in
  // Zone E. Billed NET base (list 6,550,000 − discount 4,934,770 =
  // 1,615,230) matches Zone M's 7.5 kg NET rate EXACTLY; every downstream
  // charge (fuel 42.5 %, demand, VAT 8 %) is consistent with that base.
  const input = () => baseInput({
    billed: { base: 6_550_000, discount: -4_934_770, fuel: 776_998, remote: 0,
              demand: 213_000, signature: 0, vat: 208_418, gogreen: 0,
              elevatedRisk: 0, total: 2_813_646 },
    engine: { base: 2_805_365, discount: 0, fuel: 1_192_280, remote: 0,
              demand: 213_000, residential: 0, vat: 336_852, total: 4_547_497 },
    engineChargeableWeightKg: 7.5,
    engineTierUpperKg: 7.5,
    zoneRates: [
      { upperKg: 7.0, rate: 2_678_374 },
      { upperKg: 7.5, rate: 2_805_365 },
      { upperKg: 8.0, rate: 2_932_356 },
    ],
    engineZoneLabel: 'Zone E',
    otherZoneRates: [
      { zoneLabel: 'Zone M', rates: [
        { upperKg: 7.0, rate: 1_542_113 },
        { upperKg: 7.5, rate: 1_615_230 },
        { upperKg: 8.0, rate: 1_688_347 },
      ] },
    ],
    billedFuelableBase: 1_615_230,
    fuelPercent: 42.5,
    vatPercent: 8,
  });

  it('billed NET base hits another zone at the same tier -> SAI_ZONE on base', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'base')!.cause).toBe('SAI_ZONE');
  });

  it('impliedZone carries billed zone, engine zone, and the matched tier', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.impliedZone).toEqual({
      zoneLabel: 'Zone M', engineZoneLabel: 'Zone E', tierUpperKg: 7.5,
    });
  });

  it('verdict headlines the zone mismatch with severity zone', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).toBe('zone');
    expect(r.verdict).toContain('Zone M');
    expect(r.verdict).toContain('Zone E');
  });

  it('same-zone weight inversion still wins over cross-zone match', () => {
    // Billed net base = own zone's 8.0 kg rate AND (hypothetically) another
    // zone's rate — weight inversion is stronger evidence, keep SAI_CAN.
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 2_932_356, discount: 0, fuel: 0, remote: 0, demand: 0,
                signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 2_932_356 },
      engine: { base: 2_805_365, discount: 0, fuel: 0, remote: 0, demand: 0,
                residential: 0, vat: 0, total: 2_805_365 },
      engineChargeableWeightKg: 7.5,
      engineTierUpperKg: 7.5,
      zoneRates: [
        { upperKg: 7.5, rate: 2_805_365 },
        { upperKg: 8.0, rate: 2_932_356 },
      ],
      engineZoneLabel: 'Zone E',
      otherZoneRates: [
        { zoneLabel: 'Zone Q', rates: [{ upperKg: 7.5, rate: 2_932_356 }] },
      ],
    }));
    expect(r.components.find((c) => c.key === 'base')!.cause).toBe('SAI_CAN');
    expect(r.severity).toBe('weight');
  });
});

describe('diagnoseReconcileRow — SAI_ZONE suppresses derived fuel/VAT flags', () => {
  // Same #MBLVD28869 fixture: under the implied Zone M base the billed fuel
  // is exactly 42.5 % × (net base + demand) and VAT exactly 8 % × the
  // pre-VAT sum -> both are CONSISTENT with the zone the carrier billed.
  // The operator wants ONE conclusion (zone), not derived fuel/VAT noise.
  const input = () => baseInput({
    billed: { base: 6_550_000, discount: -4_934_770, fuel: 776_998, remote: 0,
              demand: 213_000, signature: 0, vat: 208_418, gogreen: 0,
              elevatedRisk: 0, total: 2_813_646 },
    engine: { base: 2_805_365, discount: 0, fuel: 1_192_280, remote: 0,
              demand: 213_000, residential: 0, vat: 336_852, total: 4_547_497 },
    engineChargeableWeightKg: 7.5,
    engineTierUpperKg: 7.5,
    zoneRates: [
      { upperKg: 7.5, rate: 2_805_365 },
      { upperKg: 8.0, rate: 2_932_356 },
    ],
    engineZoneLabel: 'Zone E',
    otherZoneRates: [
      { zoneLabel: 'Zone M', rates: [{ upperKg: 7.5, rate: 1_615_230 }] },
    ],
    // NET basis: list − discount + remote (no demand — the check itself
    // must tolerate FedEx's inconsistent demand-in-fuel-base behaviour).
    billedFuelableBase: 1_615_230,
    fuelPercent: 42.5,
    vatPercent: 8,
  });

  it('fuel consistent under billed base (incl demand) -> PHAI_SINH_ZONE, not LECH_FUEL', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('PHAI_SINH_ZONE');
  });

  it('VAT consistent under billed pre-VAT sum -> PHAI_SINH_ZONE', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'vat')!.cause).toBe('PHAI_SINH_ZONE');
  });

  it('verdict stays a single zone conclusion', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).toBe('zone');
    expect(r.verdict).toContain('Zone M');
  });
});

describe('diagnoseReconcileRow — elevated risk (ER) vs engine country_fixed', () => {
  // Real #MBLVD27457 (DHL SA, 2026-03-04 transition day): engine charges
  // ER 918,000 (config starts that day) but the carrier did NOT bill it.
  // The 918,000 must surface as an ER mismatch — NOT as 'làm tròn'.
  it('engine ER not billed -> elevatedRisk line mismatch + ER verdict, not rounding', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_743_851, discount: 0, fuel: 531_875, remote: 0, demand: 0,
                signature: 150_000, vat: 194_970, gogreen: 11_400,
                elevatedRisk: 0, total: 2_632_096 },
      engine: { base: 1_743_851, discount: 0, fuel: 811_865, remote: 0, demand: 0,
                residential: 0, peak: 150_000, perStep: 11_400, vat: 290_809,
                countryFixed: 918_000, total: 3_925_925 },
      engineChargeableWeightKg: 2.52,
      engineTierUpperKg: 3,
      zoneRates: [{ upperKg: 3, rate: 1_743_851 }],
      billedFuelableBase: 1_743_851,
      fuelPercent: 30.5,
      vatPercent: 8,
    }));
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.engine).toBe(918_000);
    expect(er.delta).toBe(-918_000);
    expect(er.cause).toBe('KHONG_KHOP');
    expect(r.severity).not.toBe('rounding');
    expect(r.verdict).toContain('rủi ro');
  });

  it('billed ER == engine country_fixed -> KHOP', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                signature: 0, vat: 0, gogreen: 0, elevatedRisk: 918_000,
                total: 2_034_981 },
      engine: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                residential: 0, vat: 0, countryFixed: 918_000, total: 2_034_981 },
    }));
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.delta).toBe(0);
    expect(er.cause).toBe('KHOP');
    expect(r.severity).toBe('match');
  });

  it('large unexplained residual is NOT labelled làm tròn', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0,
                total: 1_616_981 },  // 500,000 nobody explains
      engine: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                residential: 0, vat: 0, total: 1_116_981 },
    }));
    const res = r.components.find((c) => c.key === 'residual')!;
    expect(res.cause).toBe('KHONG_KHOP');
    expect(r.verdict).not.toContain('làm tròn');
  });
});
