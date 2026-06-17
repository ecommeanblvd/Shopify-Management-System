import { describe, it, expect } from 'vitest';
import { buildTrackingRows, type TrackingLineInput, type TrackingBillInput } from './tracking-rows';

const line = (o: Partial<TrackingLineInput> & { billId: string }): TrackingLineInput => ({
  trackingNumber: null, orderNumber: null, weightKg: null,
  base: 0, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0, vat: 0, other: 0, total: 0, note: null, ...o,
});

describe('buildTrackingRows', () => {
  const bills: TrackingBillInput[] = [
    { id: 'b1', billNumber: 'HANIR1', dueDate: '2026-03-15', amount: 1346595 },
    { id: 'b2', billNumber: 'MANUAL', dueDate: '2020-01-01', amount: 500000 }, // không có line, quá hạn
  ];
  const lines: TrackingLineInput[] = [
    line({ billId: 'b1', trackingNumber: '3661655384', orderNumber: '#MBLVD21801', other: 1246323, vat: 99272, total: 1346595, note: 'IMPORT EXPORT TAXES 290.067' }),
  ];

  it('mỗi line = 1 dòng tracking, kèm fees>0 + status theo bill', () => {
    const rows = buildTrackingRows(bills, lines, [], '2026-06-16');
    const r = rows.find((x) => x.trackingNumber === '3661655384')!;
    expect(r.orderNumber).toBe('#MBLVD21801');
    expect(r.total).toBe(1346595);
    expect(r.fees.map((f) => f.label)).toEqual(['VAT', 'Khác']); // chỉ khoản >0
    expect(r.status).toBe('unpaid');
    expect(r.hasDetail).toBe(true);
  });

  it('hoá đơn không có line → 1 dòng tổng, tracking trống, đánh dấu quá hạn', () => {
    const rows = buildTrackingRows(bills, lines, [], '2026-06-16');
    const r = rows.find((x) => x.billId === 'b2')!;
    expect(r.trackingNumber).toBeNull();
    expect(r.total).toBe(500000);
    expect(r.hasDetail).toBe(false);
    expect(r.overdue).toBe(true);
  });

  it('charges → phí NET từng khoản, gom VAT, ẩn duty, non-conveyable/residential thành cột riêng, hiếm vào "Khác"', () => {
    const withCharges: TrackingLineInput[] = [line({
      billId: 'b1', trackingNumber: 'T', total: 1500000,
      charges: [
        { code: 'WT', name: 'Weight charge', charge: 900000, tax: 72000, total: 972000 },
        { code: 'FF', name: 'FUEL SURCHARGE', charge: 200000, tax: 16000, total: 216000 },
        { code: 'XB', name: 'IMPORT EXPORT TAXES', charge: 290067, tax: 23205, total: 313272 }, // ẩn (cả VAT)
        { code: 'XX', name: 'IMPORT EXPORT DUTIES', charge: 956256, tax: 76500, total: 1032756 }, // ẩn (cả VAT)
        { code: 'YL', name: 'NON-CONVEYABLE PIECE - IRREGULAR', charge: 50000, tax: 4000, total: 54000 }, // → cột riêng
        { code: 'TK', name: 'RESIDENTIAL ADDRESS', charge: 20000, tax: 1600, total: 21600 }, // → cột riêng
        { code: 'OS', name: 'OVERSIZE PIECE', charge: 10000, tax: 800, total: 10800 }, // hiếm → Khác
      ],
    })];
    const rows = buildTrackingRows(bills, withCharges, [], '2026-06-16');
    const r = rows.find((x) => x.trackingNumber === 'T')!;
    expect(r.fees).toEqual([
      { label: 'Weight charge', value: 900000 },     // net (tách VAT)
      { label: 'FUEL SURCHARGE', value: 200000 },    // net
      { label: 'Non-Conveyable', value: 50000 },     // gom biến thể về 1 cột
      { label: 'Residential', value: 20000 },
      { label: 'Khác', value: 10000 },               // oversize (hiếm)
      { label: 'VAT', value: 94400 },                // 72000+16000+4000+1600+800 (VAT duty bị ẩn)
    ]);
  });

  it('dòng chỉ thuế/duty (mọi khoản bị ẩn) → fees rỗng + dutyOnly=true', () => {
    const dutyLine: TrackingLineInput[] = [line({
      billId: 'b1', trackingNumber: '1628499014', orderNumber: '#MBLVD28140', total: 1007466, vat: 74627,
      charges: [
        { code: 'XB', name: 'IMPORT EXPORT TAXES', charge: 272323, tax: 21786, total: 294109 },
        { code: 'XX', name: 'IMPORT EXPORT DUTIES', charge: 60516, tax: 4841, total: 65357 },
        { code: 'DD', name: 'DUTY TAX PAID', charge: 600000, tax: 48000, total: 648000 },
      ],
    })];
    const r = buildTrackingRows(bills, dutyLine, [], '2026-06-16').find((x) => x.trackingNumber === '1628499014')!;
    expect(r.fees).toEqual([]);          // không cột phí nào
    expect(r.dutyOnly).toBe(true);
    expect(r.total).toBe(1007466);
  });

  it('dòng có cước thật → dutyOnly=false', () => {
    const r = buildTrackingRows(bills, lines, [], '2026-06-16').find((x) => x.trackingNumber === '3661655384')!;
    expect(r.dutyOnly).toBe(false);
  });

  it('thanh toán đủ → status paid, hết overdue', () => {
    const rows = buildTrackingRows(bills, lines, [{ billId: 'b1', amount: 1346595 }], '2026-06-16');
    const r = rows.find((x) => x.billId === 'b1')!;
    expect(r.status).toBe('paid');
    expect(r.overdue).toBe(false);
  });
});
