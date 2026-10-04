import { describe, expect, it } from 'vitest';
import { vendorTuGoi } from './vendor-san-pham';

describe('vendorTuGoi', () => {
  it('giữ NGUYÊN VĂN — không đổi hoa thường, không bỏ dấu', () => {
    expect(vendorTuGoi('TINH Atelier')).toBe('TINH Atelier');
    expect(vendorTuGoi('À TOUS')).toBe('À TOUS');
    expect(vendorTuGoi('lekieu')).toBe('lekieu');
    expect(vendorTuGoi('Đệ Nhất')).toBe('Đệ Nhất');
  });

  it('cắt khoảng trắng hai đầu, giữ nguyên bên trong', () => {
    expect(vendorTuGoi('  Mirer  ')).toBe('Mirer');
    expect(vendorTuGoi('Tom  Fried')).toBe('Tom  Fried');
  });

  /* MMP chốt: gói không có trường vendor → giữ nguyên vendor đang có, KHÔNG ghi rỗng. */
  it('vắng trường → null, để người gọi giữ nguyên giá trị cũ', () => {
    expect(vendorTuGoi(undefined)).toBeNull();
    expect(vendorTuGoi(null)).toBeNull();
  });

  it('chuỗi rỗng hay toàn khoảng trắng cũng là null — không phải một quyết định', () => {
    expect(vendorTuGoi('')).toBeNull();
    expect(vendorTuGoi('   ')).toBeNull();
  });

  it('kiểu lạ không làm nổ', () => {
    expect(vendorTuGoi(123 as unknown as string)).toBeNull();
    expect(vendorTuGoi({} as unknown as string)).toBeNull();
  });
});
