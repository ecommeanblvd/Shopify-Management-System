import { describe, expect, it } from 'vitest';
import { chuanHoaDanhSachPostcode } from './remote-postcode-filter';

describe('chuanHoaDanhSachPostcode', () => {
  it('trả cả dạng gốc và dạng bỏ ký tự ngăn cách', () => {
    const r = chuanHoaDanhSachPostcode(['5000-289']);
    expect(r.goc).toContain('5000-289');
    expect(r.rutGon).toContain('5000289');
  });

  it('viết hoa và cắt khoảng trắng thừa', () => {
    const r = chuanHoaDanhSachPostcode([' sw1a 1aa ']);
    expect(r.goc).toContain('SW1A 1AA');
    expect(r.rutGon).toContain('SW1A1AA');
  });

  it('bỏ trùng lặp', () => {
    const r = chuanHoaDanhSachPostcode(['10001', '10001', ' 10001 ']);
    expect(r.goc).toEqual(['10001']);
    expect(r.rutGon).toEqual(['10001']);
  });

  it('bỏ giá trị rỗng và null', () => {
    const r = chuanHoaDanhSachPostcode(['', '   ', null, undefined, '10001']);
    expect(r.goc).toEqual(['10001']);
  });

  it('danh sách rỗng → cả hai đều rỗng (gọi bên ngoài sẽ bỏ qua bộ lọc)', () => {
    const r = chuanHoaDanhSachPostcode([]);
    expect(r.goc).toEqual([]);
    expect(r.rutGon).toEqual([]);
  });

  it('mã đã sạch thì hai dạng trùng nhau, không sinh dòng thừa', () => {
    const r = chuanHoaDanhSachPostcode(['10001']);
    expect(r.goc).toEqual(['10001']);
    expect(r.rutGon).toEqual(['10001']);
  });

  it('giữ chữ và số, bỏ mọi ký tự khác khi rút gọn', () => {
    expect(chuanHoaDanhSachPostcode(['A1B 2C3']).rutGon).toContain('A1B2C3');
    expect(chuanHoaDanhSachPostcode(['123.456/78']).rutGon).toContain('12345678');
  });

  // Engine (remote-match.ts) khớp lần lượt: gốc → rút gọn → TIỀN TỐ trước dấu
  // ngăn cách. Thiếu tiền tố là trượt dòng ODA thật → tính thiếu phụ phí.
  it('thêm tiền tố ZIP+4: 98077-5629 phải tra được dòng 98077', () => {
    const r = chuanHoaDanhSachPostcode(['98077-5629']);
    expect(r.goc).toContain('98077-5629');
    expect(r.rutGon).toContain('980775629');
    expect(r.rutGon).toContain('98077');
  });

  it('thêm tiền tố khi ngăn cách bằng khoảng trắng', () => {
    expect(chuanHoaDanhSachPostcode(['SW1A 1AA']).rutGon).toContain('SW1A');
  });

  it('mã không có dấu ngăn cách thì không sinh tiền tố thừa', () => {
    expect(chuanHoaDanhSachPostcode(['10001']).rutGon).toEqual(['10001']);
  });
});
