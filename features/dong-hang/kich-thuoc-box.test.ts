import { describe, test, expect } from 'vitest';
import { docKichThuoc } from './kich-thuoc-box';

describe('docKichThuoc', () => {
  test('ba số', () => {
    expect(docKichThuoc('40x30x20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
    expect(docKichThuoc('37x30x9.5')).toEqual({ daiCm: 37, rongCm: 30, caoCm: 9.5 });
  });

  test('HAI số → caoCm null, KHÔNG phải 0', () => {
    expect(docKichThuoc('28x42')).toEqual({ daiCm: 28, rongCm: 42, caoCm: null });
    expect(docKichThuoc('15x10.7')).toEqual({ daiCm: 15, rongCm: 10.7, caoCm: null });
  });

  test('chấp nhận dấu nhân và khoảng trắng người gõ', () => {
    expect(docKichThuoc('40 × 30 × 20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
    expect(docKichThuoc('40X30X20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
  });

  test('chấp nhận dấu phẩy thập phân VN', () => {
    expect(docKichThuoc('37x30x9,5')).toEqual({ daiCm: 37, rongCm: 30, caoCm: 9.5 });
    expect(docKichThuoc('15x10,7')).toEqual({ daiCm: 15, rongCm: 10.7, caoCm: null });
  });

  test('ba số: nếu số thứ 3 là 0, âm, hay không phân tích được → null', () => {
    expect(docKichThuoc('40x30x0')).toBeNull();
    expect(docKichThuoc('40x30x-5')).toBeNull();
    expect(docKichThuoc('40x30xabc')).toBeNull();
  });

  test('không đọc được → null', () => {
    for (const x of [null, undefined, '', '  ', 'to', '40', '40x30x20x10', '40xabc', '0x30x20', '-4x3x2']) {
      expect(docKichThuoc(x)).toBeNull();
    }
  });
});
