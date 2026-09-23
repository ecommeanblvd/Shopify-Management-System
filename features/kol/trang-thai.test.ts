import { describe, it, expect } from 'vitest';
import { chuyenDuoc, suaDongDuoc, suaGiaVonDuoc, giaVonDangTrong, ghiGiaVonDuoc } from './trang-thai';

describe('chuyenDuoc', () => {
  it('đường đi bình thường', () => {
    expect(chuyenDuoc('nhap', 'da_chot')).toBe(true);
    expect(chuyenDuoc('da_chot', 'da_gui')).toBe(true);
  });
  it('lùi về nháp để sửa dòng thì được', () => {
    expect(chuyenDuoc('da_chot', 'nhap')).toBe(true);
  });
  it('huỷ được khi còn nháp hoặc đã chốt', () => {
    expect(chuyenDuoc('nhap', 'huy')).toBe(true);
    expect(chuyenDuoc('da_chot', 'huy')).toBe(true);
  });
  it('ĐÃ GỬI thì không huỷ và không lùi — hàng đi rồi thì đường về là hàng trả', () => {
    expect(chuyenDuoc('da_gui', 'huy')).toBe(false);
    expect(chuyenDuoc('da_gui', 'da_chot')).toBe(false);
    expect(chuyenDuoc('da_gui', 'nhap')).toBe(false);
  });
  it('đơn đã huỷ là điểm cuối', () => {
    expect(chuyenDuoc('huy', 'nhap')).toBe(false);
    expect(chuyenDuoc('huy', 'da_chot')).toBe(false);
  });
  it('không cho nhảy cóc từ nháp thẳng sang đã gửi', () => {
    expect(chuyenDuoc('nhap', 'da_gui')).toBe(false);
  });
  it('chuyển sang chính nó là không hợp lệ', () => {
    expect(chuyenDuoc('nhap', 'nhap')).toBe(false);
  });
});

describe('suaDongDuoc / suaGiaVonDuoc', () => {
  it('dòng hàng chỉ sửa khi còn nháp — sau khi chốt là đã giữ chỗ tồn', () => {
    expect(suaDongDuoc('nhap')).toBe(true);
    expect(suaDongDuoc('da_chot')).toBe(false);
    expect(suaDongDuoc('da_gui')).toBe(false);
    expect(suaDongDuoc('huy')).toBe(false);
  });
  it('giá vốn sửa được cả khi đã chốt vì nó không dính tồn, nhưng đông cứng khi đã gửi', () => {
    expect(suaGiaVonDuoc('nhap')).toBe(true);
    expect(suaGiaVonDuoc('da_chot')).toBe(true);
    expect(suaGiaVonDuoc('da_gui')).toBe(false);
    expect(suaGiaVonDuoc('huy')).toBe(false);
  });
});

describe('giaVonDangTrong', () => {
  it('null, chuỗi rỗng và chuỗi toàn khoảng trắng đều là TRỐNG', () => {
    expect(giaVonDangTrong(null)).toBe(true);
    expect(giaVonDangTrong('')).toBe(true);
    expect(giaVonDangTrong('   ')).toBe(true);
  });
  it('có số thì KHÔNG trống — kể cả số 0, vì 0 là một giá đã đặt', () => {
    expect(giaVonDangTrong('0')).toBe(false);
    expect(giaVonDangTrong('0.0000')).toBe(false);
    expect(giaVonDangTrong('120000')).toBe(false);
  });
});

describe('ghiGiaVonDuoc — điền một lần cho dòng đã gửi mà chưa có giá', () => {
  it('nháp / đã chốt: ghi thoải mái, có giá rồi vẫn sửa được (giữ nguyên luật cũ)', () => {
    expect(ghiGiaVonDuoc('nhap', null)).toBe(true);
    expect(ghiGiaVonDuoc('nhap', '100')).toBe(true);
    expect(ghiGiaVonDuoc('da_chot', null)).toBe(true);
    expect(ghiGiaVonDuoc('da_chot', '100')).toBe(true);
  });
  it('ĐÃ GỬI mà ô giá còn TRỐNG: cho ĐIỀN — nếu không dòng đó vô giá vĩnh viễn', () => {
    // Đo 23/09/2026: 110/2.911 mã có giá vốn không phân giải được cửa hàng nên
    // lúc gửi để null. Không có đường điền thì tiền của chúng không bao giờ vào
    // chi phí marketing.
    expect(ghiGiaVonDuoc('da_gui', null)).toBe(true);
    expect(ghiGiaVonDuoc('da_gui', '')).toBe(true);
    expect(ghiGiaVonDuoc('da_gui', '  ')).toBe(true);
  });
  it('ĐÃ GỬI mà đã CÓ giá: KHÔNG được đổi — giá đông cứng lúc gửi vẫn là đông cứng', () => {
    expect(ghiGiaVonDuoc('da_gui', '100')).toBe(false);
    expect(ghiGiaVonDuoc('da_gui', '0')).toBe(false);
  });
  it('đơn đã huỷ thì không ghi gì, trống hay không cũng vậy', () => {
    expect(ghiGiaVonDuoc('huy', null)).toBe(false);
    expect(ghiGiaVonDuoc('huy', '100')).toBe(false);
  });
  it('KHÔNG nới lỏng suaGiaVonDuoc: luật cũ vẫn nói đã gửi là không sửa', () => {
    expect(suaGiaVonDuoc('da_gui')).toBe(false);
  });
});
