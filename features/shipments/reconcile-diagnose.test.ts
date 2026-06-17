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

describe('diagnoseReconcileRow — non-conveyable pass-through', () => {
  it('billed non-conveyable → component PHI_TUY_CHON, rời khỏi residual, Σ giữ nguyên', () => {
    const d = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0,
                nonConveyable: 615_000, vat: 0, gogreen: 0, elevatedRisk: 0, total: 1_731_981 },
      // engine không định giá non-conveyable
    }));
    const nc = d.components.find((c) => c.key === 'nonConveyable')!;
    expect(nc.billed).toBe(615_000);
    expect(nc.engine).toBe(0);
    expect(nc.cause).toBe('PHI_TUY_CHON');
    const residual = d.components.find((c) => c.key === 'residual')!;
    expect(residual.delta).toBe(0); // không còn nằm trong residual
    const sum = d.components.reduce((a, c) => a + c.delta, 0);
    expect(sum).toBe(d.totalDelta);
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

describe('diagnoseReconcileRow — DHL signature↔addons & gogreen↔perStep (real #MBLVD27109)', () => {
  // DHL models the signature fee as an addon_fixed surcharge (peak_fixed
  // before 2026-06-11) and GoGreen as a per_step_fixed surcharge. The billed
  // invoice lists them as `signature` and `gogreen`. Before the mapping fix
  // these showed a false 150.000 + 3.800 discrepancy ("cần cập nhật rate
  // card") even though the totals match.
  const input = baseInput({
    billed: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
              demand: 0, signature: 150_000, vat: 95_079, gogreen: 3_800, elevatedRisk: 0, total: 1_283_555 },
    engine: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
              demand: 0, residential: 0, vat: 95_078, addons: 150_000, perStep: 3_800, total: 1_283_554 },
    billedFuelableBase: 803_632,
    fuelPercent: 28.75,
    vatPercent: 8,
  });

  it('signature reconciles against engine addons (delta 0, KHOP)', () => {
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

describe('diagnoseReconcileRow — FedEx fuel TRÊN Address Correction (real #MBLVD27584)', () => {
  // FedEx tính fuel 41.75% × (netBase 4.261.232 + demand 555.800 + addrCorrection
  // 289.200) = 2.131.852. Nếu addrCorrection KHÔNG vào tổ hợp fuel base → % billed
  // ra cao giả (44.26%) → fuel bị gắn LECH_FUEL sai.
  const input = baseInput({
    billed: { base: 4_261_232, discount: 0, fuel: 2_131_852, remote: 0, demand: 555_800,
              signature: 0, residential: 0, addressCorrection: 289_200, vat: 0,
              gogreen: 0, elevatedRisk: 0, total: 7_237_084 },
    engine: { base: 4_261_232, discount: 0, fuel: 2_011_111, remote: 0, demand: 555_800,
              residential: 0, vat: 0, total: 6_828_143 },
    billedFuelableBase: 4_261_232,
    fuelPercent: 41.75, vatPercent: 0,
  });

  it('fuel KHÔNG bị gắn LECH_FUEL (nhận đúng 41.75% nhờ addrCorrection trong fuel base)', () => {
    const fuel = diagnoseReconcileRow(input).components.find((c) => c.key === 'fuel')!;
    expect(fuel.cause).not.toBe('LECH_FUEL');
  });
});

describe('diagnoseReconcileRow — Address Correction là pass-through, không vào residual', () => {
  // FedEx thu phí sửa địa chỉ 289.200 (khách nhập sai). Engine không định giá.
  // Trước khi bóc: 289.200 rơi vào residual → báo KHONG_KHOP giả.
  const input = baseInput({
    billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
              signature: 0, residential: 0, addressCorrection: 289_200, vat: 0,
              gogreen: 0, elevatedRisk: 0, total: 1_406_181 },
  });

  it('có dòng addressCorrection pass-through (289.200 vs engine 0)', () => {
    const ac = diagnoseReconcileRow(input).components.find((c) => c.key === 'addressCorrection')!;
    expect(ac.billed).toBe(289_200);
    expect(ac.engine).toBe(0);
    expect(ac.cause).toBe('PHI_TUY_CHON');
  });

  it('residual = 0 (khoản 289.200 đã được giải thích, không lệch giả)', () => {
    const resid = diagnoseReconcileRow(input).components.find((c) => c.key === 'residual')!;
    expect(resid.delta).toBe(0);
  });

  it('bất biến Σ: tổng delta thành phần = totalDelta', () => {
    const d = diagnoseReconcileRow(input);
    expect(d.components.reduce((a, c) => a + c.delta, 0)).toBe(d.totalDelta);
  });
});

describe('diagnoseReconcileRow — FedEx residential tách khỏi signature (real #MBLVD25115)', () => {
  // FedEx bill có Direct Signature 88.000 + Residential Delivery 80.100 ở 2
  // dòng RIÊNG. Engine: signature = addon_fixed when_billed (88.000), residential
  // KHÔNG tự định giá (engine 0) → pass-through. Trước khi tách, cả 168.100 dồn
  // vào dòng "signature" làm lệch giả 80.100.
  const input = baseInput({
    billed: { base: 824_341, discount: 0, fuel: 0, remote: 0, demand: 0,
              signature: 88_000, residential: 80_100, vat: 0, gogreen: 0, elevatedRisk: 0, total: 992_441 },
    engine: { base: 824_341, discount: 0, fuel: 0, remote: 0, demand: 0,
              residential: 0, vat: 0, addons: 88_000, addonReference: 88_000, total: 912_341 },
    billedFuelableBase: 824_341,
    fuelPercent: 0, vatPercent: 0,
  });

  it('signature đối chiếu với engine addons (88.000=88.000, KHOP)', () => {
    const sig = diagnoseReconcileRow(input).components.find((c) => c.key === 'signature')!;
    expect(sig.billed).toBe(88_000);
    expect(sig.engine).toBe(88_000);
    expect(sig.cause).toBe('KHOP');
  });

  it('residential là dòng riêng, pass-through (80.100 vs engine 0)', () => {
    const resi = diagnoseReconcileRow(input).components.find((c) => c.key === 'residential')!;
    expect(resi.billed).toBe(80_100);
    expect(resi.engine).toBe(0);
    expect(resi.cause).toBe('PHI_TUY_CHON');
  });

  it('bất biến Σ: tổng delta thành phần = totalDelta', () => {
    const d = diagnoseReconcileRow(input);
    expect(d.components.reduce((a, c) => a + c.delta, 0)).toBe(d.totalDelta);
  });

  it('classify RESIDENTIAL → residential pass-through (hợp lệ)', () => {
    const resi = diagnoseReconcileRow({ ...input, residentialClass: 'RESIDENTIAL' })
      .components.find((c) => c.key === 'residential')!;
    expect(resi.cause).toBe('PHI_TUY_CHON');
  });

  it('classify BUSINESS → residential SAI (KHONG_KHOP, đòi NCC)', () => {
    const resi = diagnoseReconcileRow({ ...input, residentialClass: 'BUSINESS' })
      .components.find((c) => c.key === 'residential')!;
    expect(resi.cause).toBe('KHONG_KHOP');
    expect(resi.delta).toBe(80_100);
  });
});

describe('diagnoseReconcileRow — fuel TRÊN residential (FedEx fuel cả residential)', () => {
  // FedEx tính fuel trên base + signature + RESIDENTIAL. Engine có signature
  // (addons) nhưng residential pass-through (engine=0) → engine fuel base thiếu
  // residential. Fuel chênh đúng %×residential ⇒ PHÁI SINH, KHÔNG phải LECH_FUEL.
  const input = baseInput({
    billed: { base: 2_244_600, discount: -1_541_142, fuel: 339_015, remote: 0,
      demand: 0, signature: 92_700, residential: 84_400, vat: 103_030, gogreen: 0, elevatedRisk: 0, total: 1_390_903 },
    engine: { base: 2_244_600, discount: -1_541_142, fuel: 306_521, remote: 0,
      demand: 0, residential: 0, addons: 92_700, addonReference: 92_700, vat: 93_678, total: 1_264_657 },
    billedFuelableBase: 703_458, // net base (list − discount)
    fuelPercent: 38.5, vatPercent: 8,
  });

  it('fuel = PHÁI SINH (chênh = %×residential), không LECH_FUEL', () => {
    const fuel = diagnoseReconcileRow(input).components.find((c) => c.key === 'fuel')!;
    expect(fuel.cause).toBe('PHAI_SINH');
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
                residential: 0, addons: 150_000, perStep: 11_400, vat: 290_809,
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

describe('diagnoseReconcileRow — fuel-base mismatch must not hide behind PHAI_SINH (real TA2171)', () => {
  // FedEx KW: base & demand match exactly, fuel % identical (47.5%) on
  // BOTH sides — but the carrier fueled (base + demand) while the engine
  // fueled base only. A real 103,716đ gap: must be actionable, never
  // 'Khớp'/'làm tròn'.
  const input = () => baseInput({
    billed: { base: 8_177_900, discount: -6_583_210, fuel: 861_194, remote: 0,
              demand: 218_350, signature: 0, vat: 213_939, gogreen: 0,
              elevatedRisk: 0, total: 2_888_173 },
    engine: { base: 1_594_690, discount: 0, fuel: 757_478, remote: 0,
              demand: 218_350, residential: 0, vat: 205_641, total: 2_776_159 },
    engineChargeableWeightKg: 5.5,
    engineTierUpperKg: 5.5,
    zoneRates: [{ upperKg: 5.5, rate: 1_594_690 }],
    billedFuelableBase: 1_594_690,
    fuelPercent: 47.5,
    vatPercent: 8,
  });

  it('flags fuel as LECH_FUEL_BASE when base matches but fuel rides a different base', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'base')!.cause).toBe('KHOP');
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('LECH_FUEL_BASE');
  });

  it('verdict surfaces the fuel-base issue — not làm tròn', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).not.toBe('rounding');
    expect(r.severity).not.toBe('match');
    expect(r.verdict).toContain('fuel');
  });

  it('keeps PHAI_SINH when the base itself is flagged (downstream fuel)', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 2_932_356, discount: 0, fuel: 1_245_851, remote: 0, demand: 0,
                signature: 0, vat: 0, gogreen: 0, elevatedRisk: 0, total: 4_178_207 },
      engine: { base: 2_805_365, discount: 0, fuel: 1_192_280, remote: 0, demand: 0,
                residential: 0, vat: 0, total: 3_997_645 },
      engineChargeableWeightKg: 7.5,
      engineTierUpperKg: 7.5,
      zoneRates: [
        { upperKg: 7.5, rate: 2_805_365 },
        { upperKg: 8.0, rate: 2_932_356 },
      ],
      billedFuelableBase: 2_932_356,
      fuelPercent: 42.5,
    }));
    expect(r.components.find((c) => c.key === 'base')!.cause).toBe('SAI_CAN');
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('PHAI_SINH');
  });
});

