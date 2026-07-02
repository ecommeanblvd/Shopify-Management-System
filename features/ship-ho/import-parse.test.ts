import { describe, it, expect } from 'vitest';
import { parseShipHoImportRow, statusForImportedOrder } from './import-parse';

const base = [
  'DISCN100', 'Nguyen A', 'ACME', '0900000000', 'us', 'Houston', 'TX', '77441',
  '123 Main St', 'Apt 4', '0.8', '42', '30', '10', 'box', 'fedex', '794000000001',
];

describe('parseShipHoImportRow', () => {
  it('dòng hợp lệ → ok, chuẩn hoá country/carrier/packaging', () => {
    const r = parseShipHoImportRow(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.code).toBe('DISCN100');
    expect(r.row.country).toBe('US');
    expect(r.row.carrierKey).toBe('fedex');
    expect(r.row.packagingType).toBe('box');
    expect(r.row.weightKg).toBe(0.8);
    expect(r.row.dimLengthCm).toBe(42);
    expect(r.row.trackingNumber).toBe('794000000001');
  });

  it('dòng rỗng → skip_empty', () => {
    expect(parseShipHoImportRow([null, '', '   ']).kind).toBe('skip_empty');
    expect(parseShipHoImportRow([]).kind).toBe('skip_empty');
  });

  it('thiếu code → error missing_code', () => {
    const r = parseShipHoImportRow(['', 'x', '', '', 'US', '', '', '', '', '', '1']);
    expect(r).toEqual({ kind: 'error', reason: 'missing_code' });
  });

  it('country không phải ISO2 → error bad_country', () => {
    const row = [...base]; row[4] = 'USA';
    expect(parseShipHoImportRow(row)).toEqual({ kind: 'error', reason: 'bad_country' });
  });

  it('cân ≤ 0 hoặc không phải số → error bad_weight', () => {
    const z = [...base]; z[10] = '0';
    expect(parseShipHoImportRow(z)).toEqual({ kind: 'error', reason: 'bad_weight' });
    const n = [...base]; n[10] = 'abc';
    expect(parseShipHoImportRow(n)).toEqual({ kind: 'error', reason: 'bad_weight' });
  });

  it('carrier/packaging lạ → null (không chặn)', () => {
    const row = [...base]; row[14] = 'crate'; row[15] = 'ups';
    const r = parseShipHoImportRow(row);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.packagingType).toBeNull();
    expect(r.row.carrierKey).toBeNull();
  });

  it('dim thiếu → null', () => {
    const row = [...base] as unknown[]; row[11] = ''; row[12] = null; row[13] = '';
    const r = parseShipHoImportRow(row);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.dimLengthCm).toBeNull();
  });
});

describe('statusForImportedOrder', () => {
  it('có tracking → shipped; không → draft', () => {
    expect(statusForImportedOrder('X1')).toBe('shipped');
    expect(statusForImportedOrder(null)).toBe('draft');
    expect(statusForImportedOrder('')).toBe('draft');
  });
});
