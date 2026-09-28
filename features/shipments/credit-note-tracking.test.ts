import { describe, expect, it } from 'vitest';
import { maVanDonTrongChungTu } from './credit-note-tracking';

describe('maVanDonTrongChungTu', () => {
  it('nội dung FedEx thật → bóc đúng mã vận đơn', () => {
    expect(maVanDonTrongChungTu('876291039886 VN SA')).toEqual(['876291039886']);
    expect(maVanDonTrongChungTu('875849572911 AE SA')).toEqual(['875849572911']);
  });

  it('nội dung DHL thật → KHÔNG bóc nhầm số tài khoản hay ngày tháng', () => {
    const dhl = 'Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723. Số tham chiếu DHL '
      + '(27/08/2026): HANR000284295, HANR000284299. Điều chỉnh giảm cho hóa đơn Mẫu số 1 '
      + 'Ký hiệu K26THE số 13614 cấp ngày 28/01/2026.';
    expect(maVanDonTrongChungTu(dhl)).toEqual([]);
  });

  it('số tài khoản 9 chữ số ngay dưới ngưỡng → bỏ qua', () => {
    expect(maVanDonTrongChungTu('Số tài khoản: 527888723')).toEqual([]);
  });

  it('nhiều mã trong một chứng từ → lấy hết, không trùng lặp', () => {
    expect(maVanDonTrongChungTu('876291039886 và 875849572911 và 876291039886').sort())
      .toEqual(['875849572911', '876291039886']);
  });

  it('mã Aramex 11 chữ số cũng bắt được', () => {
    expect(maVanDonTrongChungTu('35278977123 SA')).toEqual(['35278977123']);
  });

  it('dãy dài hơn 14 chữ số là thứ khác → bỏ qua, thà sót còn hơn gỡ oan sai', () => {
    expect(maVanDonTrongChungTu('123456789012345')).toEqual([]);
  });

  it('rỗng / null → mảng rỗng', () => {
    expect(maVanDonTrongChungTu(null)).toEqual([]);
    expect(maVanDonTrongChungTu('')).toEqual([]);
    expect(maVanDonTrongChungTu('không có số nào')).toEqual([]);
  });
});