describe('diagnoseReconcileRow — FedEx fuel base includes signature (real GB order)', () => {
  // billed fuel 623,302 = 45.25% × (net 569,764 + remote 715,000 +
  // signature 92,700). The implied-% check must try the full surcharge
  // base so a correct carrier % is recognised — here remote is missing
  // from OUR config (engine remote 0), so fuel must be PHAI_SINH
  // (downstream of the flagged remote line), not LECH_FUEL.
  it('recognises the % when signature rides the fuel base; fuel stays derived', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_989_400, discount: -1_419_636, fuel: 623_302, remote: 715_000,
                demand: 0, signature: 92_700, vat: 160_061, gogreen: 0,
                elevatedRisk: 0, total: 2_160_827 },
      engine: { base: 569_764, discount: 0, fuel: 257_818, remote: 0, demand: 0,
                residential: 0, vat: 66_207, total: 893_789 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 569_764 }],
      billedFuelableBase: 569_764 + 715_000,
      fuelPercent: 45.25,
      vatPercent: 8,
    }));
    expect(r.components.find((c) => c.key === 'remote')!.cause).toBe('THIEU_CAU_HINH_REMOTE');
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('PHAI_SINH');
    expect(r.severity).toBe('config');
  });
});

describe('diagnoseReconcileRow — carrier bills a LIGHTER tier (real #MBLVD28074)', () => {
  // Ops dims 33×24×33 → dim weight 5.227 → engine tier 5.5 (2,617,961).
  // But DHL billed tier 3.0 EXACTLY (1,743,851) and the GoGreen step
  // count (6 × 1,900 = 11,400) independently proves a 3.0 kg chargeable.
  // Must flag SAI_CAN (lower direction), not 'lệch rate card'.
  const input = () => baseInput({
    billed: { base: 1_743_851, discount: 0, fuel: 811_865, remote: 0, demand: 0,
              signature: 150_000, vat: 290_809, gogreen: 11_400,
              elevatedRisk: 918_000, total: 3_925_925 },
    engine: { base: 2_617_961, discount: 0, fuel: 1_078_468, remote: 0, demand: 0,
              residential: 0, addons: 150_000, perStep: 20_900, vat: 382_826,
              countryFixed: 918_000, total: 5_168_155 },
    engineChargeableWeightKg: 5.227,
    engineTierUpperKg: 5.5,
    zoneRates: [
      { upperKg: 2.5, rate: 1_567_168 },
      { upperKg: 3.0, rate: 1_743_851 },
      { upperKg: 3.5, rate: 1_920_534 },
      { upperKg: 5.5, rate: 2_617_961 },
    ],
    billedFuelableBase: 1_743_851,
    fuelPercent: 30.5,
    vatPercent: 8,
  });

  it('inverts the billed base to the lighter tier -> SAI_CAN', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'base')!.cause).toBe('SAI_CAN');
    expect(r.impliedWeight).toMatchObject({ tierUpperKg: 3.0, engineChargeableKg: 5.227 });
  });

  it('verdict says the carrier billed LOWER and points at dims', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).toBe('weight');
    expect(r.verdict.toLowerCase()).toContain('thấp hơn');
  });
});

