import { describe, it, expect } from 'vitest';
import { chuyenDuoc, suaDongDuoc, suaGiaVonDuoc } from './trang-thai';

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
