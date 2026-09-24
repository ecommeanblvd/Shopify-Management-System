import { describe, it, expect } from 'vitest';
import { chuanHoaMaDon } from './ma-don';

describe('chuanHoaMaDon', () => {
  it('bỏ # đầu — lark_mon_don lưu "MBLVD26763", shopify_orders lưu "#MBLVD2009"', () => {
    expect(chuanHoaMaDon('#MBLVD26763')).toBe('MBLVD26763');
    expect(chuanHoaMaDon('MBLVD26763')).toBe('MBLVD26763');
  });
  it('cắt khoảng trắng hai đầu', () => {
    expect(chuanHoaMaDon('  #MBLVD26763  ')).toBe('MBLVD26763');
  });
  it('hai dạng phải khớp nhau — cạm bẫy đã đo: ghép thẳng 597/7150, chuẩn hoá 6168/7150', () => {
    expect(chuanHoaMaDon('#MBLVD26763')).toBe(chuanHoaMaDon('MBLVD26763'));
  });
  it('chuỗi rỗng ra rỗng, không ném lỗi', () => {
    expect(chuanHoaMaDon('')).toBe('');
    expect(chuanHoaMaDon('   ')).toBe('');
  });
  it('chỉ bỏ MỘT dấu # ở đầu, không đụng # giữa chuỗi', () => {
    expect(chuanHoaMaDon('##A')).toBe('#A');
    expect(chuanHoaMaDon('A#B')).toBe('A#B');
  });
});
