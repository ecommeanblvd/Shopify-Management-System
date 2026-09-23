import { describe, it, expect } from 'vitest';
import { docMaTem, maTemDong, maTemBienThe, maTemDon } from './ma-tem';

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

describe('mã biến thể và mã đơn', () => {
  it('V:<số> → tem biến thể', () => {
    expect(docMaTem('V:222333444')).toEqual({ loai: 'bien_the', shopifyVariantId: '222333444' });
    expect(docMaTem('v:222333444')).toEqual({ loai: 'bien_the', shopifyVariantId: '222333444' });
  });
  it('O:<số> → mã đơn', () => {
    expect(docMaTem('O:555666777')).toEqual({ loai: 'don', shopifyOrderId: '555666777' });
  });
  it('gid Shopify đầy đủ cũng đọc được (dán từ Shopify ra)', () => {
    expect(docMaTem('V:gid://shopify/ProductVariant/222')).toEqual({ loai: 'bien_the', shopifyVariantId: '222' });
    expect(docMaTem('L:gid://shopify/LineItem/111')).toEqual({ loai: 'dong', shopifyLineId: '111' });
    expect(docMaTem('O:gid://shopify/Order/999')).toEqual({ loai: 'don', shopifyOrderId: '999' });
  });
  it('vẫn từ chối chuỗi trần và mã lạ', () => {
    expect(docMaTem('222333444')).toBeNull();
    expect(docMaTem('V:abc')).toBeNull();
    expect(docMaTem('X:123')).toBeNull();
  });
  it('sinh mã in vào tem', () => {
    expect(maTemBienThe('gid://shopify/ProductVariant/222')).toBe('V:222');
    expect(maTemDon('gid://shopify/Order/999')).toBe('O:999');
    expect(maTemDong('gid://shopify/LineItem/111')).toBe('L:111');
  });
});