describe('diagnoseReconcileRow — FedEx Direct Signature opt-in (pass-through)', () => {
  // ~23% FedEx orders carry an opt-in Direct Signature fee (88,000đ 2025 /
  // 92,700đ 2026). The engine cannot predict per-order opt-ins, so billed
  // has it and engine doesn't. When the invoice arithmetic closes exactly
  // (fuel % reproduces WITH the fee in the base, VAT consistent), the row
  // is correct billing — one PASS-THROUGH conclusion, not 3 mismatches.
  const input = () => baseInput({
    billed: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
              demand: 0, signature: 92_700, vat: 128_939, gogreen: 0,
              elevatedRisk: 0, total: 1_740_672 },
    engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
              demand: 0, residential: 0, vat: 118_000, total: 1_593_000 },
    engineChargeableWeightKg: 1,
    engineTierUpperKg: 1,
    zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
    billedFuelableBase: 1_000_000,
    fuelPercent: 47.5,
    vatPercent: 8,
  });

  it('marks signature as PHI_TUY_CHON and fuel/VAT as derived', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'signature')!.cause).toBe('PHI_TUY_CHON');
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('PHAI_SINH');
  });

  it('verdict is a single pass-through conclusion, severity passthrough', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).toBe('passthrough');
    expect(r.verdict.toLowerCase()).toContain('ký nhận');
  });

  it('signature with WRONG arithmetic still flags (no blind acceptance)', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_000_000, discount: 0, fuel: 600_000, remote: 0,
                demand: 0, signature: 92_700, vat: 128_939, gogreen: 0,
                elevatedRisk: 0, total: 1_821_639 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, vat: 118_000, total: 1_593_000 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    // fuel 600,000 không khớp % nào -> LECH_FUEL, không được pass-through
    expect(r.severity).not.toBe('passthrough');
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('LECH_FUEL');
  });
});

