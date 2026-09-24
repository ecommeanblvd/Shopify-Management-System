import { describe, it, expect } from 'vitest';
import { boDauTiengViet } from './bo-dau';

describe('boDauTiengViet', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(boDauTiengViet('Áo Dài Lụa Đỏ')).toBe('ao dai lua do');
  });
  it('đ hoa và thường đều thành d', () => {
    expect(boDauTiengViet('ĐẦM')).toBe('dam');
    expect(boDauTiengViet('đầm')).toBe('dam');
  });
  it('phủ đủ 7 nhóm nguyên âm tiếng Việt', () => {
    expect(boDauTiengViet('ăâàáảãạ')).toBe('aaaaaaa');
    expect(boDauTiengViet('êèéẻẽẹ')).toBe('eeeeee');
    expect(boDauTiengViet('ôơòóỏõọ')).toBe('ooooooo');
    expect(boDauTiengViet('ưùúủũụ')).toBe('uuuuuu');
    expect(boDauTiengViet('ỳýỷỹỵ')).toBe('yyyyy');
    expect(boDauTiengViet('ìíỉĩị')).toBe('iiiii');
  });
  it('chữ không dấu và số giữ nguyên', () => {
    expect(boDauTiengViet('REN-unknown2-S-PIN')).toBe('ren-unknown2-s-pin');
  });
  it('gõ sẵn không dấu thì không đổi gì — tìm vẫn khớp', () => {
    expect(boDauTiengViet('ao dai')).toBe('ao dai');
  });
});
