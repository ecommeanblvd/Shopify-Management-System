import { describe, it, expect } from 'vitest';
import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from './dhl-invoice-csv';

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

  it('bóc breakdown từng shipment (Weight charge + các XC) + map sang bill-line', () => {
    const H = 'Line Type;Invoice Number;Invoice Date;Currency;Total amount (excl. VAT);Total amount (incl. VAT);Total Tax;Shipment Number;Shipment Date;Shipment Reference 1;Product Name;Weight (kg);Weight Charge;Weight Tax (VAT);XC1 Code;XC1 Name;XC1 Charge;XC1 Tax;XC1 Total;XC2 Code;XC2 Name;XC2 Charge;XC2 Tax;XC2 Total';
    const csv = [
      H,
      'I;HANIR00143262;20250213;VND;1247323.00;1346595.00;99272.00;;;;;;;;;;;;;;;;;',
      'S;HANIR00143262;20250213;VND;1247323.00;1346595.00;99272.00;3661655384;20250103;#MBLVD21801;DUTIES & TAXES;0;0;0;XB;IMPORT EXPORT TAXES;290067;23205;313272;XX;IMPORT EXPORT DUTIES;956256;76500;1032756',
    ].join('\n');
    const p = parseDhlInvoiceCsv(csv)!;
    expect(p.shipments).toHaveLength(1);
    const s = p.shipments[0];
    expect(s.shipmentNumber).toBe('3661655384');
    expect(s.orderRef).toBe('#MBLVD21801');
    expect(s.product).toBe('DUTIES & TAXES');
    expect(s.charges.map((c) => c.code)).toEqual(['XB', 'XX']); // Weight charge=0 → bỏ
    expect(s.charges[0]).toMatchObject({ name: 'IMPORT EXPORT TAXES', charge: 290067, tax: 23205, total: 313272 });

    const line = dhlShipmentToBillLine(s);
    expect(line.trackingNumber).toBe('3661655384');
    expect(line.orderNumber).toBe('#MBLVD21801');
    expect(line.base).toBe(0);            // không có Weight charge
    expect(line.other).toBe(290067 + 956256); // các XC không phải fuel
    expect(line.vat).toBe(99272);
    expect(line.total).toBe(1346595);
    expect(line.note).toContain('IMPORT EXPORT TAXES');
  });

  it('dhlShipmentToBillLine: code XML "P" tính vào base (freight), không rơi vào other', () => {
    const s = {
      shipmentNumber: '3483557033', orderRef: '#MBLVD27669', date: '2026-03-10',
      product: 'EXPRESS WORLDWIDE nondoc', weightKg: 1.45,
      charges: [
        { code: 'P', name: 'Weight charge', charge: 803632, tax: 64291, total: 867923 },
        { code: 'FF', name: 'Fuel Surcharge', charge: 525098, tax: 42008, total: 567106 },
        { code: 'CA', name: 'Elevated Risk', charge: 918000, tax: 73440, total: 991440 },
      ],
      totalExclVat: 2246730, totalTax: 179739, totalInclVat: 2426469,
    };
    const line = dhlShipmentToBillLine(s);
    expect(line.base).toBe(803632);   // 'P' = freight base, KHÔNG phải 0
    expect(line.fuel).toBe(525098);   // FF nhận theo tên 'Fuel'
    expect(line.other).toBe(918000);  // CA — không gồm freight 'P'
  });

  it('đọc được định dạng phẩy + ngoặc kép (DHL xuất kiểu khác)', () => {
    const csv = [
      '"Line Type","Invoice Number","Invoice Date","Currency","Total amount (excl. VAT)","Total amount (incl. VAT)","Total Tax","Shipment Number","Shipment Date","Shipment Reference 1","Product Name","Weight (kg)","Weight Charge","Weight Tax (VAT)","XC1 Code","XC1 Name","XC1 Charge","XC1 Tax Code","XC1 Tax","XC1 Discount","XC1 Total"',
      '"I","HANR000268253","20260506","VND","1048348.00","1132216.00","83868.00","","","","","","","","","","","","","",""',
      '"S","HANR000268253","20260506","VND","1048348.00","1132216.00","83868.00","2519158353","20260420","#MBLVD28495","EXPRESS WORLDWIDE nondoc","1.00","605447.00","48436.00","FF","FUEL SURCHARGE","289101.00","VT","23128.00","0","312229.00"',
    ].join('\n');
    const p = parseDhlInvoiceCsv(csv)!;
    expect(p.billNumber).toBe('HANR000268253');
    expect(p.shipments).toHaveLength(1);
    expect(p.shipments[0].shipmentNumber).toBe('2519158353');
    expect(p.shipments[0].product).toBe('EXPRESS WORLDWIDE nondoc');
    expect(p.shipments[0].charges.find((c) => c.code === 'FF')?.charge).toBe(289101);
  });

  it('không có dòng I hoặc rỗng → null', () => {
    expect(parseDhlInvoiceCsv('')).toBeNull();
    expect(parseDhlInvoiceCsv(HEADER)).toBeNull();
    expect(parseDhlInvoiceCsv([HEADER, 'S;X;20250213;VND;1;1;A;20250101;#R'].join('\n'))).toBeNull();
  });
});
