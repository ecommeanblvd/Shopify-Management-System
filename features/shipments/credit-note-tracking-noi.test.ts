import { describe, it, expect } from 'vitest';
import { noiChungTuVoiKien, type KienNoiDuoc } from './credit-note-tracking';

const kienCo = (m: Record<string, string>) => (ma: string): KienNoiDuoc | null =>
  m[ma] ? { tracking: ma, maDon: m[ma], nguon: 'shopify' } : null;

describe('noiChungTuVoiKien', () => {
  it('FedEx ghi mã vận đơn ngay đầu nội dung → nối được kiện', () => {
    // Ca thật: 1K26TFA-45602 nội dung "876291039886 VN SA" → #MBLVD29877.
    const r = noiChungTuVoiKien('876291039886 VN SA', [], kienCo({ '876291039886': '#MBLVD29877' }));
    expect(r.kien).toEqual([{ tracking: '876291039886', maDon: '#MBLVD29877', nguon: 'shopify' }]);
    expect(r.vuongMac).toBeNull();
  });

  it('DHL không ghi mã vận đơn → nói rõ VÌ SAO, không để trống', () => {
    // Ca thật: "Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723. Số tham chiếu DHL…"
    const nd = 'Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723. Số tham chiếu DHL (27/08/2026): HANR000284295';
    const r = noiChungTuVoiKien(nd, ['HANR000284295'], kienCo({}));
    expect(r.kien).toEqual([]);
    expect(r.vuongMac).toContain('mã tham chiếu của hãng');
  });

  it('số tài khoản 9 chữ số KHÔNG bị nhận nhầm thành mã vận đơn', () => {
    const r = noiChungTuVoiKien('Số tài khoản: 527888723.', [], kienCo({}));
    expect(r.maLa).toEqual([]);
  });

  it('bóc được mã nhưng không kiện nào mang mã đó → nói đúng thế', () => {
    // Ca thật: 875849572911 trên tờ 1K26TFA-44519, không có trong shipments lẫn ship_ho.
    const r = noiChungTuVoiKien('875849572911 AE SA', [], kienCo({}));
    expect(r.kien).toEqual([]);
    expect(r.maLa).toEqual(['875849572911']);
    expect(r.vuongMac).toContain('không kiện nào trong hệ thống');
  });

  it('nối được kiện thì thôi báo vướng mắc, kể cả khi còn mã lạ', () => {
    const r = noiChungTuVoiKien('876291039886 và 999999999999', [], kienCo({ '876291039886': '#A' }));
    expect(r.kien).toHaveLength(1);
    expect(r.maLa).toEqual(['999999999999']);
    expect(r.vuongMac).toBeNull();
  });

  it('nội dung rỗng → nói rõ là không có mã nào', () => {
    expect(noiChungTuVoiKien(null, null, kienCo({})).vuongMac).toContain('không có mã vận đơn');
  });
});
