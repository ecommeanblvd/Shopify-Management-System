import { describe, it, expect } from 'vitest';
import { docTien, docPhanTram, doiTienTheoThang } from './tien';

describe('docTien', () => {
  it('đọc dạng VN có ₫ và dấu chấm nghìn', () => {
    expect(docTien('1.861.500 ₫')).toBe(1861500);
    expect(docTien('9.770.560 đ')).toBe(9770560);
    expect(docTien('2650000')).toBe(2650000);
    expect(docTien(1374000)).toBe(1374000);
  });
  it('rỗng / chữ / phần trăm → null', () => {
    expect(docTien('')).toBeNull(); expect(docTien(null)).toBeNull();
    expect(docTien('Insert Price')).toBeNull(); expect(docTien('35%')).toBeNull();
  });
});
describe('docPhanTram', () => {
  it('35% → 0.35, số thô giữ nguyên, rỗng → null', () => {
    expect(docPhanTram('35%')).toBe(0.35); expect(docPhanTram(0.4)).toBe(0.4); expect(docPhanTram('')).toBeNull();
  });
});
describe('doiTienTheoThang', () => {
  const rates = [{ from: 'USD', to: 'VND', period: '2026-06', rate: 26000 }, { from: 'USD', to: 'VND', period: '2026-08', rate: 26500 }];
  it('cùng tiền → rate 1, không tạm', () => {
    expect(doiTienTheoThang(100, 'VND', 'VND', '2026-01', [])).toEqual({ amount: 100, rate: 1, periodDung: '2026-01', tam: false });
  });
  it('có tỉ giá đúng tháng', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-08', rates)).toEqual({ amount: 265000, rate: 26500, periodDung: '2026-08', tam: false });
  });
  it('thiếu tháng → dùng tháng gần nhất TRƯỚC đó, cờ tạm', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-07', rates)).toEqual({ amount: 260000, rate: 26000, periodDung: '2026-06', tam: true });
  });
  it('không có tháng nào trước → null', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-05', rates)).toBeNull();
  });
});
