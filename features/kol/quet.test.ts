import { describe, it, expect } from 'vitest';
import { dienGiaiQuetTaoDon, ghepTenBienThe } from './quet';

describe('dienGiaiQuetTaoDon', () => {
  it('V: chọn thẳng biến thể', () => {
    expect(dienGiaiQuetTaoDon('V:222333444')).toEqual({ ket: 'bien_the', shopifyVariantId: '222333444' });
  });
  it('V: cũng nhận gid đầy đủ', () => {
    expect(dienGiaiQuetTaoDon('V:gid://shopify/ProductVariant/222')).toEqual({ ket: 'bien_the', shopifyVariantId: '222' });
  });
  it('L: tra ngược biến thể của dòng đơn', () => {
    expect(dienGiaiQuetTaoDon('L:18158666023207')).toEqual({ ket: 'dong_don', shopifyLineId: '18158666023207' });
  });
  it('WH- (tem món kho nhận hàng) không áp dụng khi tạo đơn KOL', () => {
    expect(dienGiaiQuetTaoDon('WH-00009890')).toEqual({ ket: 'khong_ap_dung', loLoai: 'mon' });
  });
  it('O: (mã đơn Shopify) không áp dụng khi tạo đơn KOL', () => {
    expect(dienGiaiQuetTaoDon('O:555666777')).toEqual({ ket: 'khong_ap_dung', loLoai: 'don' });
  });
  it('chuỗi lạ (mã vạch của brand, không lưu trong hệ thống) → không nhận diện được', () => {
    expect(dienGiaiQuetTaoDon('1234567890123')).toEqual({ ket: 'khong_nhan_dang' });
    expect(dienGiaiQuetTaoDon('SKU-ABC-XL')).toEqual({ ket: 'khong_nhan_dang' });
    expect(dienGiaiQuetTaoDon('')).toEqual({ ket: 'khong_nhan_dang' });
  });
  it('gid tự mâu thuẫn với tiền tố → không nhận diện được, không đoán', () => {
    expect(dienGiaiQuetTaoDon('V:gid://shopify/Order/123')).toEqual({ ket: 'khong_nhan_dang' });
  });
});

describe('ghepTenBienThe', () => {
  it('có biến thể thì nối bằng em-dash', () => {
    expect(ghepTenBienThe('Áo dài lụa', 'M / Đỏ')).toBe('Áo dài lụa — M / Đỏ');
  });
  it('không có biến thể (null/undefined/rỗng) thì chỉ tên sản phẩm', () => {
    expect(ghepTenBienThe('Áo dài lụa', null)).toBe('Áo dài lụa');
    expect(ghepTenBienThe('Áo dài lụa', undefined)).toBe('Áo dài lụa');
    expect(ghepTenBienThe('Áo dài lụa', '   ')).toBe('Áo dài lụa');
  });
});