describe('diagnoseReconcileRow — addon_fixed (Dịch vụ bổ sung, spec 2026-06-11)', () => {
  // (a) FedEx opt-in Direct Signature now carries a when_billed reference
  // price (addonReference). Billed fee == reference + fuel arithmetic
  // closes -> still PHI_TUY_CHON (pass-through), as before but price-checked.
  it('FedEx billed signature == addonReference (fuel khớp) -> PHI_TUY_CHON', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, signature: 92_700, vat: 128_939, gogreen: 0,
                elevatedRisk: 0, total: 1_740_672 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, addons: 0, addonReference: 92_700,
                vat: 118_000, total: 1_593_000 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.engine).toBe(0);
    expect(sig.cause).toBe('PHI_TUY_CHON');
    expect(r.severity).toBe('passthrough');
  });

  // (b) Billed fee deviates from the declared reference price -> the
  // pass-through gate must REJECT it (KHONG_KHOP) and the verdict must
  // call out the price-table mismatch, even though the fuel % closes.
  it('FedEx billed 100.000 ≠ addonReference 92.700 -> KHONG_KHOP + verdict sai bảng giá', () => {
    const r = diagnoseReconcileRow(baseInput({
      // fuel 522,500 = 47.5% × (1,000,000 + 100,000) — arithmetic closes,
      // only the fee price is wrong.
      billed: { base: 1_000_000, discount: 0, fuel: 522_500, remote: 0,
                demand: 0, signature: 100_000, vat: 129_800, gogreen: 0,
                elevatedRisk: 0, total: 1_752_300 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, addons: 0, addonReference: 92_700,
                vat: 118_000, total: 1_593_000 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.cause).toBe('KHONG_KHOP');
    expect(r.verdict).toContain('sai bảng giá');
    expect(r.severity).toBe('config');
  });

  // (b2) FedEx billed the Direct Signature fee in a country the carrier
  // EXEMPTS (excluded_country_codes) — engine reference dropped to 0 and the
  // Quy tắc mới (chủ shop xác nhận): bill ĐÃ CÓ signature = dịch vụ ĐƯỢC dùng
  // → công nhận opt-in dù nước nằm trong danh sách "miễn" (miễn = không auto-thu).
  // Engine giờ trả addonReference kể cả nước miễn để kiểm đúng giá.
  it('FedEx thu signature ở nước miễn (SA), đúng giá ref → PHI_TUY_CHON (công nhận)', () => {
    const r = diagnoseReconcileRow(baseInput({
      // fuel 519,033 = 47.5% × (1,000,000 + 92,700) — số học khớp; bill có
      // signature nên công nhận như opt-in pass-through.
      billed: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, signature: 92_700, vat: 128_939, gogreen: 0,
                elevatedRisk: 0, total: 1_740_672 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, addons: 0, addonReference: 92_700,
                addonExcludedForCountry: true,
                vat: 118_000, total: 1_593_000 },
      shipCountry: 'SA',
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.cause).toBe('PHI_TUY_CHON');
    expect(r.verdict).not.toContain('nước được miễn');
  });

  // (b3) regression: flag explicitly false + reference matches -> the
  // pass-through path is untouched (PHI_TUY_CHON as today).
  it('flag=false + addonReference khớp -> vẫn PHI_TUY_CHON (regression)', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, signature: 92_700, vat: 128_939, gogreen: 0,
                elevatedRisk: 0, total: 1_740_672 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, addons: 0, addonReference: 92_700,
                addonExcludedForCountry: false,
                vat: 118_000, total: 1_593_000 },
      shipCountry: 'US',
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.cause).toBe('PHI_TUY_CHON');
    expect(r.severity).toBe('passthrough');
  });

  // (c) DHL Direct Signature re-kinded peak_fixed -> addon_fixed: the
  // signature line now reconciles against engine `addons`; `peak` is no
  // longer folded in (it stays Premium-only, 0 or absent here).
  it('DHL engine addons == billed signature -> KHOP (peak không còn fold)', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
                demand: 0, signature: 150_000, vat: 95_079, gogreen: 3_800,
                elevatedRisk: 0, total: 1_283_555 },
      engine: { base: 803_632, discount: 0, fuel: 231_044, remote: 0,
                demand: 0, residential: 0, addons: 150_000, peak: 0,
                perStep: 3_800, vat: 95_078, total: 1_283_554 },
      billedFuelableBase: 803_632,
      fuelPercent: 28.75,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.billed).toBe(150_000);
    expect(sig.engine).toBe(150_000);
    expect(sig.delta).toBe(0);
    expect(sig.cause).toBe('KHOP');
  });
});

