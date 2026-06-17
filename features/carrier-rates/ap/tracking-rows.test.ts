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

  it('có charges chi tiết → giữ cước lõi, ẩn thuế/duty, gộp khoản hiếm vào "Khác"', () => {
    const withCharges: TrackingLineInput[] = [line({
      billId: 'b1', trackingNumber: 'T', total: 1500000,
      charges: [
        { code: 'WT', name: 'Weight charge', charge: 900000, tax: 72000, total: 972000 },
        { code: 'FF', name: 'FUEL SURCHARGE', charge: 200000, tax: 16000, total: 216000 },
        { code: 'XB', name: 'IMPORT EXPORT TAXES', charge: 290067, tax: 23205, total: 313272 }, // ẩn
        { code: 'XX', name: 'IMPORT EXPORT DUTIES', charge: 956256, tax: 76500, total: 1032756 }, // ẩn
        { code: 'NC', name: 'NON-CONVEYABLE PIECE - IRREGULAR', charge: 50000, tax: 4000, total: 54000 }, // → Khác
        { code: 'RA', name: 'RESIDENTIAL ADDRESS', charge: 20000, tax: 1600, total: 21600 }, // → Khác
      ],
    })];
    const rows = buildTrackingRows(bills, withCharges, [], '2026-06-16');
    const r = rows.find((x) => x.trackingNumber === 'T')!;
    expect(r.fees).toEqual([
      { label: 'Weight charge', value: 972000 },
      { label: 'FUEL SURCHARGE', value: 216000 },
      { label: 'Khác', value: 75600 }, // 54000 + 21600, duty đã bị ẩn
    ]);
  });

  it('thanh toán đủ → status paid, hết overdue', () => {
    const rows = buildTrackingRows(bills, lines, [{ billId: 'b1', amount: 1346595 }], '2026-06-16');
    const r = rows.find((x) => x.billId === 'b1')!;
    expect(r.status).toBe('paid');
    expect(r.overdue).toBe(false);
  });
});
