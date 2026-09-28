import { describe, it, expect } from 'vitest';
import { BO_PHAN, boPhanHopLe, nhanBoPhan } from './bo-phan';

describe('danh sách bộ phận dùng chung', () => {
  it('là HỢP của hai bảng Lark: 6 bộ phận của bảng ticket + Product Portfolio của bảng sự cố', () => {
    expect(BO_PHAN.map((b) => b.ma)).toEqual([
      'CX-CS', 'MERCHANDISE', 'PROCUREMENT', 'DISCO-WH', 'DISCO-LOG', 'CHINA',
      'PRODUCT-PORTFOLIO',
    ]);
  });

  it('không có mã trùng', () => {
    expect(new Set(BO_PHAN.map((b) => b.ma)).size).toBe(BO_PHAN.length);
  });

  it('nhận mã đúng, từ chối mã sai chữ hoa chữ thường', () => {
    expect(boPhanHopLe('PROCUREMENT')).toBe(true);
    expect(boPhanHopLe('PRODUCT-PORTFOLIO')).toBe(true);
    expect(boPhanHopLe('procurement')).toBe(false);
    expect(boPhanHopLe('Warehouse')).toBe(false); // tên của bảng sự cố, phải dịch trước
    expect(boPhanHopLe('')).toBe(false);
  });

  it('nhãn đọc được, mã lạ giữ nguyên, null thành dấu gạch', () => {
    expect(nhanBoPhan('DISCO-WH')).toBe('Kho');
    expect(nhanBoPhan('PRODUCT-PORTFOLIO')).toBe('Product Portfolio');
    expect(nhanBoPhan('LẠ')).toBe('LẠ');
    expect(nhanBoPhan(null)).toBe('—');
  });
});