describe('diagnoseReconcileRow — ER truy thu khô (bill bổ sung, real #MBLVD27457)', () => {
  // DHL supplementary bill charges the ER flat: no fuel on it, no VAT on
  // it. Every line matches (incl. ER itself); the only deltas are
  // fuel = -%×ER and VAT = -8%×(ER-fuel-part). When the billed arithmetic
  // closes exactly on the ER-unfueled basis, conclude ONE pass-through.
  const input = () => baseInput({
    billed: { base: 1_743_851, discount: 0, fuel: 531_875, remote: 0, demand: 0,
              signature: 150_000, vat: 194_970, gogreen: 11_400,
              elevatedRisk: 918_000, total: 3_550_096 },
    engine: { base: 1_743_851, discount: 0, fuel: 811_865, remote: 0, demand: 0,
              residential: 0, addons: 150_000, perStep: 11_400, vat: 290_809,
              countryFixed: 918_000, total: 3_925_925 },
    engineChargeableWeightKg: 3,
    engineTierUpperKg: 3,
    zoneRates: [{ upperKg: 3, rate: 1_743_851 }],
    billedFuelableBase: 1_743_851,
    fuelPercent: 30.5,
    vatPercent: 8,
  });

  it('fuel becomes derived (gap = % × unfueled ER), not lệch fuel base', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.components.find((c) => c.key === 'fuel')!.cause).toBe('PHAI_SINH');
  });

  it('verdict: single supplementary-bill conclusion, severity passthrough', () => {
    const r = diagnoseReconcileRow(input());
    expect(r.severity).toBe('passthrough');
    expect(r.verdict).toContain('KHÔNG tính fuel/VAT trên ER');
  });
});

