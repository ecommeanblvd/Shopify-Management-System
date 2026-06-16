import { describe, it, expect } from 'vitest';
import { parseDhlInvoiceCsv } from './dhl-invoice-csv';

const HEADER = 'Line Type;Invoice Number;Invoice Date;Currency;Total amount (excl. VAT);Total amount (incl. VAT);Shipment Number;Shipment Date;Shipment Reference 1';

describe('parseDhlInvoiceCsv', () => {
  it('điền được mã, tiền (gồm VAT), ngày xuất, hạn=+30, kỳ theo shipment, note', () => {
    const csv = [
      HEADER,
      'I;HANIR00143262;20250213;VND;1847069.00;1994835.00;;;',
      'S;HANIR00143262;20250213;VND;1847069.00;1994834.00;3661655384;20250103;#MBLVD21801',
    ].join('\n');
    const p = parseDhlInvoiceCsv(csv)!;
    expect(p.billNumber).toBe('HANIR00143262');
    expect(p.currency).toBe('VND');
    expect(p.amountInclVat).toBe(1994835);
    expect(p.amountExclVat).toBe(1847069);
    expect(p.issueDate).toBe('2025-02-13');
    expect(p.dueDate).toBe('2025-03-15'); // +30 ngày
    expect(p.periodStart).toBe('2025-01-03');
    expect(p.periodEnd).toBe('2025-01-03');
    expect(p.note).toBe('#MBLVD21801 · Shipment 3661655384');
    expect(p.shipmentCount).toBe(1);
  });

  it('nhiều shipment → kỳ = min..max ngày, gộp refs + shipment numbers', () => {
    const csv = [
      HEADER,
      'I;INV9;20250301;VND;100.00;110.00;;;',
      'S;INV9;20250301;VND;50.00;55.00;A1;20250105;#REF1',
      'S;INV9;20250301;VND;50.00;55.00;A2;20250120;#REF2',
    ].join('\n');
    const p = parseDhlInvoiceCsv(csv)!;
    expect(p.periodStart).toBe('2025-01-05');
    expect(p.periodEnd).toBe('2025-01-20');
    expect(p.note).toBe('#REF1, #REF2 · Shipment A1, A2');
    expect(p.shipmentCount).toBe(2);
  });

  it('không có Shipment Date → kỳ lùi về ngày xuất', () => {
    const csv = [HEADER, 'I;INV;20250213;VND;100.00;110.00;;;'].join('\n');
    const p = parseDhlInvoiceCsv(csv)!;
    expect(p.periodStart).toBe('2025-02-13');
    expect(p.periodEnd).toBe('2025-02-13');
  });

  it('không có dòng I hoặc rỗng → null', () => {
    expect(parseDhlInvoiceCsv('')).toBeNull();
    expect(parseDhlInvoiceCsv(HEADER)).toBeNull();
    expect(parseDhlInvoiceCsv([HEADER, 'S;X;20250213;VND;1;1;A;20250101;#R'].join('\n'))).toBeNull();
  });
});
