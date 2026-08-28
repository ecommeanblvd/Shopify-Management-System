import { describe, expect, it } from 'vitest';
import { nhanDangXmlHoaDon } from './nhan-dang-xml';

describe('nhanDangXmlHoaDon', () => {
  it('nhận ra file tải từ FedEx Billing Online', () => {
    const r = nhanDangXmlHoaDon('<Download><Invoice_Download><Số_vận_đơn_hàng_không>123</Số_vận_đơn_hàng_không></Invoice_Download></Download>');
    expect(r.loai).toBe('fedex_fbo');
  });

  // FedEx Việt Nam phát hành hoá đơn GTGT điện tử theo cùng chuẩn TT78 với
  // Hợp Nhất — file XML trông rất giống nhau nên rất dễ tải nhầm vào chỗ FBO.
  it('nhận ra hoá đơn điện tử Việt Nam', () => {
    const r = nhanDangXmlHoaDon('<HDon><DLHDon><TTChung><SHDon>123</SHDon></TTChung></DLHDon></HDon>');
    expect(r.loai).toBe('hoa_don_dien_tu_vn');
  });

  it('nhận ra hoá đơn DHL', () => {
    expect(nhanDangXmlHoaDon('<Invoice><ID>HANR1</ID></Invoice>').loai).toBe('dhl');
  });

  // Thông báo cụt "không đúng định dạng" không cho biết gì; nêu thẻ gốc để
  // người dùng gửi đúng thông tin khi báo lỗi.
  it('XML lạ thì nêu thẻ gốc để dễ báo lỗi', () => {
    const r = nhanDangXmlHoaDon('<?xml version="1.0"?><SomethingElse><A/></SomethingElse>');
    expect(r.loai).toBe('khac');
    expect(r.theGoc).toBe('SomethingElse');
  });

  it('bỏ qua khai báo xml và khoảng trắng khi tìm thẻ gốc', () => {
    expect(nhanDangXmlHoaDon('\n  <?xml version="1.0" encoding="utf-8"?>\n<Root/>').theGoc).toBe('Root');
  });

  it('file rỗng hoặc không phải XML', () => {
    expect(nhanDangXmlHoaDon('').loai).toBe('khac');
    expect(nhanDangXmlHoaDon('hello').theGoc).toBeNull();
  });
});
