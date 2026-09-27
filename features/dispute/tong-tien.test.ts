import { describe, it, expect } from 'vitest';
import { gomTheoTienTe, chuoiTongTien } from './tong-tien';

describe('gomTheoTienTe — chặn đúng lỗi cộng gộp tiền tệ của Lark', () => {
  it('KHÔNG cộng USD với KRW vào một số', () => {
    // Đúng dữ liệu thật của tinhatelier: gộp lại thành "284.232" là sai hoàn toàn.
    const r = gomTheoTienTe([
      { soTien: '897.00', tienTe: 'USD' },
      { soTien: '855.00', tienTe: 'USD' },
      { soTien: '279000', tienTe: 'KRW' },
      { soTien: '306.92', tienTe: 'EUR' },
      { soTien: '256.00', tienTe: 'CHF' },
    ]);
    expect(r).toEqual([
      { tienTe: 'KRW', tong: 279000, soCa: 1 },
      { tienTe: 'USD', tong: 1752, soCa: 2 },
      { tienTe: 'EUR', tong: 306.92, soCa: 1 },
      { tienTe: 'CHF', tong: 256, soCa: 1 },
    ]);
  });

  it('sắp theo tổng giảm dần', () => {
    const r = gomTheoTienTe([
      { soTien: 10, tienTe: 'EUR' },
      { soTien: 100, tienTe: 'USD' },
      { soTien: 50, tienTe: 'GBP' },
    ]);
    expect(r.map((x) => x.tienTe)).toEqual(['USD', 'GBP', 'EUR']);
  });

  it('hạ chữ thường của mã tiền về chuẩn hoa — usd và USD là một', () => {
    const r = gomTheoTienTe([
      { soTien: 1, tienTe: 'usd' },
      { soTien: 2, tienTe: 'USD' },
    ]);
    expect(r).toEqual([{ tienTe: 'USD', tong: 3, soCa: 2 }]);
  });

  it('BỎ QUA dòng thiếu đơn vị tiền — gộp chúng vào nhóm "?" là tái lập chính lỗi này', () => {
    const r = gomTheoTienTe([
      { soTien: 100, tienTe: 'USD' },
      { soTien: 999, tienTe: '' },
      { soTien: 999, tienTe: '  ' },
    ]);
    expect(r).toEqual([{ tienTe: 'USD', tong: 100, soCa: 1 }]);
  });

  it('BỎ QUA số không đọc được', () => {
    const r = gomTheoTienTe([
      { soTien: 100, tienTe: 'USD' },
      { soTien: 'không phải số', tienTe: 'USD' },
      { soTien: Number.NaN, tienTe: 'USD' },
    ]);
    expect(r).toEqual([{ tienTe: 'USD', tong: 100, soCa: 1 }]);
  });

  it('rỗng trả mảng rỗng', () => {
    expect(gomTheoTienTe([])).toEqual([]);
  });
});

describe('chuoiTongTien', () => {
  it('ghép từng đơn vị tiền, không có số gộp', () => {
    expect(chuoiTongTien([
      { tienTe: 'USD', tong: 29591.01, soCa: 42 },
      { tienTe: 'HKD', tong: 2353.33, soCa: 1 },
    ])).toBe('USD 29.591,01 · HKD 2.353,33');
  });

  it('rỗng trả dấu gạch chứ không phải "0"', () => {
    expect(chuoiTongTien([])).toBe('—');
  });
});
