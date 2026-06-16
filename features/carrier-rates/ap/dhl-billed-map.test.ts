import { describe, it, expect } from 'vitest';
import { classifyDhlProduct, mapDhlFreightToBilled, isFreightCharges } from './dhl-billed-map';
import type { DhlShipment } from './dhl-invoice-csv';

const ship = (o: Partial<DhlShipment>): DhlShipment => ({
  shipmentNumber: '6673897985', orderRef: 'RT3661655384', date: '2025-02-05',
  product: 'EXPRESS WORLDWIDE nondoc', weightKg: 1.5, charges: [],
  totalExclVat: 1825514, totalTax: 0, totalInclVat: 1825514, ...o,
});

describe('classifyDhlProduct', () => {
  it('DUTIES & TAXES → duties; EXPRESS → freight', () => {
    expect(classifyDhlProduct('DUTIES & TAXES')).toBe('duties');
    expect(classifyDhlProduct('EXPRESS WORLDWIDE nondoc')).toBe('freight');
  });
});

describe('isFreightCharges', () => {
  it('có Weight/FF → freight; chỉ duties (XB/DD) → không', () => {
    expect(isFreightCharges([{ code: 'WEIGHT', name: 'Weight charge', charge: 1, tax: 0, total: 1 }])).toBe(true);
    expect(isFreightCharges([{ code: 'FF', name: 'FUEL SURCHARGE', charge: 1, tax: 0, total: 1 }])).toBe(true);
    expect(isFreightCharges([{ code: 'XB', name: 'IMPORT EXPORT TAXES', charge: 1, tax: 0, total: 1 }, { code: 'DD', name: 'DUTY TAX PAID', charge: 1, tax: 0, total: 1 }])).toBe(false);
    expect(isFreightCharges(null)).toBe(false);
  });
});

describe('mapDhlFreightToBilled', () => {
  it('map đúng theo file freight thật: Weight→base, FF→fuel, FD→gogreen', () => {
    const s = ship({ charges: [
      { code: 'WEIGHT', name: 'Weight charge', charge: 1407980, tax: 0, total: 1407980 },
      { code: 'FF', name: 'FUEL SURCHARGE', charge: 411834, tax: 0, total: 411834 },
      { code: 'FD', name: 'GOGREEN PLUS - CARBON REDUCED', charge: 5700, tax: 0, total: 5700 },
    ] });
    const m = mapDhlFreightToBilled(s);
    expect(m.base).toBe(1407980);
    expect(m.fuel).toBe(411834);
    expect(m.gogreen).toBe(5700);
    expect(m.totalAmount).toBe(1825514);
    expect(m.billingWeightKg).toBe(1.5);
    expect(m.unknown).toEqual([]);
  });

  it('khoản mã lạ → vào unknown (cảnh báo), không nhét bừa', () => {
    const s = ship({ charges: [
      { code: 'WEIGHT', name: 'Weight charge', charge: 100, tax: 0, total: 100 },
      { code: 'ZZ', name: 'SOMETHING NEW', charge: 50, tax: 0, total: 50 },
    ] });
    const m = mapDhlFreightToBilled(s);
    expect(m.base).toBe(100);
    expect(m.unknown.map((c) => c.code)).toEqual(['ZZ']);
  });

  it('nhận diện remote / signature / elevated risk theo tên', () => {
    const s = ship({ charges: [
      { code: 'OO', name: 'REMOTE AREA DELIVERY', charge: 30, tax: 0, total: 30 },
      { code: 'YY', name: 'DIRECT SIGNATURE', charge: 20, tax: 0, total: 20 },
      { code: 'XE', name: 'ELEVATED RISK SURCHARGE', charge: 10, tax: 0, total: 10 },
    ] });
    const m = mapDhlFreightToBilled(s);
    expect(m.remote).toBe(30);
    expect(m.directSignature).toBe(20);
    expect(m.elevatedRisk).toBe(10);
    expect(m.unknown).toEqual([]);
  });
});
