import { describe, it, expect } from 'vitest';
import { macVanDonTu } from './ma-van-don';

describe('macVanDonTu', () => {
  it('số trần giữ nguyên', () => {
    expect(macVanDonTu('876817928550')).toBe('876817928550');
    expect(macVanDonTu('1Z2050VDD919649050')).toBe('1Z2050VDD919649050');
  });
  it('bóc từ URL FedEx', () => {
    expect(macVanDonTu('https://www.fedex.com/fedextrack/?trknbr=876817928550')).toBe('876817928550');
  });
  it('bóc từ URL UPS', () => {
    expect(macVanDonTu('https://www.ups.com/track?tracknum=1Z2050VDD919649050')).toBe('1Z2050VDD919649050');
  });
  it('tên tham số toàn chữ hoa cũng được', () => {
    expect(macVanDonTu('https://www.fedex.com/fedextrack/?TRKNBR=876817928550')).toBe('876817928550');
  });
  it('tên tham số hỗn hợp hoa thường cũng được', () => {
    expect(macVanDonTu('https://www.fedex.com/fedextrack/?TrkNbr=876817928550')).toBe('876817928550');
  });
  it('bỏ khoảng trắng và ký tự vô hình khi copy', () => {
    expect(macVanDonTu('  876817928550​ ')).toBe('876817928550');
  });
  /* Review Focus #1: URL lạ không có tham số mã → KHÔNG được đoán bừa một đoạn số
   * trong đường dẫn, vì mã sai trông y hệt mã đúng. */
  it('URL không nhận ra được thì trả null, không đoán', () => {
    expect(macVanDonTu('https://example.com/a/12345/b')).toBeNull();
  });
  it('cả câu có chữ thì trả null', () => {
    expect(macVanDonTu('mã của em là 876817928550 nhé')).toBeNull();
  });
  it('rỗng → null', () => { expect(macVanDonTu('   ')).toBeNull(); });
});
