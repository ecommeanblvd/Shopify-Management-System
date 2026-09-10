import { describe, it, expect } from 'vitest';
import { bamHoaDon, docHoaDonXml, maThamChieu, phanLoaiHoaDon } from './hoa-don-xml';

// Rút gọn từ file thật DHL gửi 04/09/2026 (hoá đơn 465 ký hiệu 1K26THA, credit note −3.453.840đ).
const XML = `<?xml version="1.0" encoding="UTF-8"?><HDon><DLHDon><TTChung>
<THDon>Hóa đơn giá trị gia tăng</THDon><KHMSHDon>1</KHMSHDon><KHHDon>K26THA</KHHDon><SHDon>465</SHDon>
<NLap>2026-08-27</NLap><DVTTe>VND</DVTTe></TTChung><NDHDon><NBan><Ten>CÔNG TY TNHH CHUYỂN PHÁT NHANH DHL - VNPT</Ten>
<MST>0304680974</MST></NBan><NMua><Ten>CONG TY CO PHAN INECSO</Ten><MST>0109894073</MST></NMua>
<DSHHDVu><HHDVu><THHDVu>Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723. Số tham chiếu DHL (27/08/2026):
HANR000284295, HANR000284299. Điều chỉnh giảm cho hóa đơn Mẫu số 1 Ký hiệu K26THE số 21237.</THHDVu>
<DGia>-3198000</DGia><ThTien>-3198000</ThTien></HHDVu></DSHHDVu>
<TToan><TgTCThue>-3198000</TgTCThue><TgTThue>-255840</TgTThue><TSuat>8%</TSuat>
<TgTTTBSo>-3453840</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;

describe('hoa-don-xml', () => {
  it('đọc đúng số, ký hiệu, ngày và tiền của credit note', () => {
    const h = docHoaDonXml(XML)!;
    expect(h.soHoaDon).toBe('465');
    expect(h.kyHieu).toBe('1K26THA');
    expect(h.ngay).toBe('2026-08-27');
    expect(h.truocThue).toBe(-3_198_000);
    expect(h.tienThue).toBe(-255_840);
    expect(h.tongCong).toBe(-3_453_840);
    expect(h.benBan).toContain('DHL');
  });
  it('bóc mã tham chiếu carrier từ nội dung hoá đơn', () => {
    const h = docHoaDonXml(XML)!;
    expect(maThamChieu(h.noiDung)).toEqual(['HANR000284295', 'HANR000284299']);
  });
  it('phân loại credit / billing note / hoá đơn cước kỳ', () => {
    expect(phanLoaiHoaDon({ tongCong: -3_453_840, noiDung: 'Điều chỉnh giảm cho hoá đơn 21237' }).loai).toBe('credit');
    expect(phanLoaiHoaDon({ tongCong: -100, noiDung: 'không ghi gì' }).loai).toBe('credit');
    expect(phanLoaiHoaDon({ tongCong: 12_000_000, noiDung: 'Điều chỉnh tăng cho hoá đơn 21237' }).loai).toBe('debit');
    // Hoá đơn cước kỳ: dương và KHÔNG có chữ "điều chỉnh" → không được xếp thành billing note.
    expect(phanLoaiHoaDon({ tongCong: 250_000_000, noiDung: 'Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723.' }).loai).toBe('cuoc_ky');
    expect(phanLoaiHoaDon({ tongCong: 0, noiDung: 'Hoá đơn điều chỉnh giảm cho hoá đơn số 21237' }).loai).toBe('credit');
  });
  it('file không phải hoá đơn hoặc thiếu ngày → null', () => {
    expect(docHoaDonXml('<root/>')).toBeNull();
    expect(docHoaDonXml('<HDon><SHDon>1</SHDon><NLap>rác</NLap></HDon>')).toBeNull();
    expect(docHoaDonXml('')).toBeNull();
  });
});

describe('bamHoaDon — vân tay chặn tải trùng', () => {
  const goc = { kyHieu: '1K26THA', soHoaDon: '465', ngay: '2026-08-27', truocThue: -3_198_000, tienThue: -255_840, tongCong: -3_453_840, noiDung: 'Điều chỉnh giảm cho hoá đơn 21237' };
  it('cùng nội dung → cùng vân tay, kể cả khi khoảng trắng khác nhau', () => {
    expect(bamHoaDon(goc)).toBe(bamHoaDon({ ...goc, noiDung: 'Điều chỉnh giảm   cho hoá đơn\n21237' }));
    expect(bamHoaDon(goc)).toBe(bamHoaDon({ ...goc, kyHieu: '1k26tha' })); // ký hiệu không phân biệt hoa thường
  });
  it('lệch bất kỳ trường tiền hay ngày nào → vân tay khác', () => {
    expect(bamHoaDon({ ...goc, tongCong: -3_453_841 })).not.toBe(bamHoaDon(goc));
    expect(bamHoaDon({ ...goc, ngay: '2026-08-28' })).not.toBe(bamHoaDon(goc));
    expect(bamHoaDon({ ...goc, soHoaDon: '466' })).not.toBe(bamHoaDon(goc));
  });
});
