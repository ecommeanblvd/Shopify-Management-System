import { describe, it, expect } from 'vitest';
import { detectUnknownCharges, type UnknownChargeLine } from './detect-surcharges';

const line = (o: Partial<UnknownChargeLine>): UnknownChargeLine => ({
  billId: 'b1', billNumber: 'INV1', periodStart: '2026-03-01', trackingNumber: 'T1', charges: null, ...o,
});

const ch = (code: string, name: string, charge = 0, tax = 0) => ({ code, name, charge, tax, total: charge + tax });

describe('detectUnknownCharges', () => {
  it('bỏ qua cước đã nhận diện (weight/fuel) và thuế/duty (XB/DD)', () => {
    const rows = detectUnknownCharges([
      line({ charges: [
        ch('WEIGHT', 'WEIGHT CHARGE', 900000, 72000),
        ch('FF', 'FUEL SURCHARGE', 100000, 8000),
        ch('XB', 'IMPORT EXPORT TAXES', 272323, 21786),
        ch('DD', 'DUTY TAX PAID', 600000, 48000),
      ] }),
    ]);
    expect(rows).toEqual([]);
  });

  it('gom khoản lạ theo (code,name): count, tổng net, tổng VAT', () => {
    const rows = detectUnknownCharges([
      line({ billNumber: 'INV1', periodStart: '2026-03-01', trackingNumber: 'A', charges: [ch('ZZ', 'SPECIAL HANDLING FEE', 50000, 4000)] }),
      line({ billNumber: 'INV2', periodStart: '2026-02-01', trackingNumber: 'B', charges: [ch('ZZ', 'SPECIAL HANDLING FEE', 30000, 2400)] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'ZZ', name: 'SPECIAL HANDLING FEE',
      count: 2, totalCharge: 80000, totalTax: 6400,
      firstPeriod: '2026-02-01', lastPeriod: '2026-03-01',
    });
    expect(rows[0].sampleBillNumbers).toEqual(['INV1', 'INV2']);
    expect(rows[0].sampleTrackings).toEqual(['A', 'B']);
  });

  it('sắp xếp hay gặp nhất trước', () => {
    const rows = detectUnknownCharges([
      line({ trackingNumber: 'A', charges: [ch('AA', 'RARE FEE', 10000)] }),
      line({ trackingNumber: 'B', charges: [ch('BB', 'COMMON FEE', 5000)] }),
      line({ trackingNumber: 'C', charges: [ch('BB', 'COMMON FEE', 5000)] }),
    ]);
    expect(rows.map((r) => r.code)).toEqual(['BB', 'AA']);
  });

  it('giới hạn 5 hoá đơn / tracking mẫu, không trùng', () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      line({ billNumber: `INV${i}`, trackingNumber: `T${i}`, charges: [ch('XQ', 'MYSTERY FEE', 1000)] }));
    const rows = detectUnknownCharges(lines);
    expect(rows[0].count).toBe(8);
    expect(rows[0].sampleBillNumbers).toHaveLength(5);
    expect(rows[0].sampleTrackings).toHaveLength(5);
  });

  it('dòng không có charges → bỏ qua', () => {
    expect(detectUnknownCharges([line({ charges: null }), line({ charges: [] })])).toEqual([]);
  });

  it('non-conveyable/restricted/residential ĐÃ được nhận diện (bucketOf) → KHÔNG còn là khoản lạ', () => {
    const rows = detectUnknownCharges([
      line({ charges: [
        ch('YL', 'NON-CONVEYABLE PIECE - WEIGHT', 120000, 9600),
        ch('CB', 'RESTRICTED DESTINATION', 750000, 60000),
        ch('TK', 'RESIDENTIAL ADDRESS', 128000, 10240),
      ] }),
    ]);
    expect(rows).toEqual([]);
  });

  it('phụ phí hiếm thật sự lạ (oversize) vẫn bị gắn cờ', () => {
    const rows = detectUnknownCharges([
      line({ charges: [ch('OS', 'OVERSIZE PIECE', 90000, 7200)] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('OVERSIZE PIECE');
  });
});
