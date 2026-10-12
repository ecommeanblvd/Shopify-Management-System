import { describe, it, expect } from 'vitest';
import { canhBaoLechHang, kiemTraTracking } from './luu-tracking';

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

describe('canhBaoLechHang', () => {
  /* I6: dán nhãn của kiện BÊN CẠNH (mã DHL 10 số) vào một kiện đi FedEx vẫn qua `macVanDonTu`
   * (nó nhận mọi chuỗi 8–35 ký tự chữ-số). Hai bên lệch chính là dấu hiệu dán nhầm dòng. */
  it('dạng mã chỉ hãng khác với hãng của kiện → cảnh báo nói rõ cả hai bên', () => {
    const c = canhBaoLechHang('1234567890', 'fedex');
    expect(c).toContain('DHL');
    expect(c).toContain('FEDEX');
  });
  it('khớp hãng → không nói gì', () => {
    expect(canhBaoLechHang('876817928550', 'fedex')).toBeNull();
  });
  /* Dạng mã lạ (không suy ra hãng) hay kiện chưa ghi hãng thì KHÔNG có gì để so — cảnh báo
   * bừa ở hai ca này là dạy nhân sự bỏ qua cảnh báo. */
  it('không suy ra được hãng từ mã, hoặc kiện chưa có hãng → không nói gì', () => {
    expect(canhBaoLechHang('ABC12345678', 'fedex')).toBeNull();
    expect(canhBaoLechHang('876817928550', null)).toBeNull();
  });
});
