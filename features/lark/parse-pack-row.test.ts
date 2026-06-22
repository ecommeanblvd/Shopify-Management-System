import { describe, it, expect } from 'vitest';
import { parsePackRow } from './parse-pack-row';

describe('parsePackRow', () => {
  it('field string cơ bản → map đầy đủ', () => {
    const r = parsePackRow({
      'Order Number': '#MBLVD29149', 'Log Unique code': 'PK-20507',
      'Weights': '0.80', 'Dimension ( điền tay)': '40x31x2',
      'Tracking Number': '25G8E12S', 'Couriers': 'FedEx',
      'Label Created Date': 1781827200000,
    });
    expect(r.orderNumber).toBe('#MBLVD29149');
    expect(r.logUniqueCode).toBe('PK-20507');
    expect(r.weightKg).toBe(0.8);
    expect(r.dims).toEqual({ l: 40, w: 31, h: 2 });
    expect(r.trackingNumber).toBe('25G8E12S');
    expect(r.carrierKey).toBe('fedex');
    expect(r.labelDate?.getTime()).toBe(1781827200000);
    expect(r.warnings).toEqual([]);
  });
  it('field dạng rich [{text}] → đọc được', () => {
    const r = parsePackRow({ 'Order Number': [{ text: 'TA2017', type: 'text' }], 'Couriers': [{ text: 'DHL' }] });
    expect(r.orderNumber).toBe('TA2017');
    expect(r.carrierKey).toBe('dhl');
  });
  it('dims 2 chiều → h null', () => {
    expect(parsePackRow({ 'Dimension ( điền tay)': '28x42' }).dims).toEqual({ l: 28, w: 42, h: null });
  });
  it('dims rác → null', () => {
    expect(parsePackRow({ 'Dimension ( điền tay)': 'abc' }).dims).toBeNull();
  });
  it('cân <=0 / NaN / >100 → null + warning', () => {
    expect(parsePackRow({ 'Weights': '0' }).weightKg).toBeNull();
    expect(parsePackRow({ 'Weights': 'x' }).weightKg).toBeNull();
    const big = parsePackRow({ 'Weights': '250' });
    expect(big.weightKg).toBeNull();
    expect(big.warnings.some((w) => w.includes('cân'))).toBe(true);
  });
  it('carrier lạ → null + warning', () => {
    const r = parsePackRow({ 'Couriers': 'UPS' });
    expect(r.carrierKey).toBeNull();
    expect(r.warnings.some((w) => w.toLowerCase().includes('carrier'))).toBe(true);
  });
  it('trống hết → orderNumber rỗng, các field null', () => {
    const r = parsePackRow({});
    expect(r.orderNumber).toBe('');
    expect(r.weightKg).toBeNull();
    expect(r.dims).toBeNull();
    expect(r.carrierKey).toBeNull();
  });
});