describe('import handling when_billed + fuel demand (spec 2026-06-11)', () => {
  // (a) FedEx US import handling is now when_billed: engine does NOT auto-add it
  // (countryFixed 0) but declares the reference price (countryFixedReference
  // 68.300). Bill carries the fee at the right price + fuel arithmetic closes
  // -> elevatedRisk pass-through PHI_TUY_CHON, not "engine không tính ER".
  it('bill importHandling 68.300 == reference (fuel khớp) -> elevatedRisk PHI_TUY_CHON', () => {
    const r = diagnoseReconcileRow(baseInput({
      // billed vat 122,464 = 8% × (1,000,000 + 475,000 + 68,300)
      billed: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, signature: 0, vat: 122_464, gogreen: 0,
                elevatedRisk: 0, importHandling: 68_300, total: 1_665_764 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, vat: 118_000,
                countryFixed: 0, countryFixedReference: 68_300, total: 1_593_000 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.billed).toBe(68_300);
    expect(er.engine).toBe(0);
    expect(er.cause).toBe('PHI_TUY_CHON');
  });

  // (b) Bill carries import handling at a price (78.000) that differs from the
  // declared reference (68.300) -> pass-through gate REJECTS (KHONG_KHOP) and
  // the dominant verdict calls out the price-table mismatch.
  it('bill importHandling 78.000 ≠ reference 68.300 -> KHONG_KHOP + verdict sai bảng giá', () => {
    const r = diagnoseReconcileRow(baseInput({
      // billed vat 124,240 = 8% × (1,000,000 + 475,000 + 78,000)
      billed: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, signature: 0, vat: 124_240, gogreen: 0,
                elevatedRisk: 0, importHandling: 78_000, total: 1_677_240 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, residential: 0, vat: 118_000,
                countryFixed: 0, countryFixedReference: 68_300, total: 1_593_000 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.cause).toBe('KHONG_KHOP');
    expect(r.verdict).toContain('sai bảng giá');
    expect(r.severity).toBe('config');
  });

  // (c) DHL Elevated Risk stays apply_mode='always' (auto-apply): engine
  // countryFixed 68.300 == billed elevatedRisk -> KHOP. Regression guard that
  // the when_billed branch never touches the erEngine>0 path.
  it('DHL engine countryFixed 68.300 == billed elevatedRisk -> KHOP (regression)', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                signature: 0, vat: 0, gogreen: 0, elevatedRisk: 68_300,
                total: 1_185_281 },
      engine: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                residential: 0, vat: 0, countryFixed: 68_300,
                countryFixedReference: 0, total: 1_185_281 },
    }));
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.delta).toBe(0);
    expect(er.cause).toBe('KHOP');
    expect(r.severity).toBe('match');
  });

  // (d) FedEx #MBLVD28665: the bill fuels BOTH signature (92.700) and demand
  // (28.250). Signature is opt-in pass-through (engine 0); demand matches.
  // fuel = 47.5% × (base + signature + demand). The fuel credit must accept the
  // signature+demand basis -> PHAI_SINH (derived), not LECH_FUEL_BASE.
  it('fuel fuels signature+demand (demand khớp) -> PHAI_SINH, không LECH_FUEL_BASE', () => {
    const r = diagnoseReconcileRow(baseInput({
      // fuel 532,451 = 47.5% × (1,000,000 + 92,700 + 28,250)
      billed: { base: 1_000_000, discount: 0, fuel: 532_451, remote: 0,
                demand: 28_250, signature: 92_700, vat: 0, gogreen: 0,
                elevatedRisk: 0, total: 1_653_401 },
      engine: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 28_250, residential: 0, addons: 0, addonReference: 92_700,
                vat: 0, total: 1_503_250 },
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 0,
    }));
    const fuel = r.components.find((c) => c.key === 'fuel')!;
    expect(fuel.cause).toBe('PHAI_SINH');
    expect(fuel.cause).not.toBe('LECH_FUEL_BASE');
  });
});

