import { describe, it, expect } from 'vitest';
import { docMaTem, maTemDong } from './ma-tem';

describe('docMaTem', () => {
  it('WH-8 số → tem món, chuẩn hoá chữ hoa và bỏ khoảng trắng', () => {
    expect(docMaTem('WH-00009890')).toEqual({ loai: 'mon', unitCode: 'WH-00009890' });
    expect(docMaTem('  wh-00009890 \n')).toEqual({ loai: 'mon', unitCode: 'WH-00009890' });
  });
  it('L:<số> → tem dòng đơn', () => {
    expect(docMaTem('L:18158666023207')).toEqual({ loai: 'dong', shopifyLineId: '18158666023207' });
    expect(docMaTem('l:18158666023207')).toEqual({ loai: 'dong', shopifyLineId: '18158666023207' });
  });
  it('chuỗi lạ → null (không đoán SKU, không đoán số trần)', () => {
    expect(docMaTem('')).toBeNull();
    expect(docMaTem('18158666023207')).toBeNull();
    expect(docMaTem('WH-123')).toBeNull();
    expect(docMaTem('SKU-ABC-XL')).toBeNull();
    expect(docMaTem('L:abc')).toBeNull();
  });
});

describe('maTemDong', () => {
  it('nối tiền tố L:', () => {
    expect(maTemDong('18158666023207')).toBe('L:18158666023207');
  });
});
