import { describe, it, expect } from 'vitest';
import { normalizeBilledLine, costToVndFactor, type RawBillLine } from './carrier-invoice-lookup';

const raw: RawBillLine = {
  weightKg: '2.500', base: '1000000', discount: '-50000', fuel: '180000', remote: '0',
  demand: '25000', signature: '0', vat: '150000', other: '0', addressCorrection: null, importHandling: null, duty: null, total: '1305000', shipDate: '2026-07-02',
};

describe('costToVndFactor', () => {
  it('cost VND → 1', () => expect(costToVndFactor('VND', 'USD', 26000)).toBe(1));
  it('display VND, cost khác → 1/fx', () => expect(costToVndFactor('USD', 'VND', 1 / 26000)).toBe(26000));
  it('không quy được → null', () => expect(costToVndFactor('USD', 'USD', 1)).toBeNull());
});

describe('normalizeBilledLine', () => {
  it('cost VND (factor 1): giữ nguyên số, tách phụ phí', () => {
    const b = normalizeBilledLine(raw, 1, 'HANR000265761');
    expect(b.weightKg).toBe(2.5);
    expect(b.totalVnd).toBe(1_305_000);
    expect(b.surcharges.fuel).toBe(180_000);
    expect(b.surcharges.discount).toBe(-50_000);
    expect(b.billNumber).toBe('HANR000265761');
    expect(b.shipDate).toBe('2026-07-02');
  });
  it('cost USD → quy VND theo factor', () => {
    const usd: RawBillLine = { ...raw, total: '50', fuel: '9', base: '40', weightKg: '2', discount: '0', remote: '0', demand: '0', signature: '0', vat: '0', other: '0' };
    const b = normalizeBilledLine(usd, 26_000, 'X');
    expect(b.totalVnd).toBe(1_300_000); // 50 × 26,000
    expect(b.surcharges.fuel).toBe(234_000); // 9 × 26,000
  });
  it('null/rỗng → 0 cho phụ phí, weight null', () => {
    const empty: RawBillLine = { weightKg: null, base: null, discount: null, fuel: null, remote: null, demand: null, signature: null, vat: null, other: null, addressCorrection: null, importHandling: null, duty: null, total: '0', shipDate: null };
    const b = normalizeBilledLine(empty, 1, null);
    expect(b.weightKg).toBeNull();
    expect(b.totalVnd).toBe(0);
    expect(b.surcharges.base).toBe(0);
    expect(b.shipDate).toBeNull();
  });
});
