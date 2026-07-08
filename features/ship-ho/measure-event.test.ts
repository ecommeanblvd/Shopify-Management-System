import { describe, it, expect } from 'vitest';
import { buildMeasurementEventData, chargeableKg, dimWeightKg } from './measure-event';

const declared = { weightKg: 2, dimLengthCm: 30, dimWidthCm: 24, dimHeightCm: 11 };

describe('dimWeightKg / chargeableKg', () => {
  it('dim = L×W×H/5000, chargeable = max(cân, dim)', () => {
    expect(dimWeightKg(declared)).toBe(1.584);
    expect(chargeableKg(declared)).toBe(2);
    expect(chargeableKg({ weightKg: 1, dimLengthCm: 50, dimWidthCm: 40, dimHeightCm: 30 })).toBe(12); // dim thắng
  });
  it('thiếu kích thước → dim null, chargeable = cân', () => {
    const p = { weightKg: 2, dimLengthCm: null, dimWidthCm: null, dimHeightCm: null };
    expect(dimWeightKg(p)).toBeNull();
    expect(chargeableKg(p)).toBe(2);
  });
});

describe('buildMeasurementEventData', () => {
  it('KHỚP: cùng cân + kích thước → matched=true, delta 0, price không đổi', () => {
    const d = buildMeasurementEventData(declared, { ...declared }, { previousChargedVnd: 2_012_941, chargedVnd: 2_012_941 });
    expect(d.matched).toBe(true);
    expect(d.delta).toEqual({ weightKg: 0, chargeableWeightKg: 0 });
    expect(d.price).toEqual({ changed: false, previousChargedVnd: 2_012_941, chargedVnd: 2_012_941, deltaVnd: 0 });
    expect(d.declared.chargeableWeightKg).toBe(2);
  });

  it('LỆCH cân + giá đổi → matched=false, delta + price.changed + lines', () => {
    const measured = { weightKg: 2.4, dimLengthCm: 32, dimWidthCm: 24, dimHeightCm: 11 };
    const lines = [{ label: 'Cước cơ bản (Express Delivery)', amountVnd: 1_400_000 }];
    const d = buildMeasurementEventData(declared, measured, { previousChargedVnd: 2_012_941, chargedVnd: 2_350_000, lines });
    expect(d.matched).toBe(false);
    expect(d.delta.weightKg).toBe(0.4);
    expect(d.measured.dimWeightKg).toBe(1.69); // 32×24×11/5000
    expect(d.delta.chargeableWeightKg).toBe(0.4); // max(2.4, 1.69) − max(2, 1.584)
    expect(d.price.changed).toBe(true);
    expect(d.price.deltaVnd).toBe(337_059);
    expect(d.price.lines).toEqual(lines);
  });

  it('số đo KHỚP nhưng giá vẫn đổi (fuel tuần mới) → matched=true + price.changed=true', () => {
    const d = buildMeasurementEventData(declared, { ...declared }, { previousChargedVnd: 2_012_941, chargedVnd: 2_050_000 });
    expect(d.matched).toBe(true);
    expect(d.price.changed).toBe(true);
    expect(d.price.deltaVnd).toBe(37_059);
  });

  it('brand không khai kích thước, SMS đo có → matched=false dù cân bằng nhau', () => {
    const noDims = { weightKg: 2, dimLengthCm: null, dimWidthCm: null, dimHeightCm: null };
    const d = buildMeasurementEventData(noDims, declared, { previousChargedVnd: 1, chargedVnd: 1 });
    expect(d.matched).toBe(false);
    expect(d.delta.weightKg).toBe(0);
  });
});
