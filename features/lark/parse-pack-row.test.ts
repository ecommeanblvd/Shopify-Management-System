import { describe, it, expect } from 'vitest';
import { parsePackRow } from './parse-pack-row';

describe('parsePackRow', () => {
  it('field string cơ bản → map đầy đủ', () => {
    const r = parsePackRow({
      'Order Number': '#MBLVD29149', 'Log Unique code': 'PK-20507',
      'Weights': '0.80', 'Dimension ( điền tay)': '40x31x2',
      'Tracking Number': '25G8E12S', 'Couriers': 'FedEx',
      // epoch = nửa đêm 08/06/2026 giờ VN (= 07/06 17:00 UTC)
      'Label Created Date': Date.UTC(2026, 5, 7, 17, 0, 0),
    });
    expect(r.orderNumber).toBe('#MBLVD29149');
    expect(r.logUniqueCode).toBe('PK-20507');
    expect(r.weightKg).toBe(0.8);
    expect(r.dims).toEqual({ l: 40, w: 31, h: 2 });
    expect(r.trackingNumber).toBe('25G8E12S');
    expect(r.carrierKey).toBe('fedex');
    // chuẩn hoá về nửa-đêm-ngày-lịch-VN (lưu thành 2026-06-08 00:00:00) → khớp mốc fuel
    expect(r.labelDate?.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(r.warnings).toEqual([]);
  });
  it('ngày Lark (epoch nửa đêm VN) → lưu nửa-đêm-ngày-VN, KHÔNG lệch về hôm trước', () => {
    // bug cũ: new Date(epoch) = 2026-06-07T17:00Z → đơn biên tuần fuel bị lệch.
    const r = parsePackRow({ 'Label Created Date': Date.UTC(2026, 5, 7, 17, 0, 0) });
    expect(r.labelDate?.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });
  it('bỏ Label Created Date ở TƯƠNG LAI (placeholder Lark cho đơn chưa ship) → null + warning', () => {
    // Lark điền "31/12/2026" cho đơn chưa ship → label ở tương lai là bất khả.
    const future = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // +10 năm, luôn future
    const r = parsePackRow({ 'Order Number': '#X', 'Label Created Date': future });
    expect(r.labelDate).toBeNull();
    expect(r.warnings.some((w) => w.includes('tương lai'))).toBe(true);
  });
  it('field dạng rich [{text}] → đọc được', () => {
    const r = parsePackRow({ 'Order Number': [{ text: 'TA2017', type: 'text' }], 'Couriers': [{ text: 'DHL' }] });
    expect(r.orderNumber).toBe('TA2017');
    expect(r.carrierKey).toBe('dhl');
  });
  it('Couriers = Aramex → carrierKey aramex', () => {
    expect(parsePackRow({ 'Order Number': '#X', 'Couriers': 'Aramex' }).carrierKey).toBe('aramex');
    expect(parsePackRow({ 'Order Number': '#Y', 'Couriers': [{ text: 'ARAMEX' }] }).carrierKey).toBe('aramex');
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
