import { describe, it, expect } from 'vitest';
import { normalizeBilledLine, costToVndFactor, billImpliedFuelPercent, aggregateBilledLines, billedHasFreight, type RawBillLine, type BilledSurcharges, type BilledLookup } from './carrier-invoice-lookup';

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

describe('billImpliedFuelPercent — fuel % FedEx THỰC ÁP suy từ chính bill', () => {
  const s = (over: Partial<BilledSurcharges>): BilledSurcharges => ({
    base: 0, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0, vat: 0,
    other: 0, residential: 0, addressCorrection: 0, importHandling: 0, duty: 0, ...over,
  });
  it('SV-0016 thật: fuel 393.038 / (4.470.300 − 3.522.149 + demand 79.400) = 38,25%', () => {
    expect(billImpliedFuelPercent(s({ base: 4_470_300, discount: -3_522_149, fuel: 393_038, demand: 79_400 }))).toBe(38.25);
  });
  it('SV-0015 thật: AC chịu fuel — 507.718 / (3.442.200 − 2.404.032 + AC 289.200) = 38,25%', () => {
    expect(billImpliedFuelPercent(s({ base: 3_442_200, discount: -2_404_032, fuel: 507_718, addressCorrection: 289_200 }))).toBe(38.25);
  });
  it('lượng tử hoá bậc 0,25 (FedEx công bố theo bước 0,25%)', () => {
    // 385/1000 = 38.5% chính xác; lệch làm tròn vài đồng vẫn về đúng bậc.
    expect(billImpliedFuelPercent(s({ base: 1_000_000, fuel: 385_003 }))).toBe(38.5);
  });
  it('bill không có fuel (0) → null (caller fallback engine)', () => {
    expect(billImpliedFuelPercent(s({ base: 1_000_000, fuel: 0 }))).toBeNull();
  });
  it('base chịu fuel ≤ 0 → null', () => {
    expect(billImpliedFuelPercent(s({ base: 100, discount: -200, fuel: 50 }))).toBeNull();
  });
  it('tỉ lệ vô lý (>100%) → null, không tin dòng bill hỏng', () => {
    expect(billImpliedFuelPercent(s({ base: 100_000, fuel: 200_000 }))).toBeNull();
  });
});

describe('aggregateBilledLines — 1 lô hàng có NHIỀU dòng bill (cước 734xxx + duty 736xxx)', () => {
  const mk = (over: Partial<BilledLookup['surcharges']>, extra?: Partial<BilledLookup>): BilledLookup => ({
    weightKg: null, totalVnd: 0, billNumber: null, shipDate: null,
    surcharges: { base: 0, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0, vat: 0, other: 0, residential: 0, addressCorrection: 0, importHandling: 0, duty: 0, ...over },
    ...extra,
  });
  it('SV-0029 thật: dòng duty đứng trước + dòng cước — gộp đủ cả hai', () => {
    const duty = mk({ duty: 370_658 }, { totalVnd: 370_658, billNumber: '736056168', weightKg: 8.3 });
    const freight = mk({ base: 11_176_700, discount: -7_500_000, fuel: 1_400_000, vat: 300_000 }, { totalVnd: 4_587_478, billNumber: '734110283', weightKg: 8.3, shipDate: '2026-07-20' });
    const agg = aggregateBilledLines([duty, freight]);
    expect(agg.surcharges.base).toBe(11_176_700);
    expect(agg.surcharges.duty).toBe(370_658);
    expect(agg.totalVnd).toBe(4_958_136); // cước + duty
    expect(agg.weightKg).toBe(8.3);
    expect(agg.shipDate).toBe('2026-07-20'); // lấy từ dòng có ship date
    expect(agg.billNumber).toBe('736056168 + 734110283');
  });
  it('1 dòng duy nhất → giữ nguyên', () => {
    const one = mk({ base: 100, discount: -20 }, { totalVnd: 80, billNumber: 'B1', weightKg: 1 });
    expect(aggregateBilledLines([one])).toEqual(one);
  });
  it('billedHasFreight: chỉ có duty (bill cước chưa về) → false', () => {
    expect(billedHasFreight(mk({ duty: 370_658 }, { totalVnd: 370_658 }))).toBe(false);
    expect(billedHasFreight(mk({ base: 1_000_000, discount: -700_000 }, { totalVnd: 300_000 }))).toBe(true);
  });
});