describe('FedEx fee model — phí nhập gộp VAT + ký nhận always (spec 2026-06-11)', () => {
  // (a) US đủ: engine countryFixed 68.300 (import fee, NGOÀI fuel base),
  // signature 92.700 always (TRONG fuel base), b.importHandling=0 +
  // b.elevatedRisk=0 (cột riêng trống) nhưng b.vat = trueVat + 68.300 (phí
  // nhập ẩn trong cột VAT). Sau khi bóc: vat khớp e.vat, elevatedRisk khớp
  // e.countryFixed -> totalDelta 0 -> KHỚP TUYỆT ĐỐI.
  it('(a) US đủ signature+import-fee (gộp VAT) -> bóc đúng, totalDelta 0', () => {
    // fuel 519.033 = 47.5% × (1.000.000 + 92.700); subtotal 1.680.033;
    // billTotal 1.814.436; trueVat 134.403; vat column = 134.403 + 68.300 = 202.703.
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, signature: 92_700, vat: 202_703, gogreen: 0,
                elevatedRisk: 0, importHandling: 0, total: 1_814_436 },
      engine: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, residential: 0, addons: 92_700, vat: 134_403,
                countryFixed: 68_300, total: 1_814_436 },
      shipCountry: 'US',
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    expect(r.totalDelta).toBe(0);
    const vat = r.components.find((c) => c.key === 'vat')!;
    expect(vat.billed).toBe(134_403); // VAT thật 8% (đã bóc phí nhập)
    expect(vat.delta).toBe(0);
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.billed).toBe(68_300); // phí nhập bóc từ VAT, khớp engine countryFixed
    expect(er.delta).toBe(0);
    // identity preserved
    expect(r.components.reduce((a, c) => a + c.delta, 0)).toBe(r.totalDelta);
    expect(r.severity).toBe('match');
    expect(r.verdict).toContain('KHỚP TUYỆT ĐỐI');
  });

  // (b) US thiếu ký nhận: engine addons 92.700 (always) nhưng bill signature 0
  // -> sigDelta -92.700, KHONG_KHOP, dominant signature -> verdict
  // "tính phí ký nhận nhưng hóa đơn không thu". countryFixed 0 (không có import
  // fee) -> không bóc VAT.
  it('(b) US engine thu ký nhận always, bill không thu -> verdict ký nhận', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_000_000, discount: 0, fuel: 475_000, remote: 0,
                demand: 0, signature: 0, vat: 118_000, gogreen: 0,
                elevatedRisk: 0, importHandling: 0, total: 1_593_000 },
      engine: { base: 1_000_000, discount: 0, fuel: 519_033, remote: 0,
                demand: 0, residential: 0, addons: 92_700, vat: 128_939,
                countryFixed: 0, total: 1_740_672 },
      shipCountry: 'US',
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 47.5,
      vatPercent: 8,
    }));
    const sig = r.components.find((c) => c.key === 'signature')!;
    expect(sig.delta).toBe(-92_700);
    expect(sig.cause).toBe('KHONG_KHOP');
    expect(r.verdict).toContain('tính phí ký nhận nhưng hóa đơn không thu');
    expect(r.severity).toBe('config');
  });

  // (c) đơn thường non-US: engine countryFixed 0 -> KHÔNG bóc VAT, component
  // vat hành xử y như trước (regression guard). VAT đúng 8% trên subtotal.
  it('(c) non-US, countryFixed 0 -> không bóc VAT, vat KHỚP như cũ', () => {
    const r = diagnoseReconcileRow(baseInput({
      // subtotal 1.000.000, vat 80.000 = 8% × 1.000.000, total 1.080.000.
      billed: { base: 1_000_000, discount: 0, fuel: 0, remote: 0,
                demand: 0, signature: 0, vat: 80_000, gogreen: 0,
                elevatedRisk: 0, importHandling: 0, total: 1_080_000 },
      engine: { base: 1_000_000, discount: 0, fuel: 0, remote: 0,
                demand: 0, residential: 0, vat: 80_000,
                countryFixed: 0, total: 1_080_000 },
      shipCountry: 'GB',
      engineChargeableWeightKg: 1,
      engineTierUpperKg: 1,
      zoneRates: [{ upperKg: 1, rate: 1_000_000 }],
      billedFuelableBase: 1_000_000,
      fuelPercent: 0,
      vatPercent: 8,
    }));
    const vat = r.components.find((c) => c.key === 'vat')!;
    expect(vat.billed).toBe(80_000); // nguyên cột VAT, không bóc
    expect(vat.delta).toBe(0);
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.billed).toBe(0);
    expect(r.totalDelta).toBe(0);
    expect(r.severity).toBe('match');
  });

  // (d) DHL ER: phí nằm ĐÚNG cột riêng (b.elevatedRisk>0) -> điều kiện bóc
  // (b.elevatedRisk===0) sai -> KHÔNG bóc, giữ nguyên hành vi cũ.
  it('(d) DHL ER ở cột riêng -> không bóc VAT, ER khớp như cũ', () => {
    const r = diagnoseReconcileRow(baseInput({
      billed: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                signature: 0, vat: 94_822, gogreen: 0, elevatedRisk: 68_300,
                importHandling: 0, total: 1_280_103 },
      engine: { base: 1_116_981, discount: 0, fuel: 0, remote: 0, demand: 0,
                residential: 0, vat: 94_822, countryFixed: 68_300,
                total: 1_280_103 },
      shipCountry: 'US',
      vatPercent: 8,
    }));
    const vat = r.components.find((c) => c.key === 'vat')!;
    expect(vat.billed).toBe(94_822); // không bóc (ER đã ở cột riêng)
    expect(vat.delta).toBe(0);
    const er = r.components.find((c) => c.key === 'elevatedRisk')!;
    expect(er.billed).toBe(68_300);
    expect(er.delta).toBe(0);
    expect(r.severity).toBe('match');
  });
});
