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
  it('số âm và cách nghìn bằng khoảng trắng', () => {
    expect(docTien('-1.657.500 ₫')).toBe(-1657500);
    expect(docTien('1 861 500 ₫')).toBe(1861500);
  });
  it('phẩy-nghìn (xlsx xuất từ Google Sheet)', () => {
    expect(docTien('2,152,000 ₫')).toBe(2152000);
    expect(docTien('200,000 ₫')).toBe(200000);
    expect(docTien('-2,550,000 ₫')).toBe(-2550000);
  });
  it('một dấu, không đủ 3 chữ số sau → dấu thập phân', () => {
    expect(docTien('1,5')).toBe(1.5);
    expect(docTien('1.5')).toBe(1.5);
    expect(docTien('12,50')).toBe(12.5);
  });
  it('cả hai dấu cùng xuất hiện → dấu sau cùng là thập phân', () => {
    expect(docTien('1,234.56')).toBe(1234.56);
    expect(docTien('1.234,56')).toBe(1234.56);
  });
});
describe('docPhanTram', () => {
  it('35% → 0.35, số thô giữ nguyên, rỗng → null', () => {
    expect(docPhanTram('35%')).toBe(0.35); expect(docPhanTram(0.4)).toBe(0.4); expect(docPhanTram('')).toBeNull();
  });
  it('dấu phẩy làm dấu thập phân', () => {
    expect(docPhanTram('0,35')).toBe(0.35);
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
  it('kỳ trùng → giữ thứ tự đầu vào (stable sort)', () => {
    const duplicateRates = [{ from: 'USD', to: 'VND', period: '2026-06', rate: 26000 }, { from: 'USD', to: 'VND', period: '2026-06', rate: 26999 }];
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-06', duplicateRates)).toEqual({ amount: 260000, rate: 26000, periodDung: '2026-06', tam: false });
    const reversedRates = [{ from: 'USD', to: 'VND', period: '2026-06', rate: 26999 }, { from: 'USD', to: 'VND', period: '2026-06', rate: 26000 }];
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-06', reversedRates)).toEqual({ amount: 269990, rate: 26999, periodDung: '2026-06', tam: false });
  });
});
