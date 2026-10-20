import { describe, expect, it } from 'vitest';
import { nhanThangCreditNote } from './credit-note-nhan';

describe('nhanThangCreditNote', () => {
  it('có cả credit và debit → nhãn mang ĐỦ bốn con số', () => {
    const s = nhanThangCreditNote({ thang: '2026-10', tong: 5_400_000, n: 3, tongDebit: 1_200_000, nDebit: 1 });
    // Bốn con số này là bốn việc khác nhau: tiền thu hồi, số chứng từ thu hồi, tiền trả
    // thêm, số chứng từ trả thêm. Nhãn phải vừa một chip mà KHÔNG được rụng cái nào.
    expect(s).toContain('5.400.000đ');
    expect(s).toContain('(3)');
    expect(s).toContain('1.200.000đ');
    expect(s).toContain('(1)');
    expect(s).toContain('2026-10');
  });

  it('tháng không có billing note → không thêm "trả thêm 0đ" vào chip', () => {
    const s = nhanThangCreditNote({ thang: '2026-09', tong: 900_000, n: 2, tongDebit: 0, nDebit: 0 });
    expect(s).toBe('2026-09: thu hồi 900.000đ (2)');
  });

  it('tiền lẻ → làm tròn, không in số thập phân', () => {
    const s = nhanThangCreditNote({ thang: '2026-08', tong: 1_000_000.4, n: 1, tongDebit: 0, nDebit: 0 });
    expect(s).toBe('2026-08: thu hồi 1.000.000đ (1)');
  });
});
