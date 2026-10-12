import { describe, it, expect } from 'vitest';
import { kiemTraTracking } from './luu-tracking';

describe('kiemTraTracking', () => {
  it('mã hợp lệ thì qua', () => {
    expect(kiemTraTracking('876817928550', false)).toEqual({ ok: true, tracking: '876817928550' });
  });

  it('bóc được từ URL', () => {
    expect(kiemTraTracking('https://www.fedex.com/fedextrack/?trknbr=876817928550', false))
      .toEqual({ ok: true, tracking: '876817928550' });
  });

  it('không bóc được thì báo lỗi nói rõ phải làm gì', () => {
    const r = kiemTraTracking('abc xyz', false);
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain('mã vận đơn');
  });

  /* Review Focus #4: hai kiện cùng một mã làm hỏng mọi phép nối theo tracking —
   * khoá ghép của hệ thống là MÃ VẬN ĐƠN (Decisions dòng 511). */
  it('mã đã thuộc kiện khác thì CHẶN', () => {
    const r = kiemTraTracking('876817928550', true);
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain('kiện khác');
  });

  /* Mã không bóc được PHẢI báo lỗi bóc mã, không phải lỗi trùng kiện — kể cả khi
   * caller (lỡ) truyền dangDungOKienKhac=true cho một chuỗi vô nghĩa. Thứ tự kiểm
   * tra sai sẽ khiến người dùng sửa nhầm thứ (tưởng trùng kiện, thật ra gõ sai mã). */
  it('mã không bóc được thì báo lỗi bóc mã trước, dù cờ trùng kiện có true', () => {
    const r = kiemTraTracking('abc xyz', true);
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain('mã vận đơn');
  });
});
