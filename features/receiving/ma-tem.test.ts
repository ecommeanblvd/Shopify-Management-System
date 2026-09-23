import { describe, it, expect } from 'vitest';
import { docMaTem, maTemDong, maTemBienThe, maTemDon, soIdShopify } from './ma-tem';

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
    expect(docMaTem('o:555666777')).toEqual({ loai: 'don', shopifyOrderId: '555666777' });
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
  it('gid tự mâu thuẫn với tiền tố → null, không đoán', () => {
    // gid nói rõ đây là Order nhưng tiền tố là V: — copy/paste nhầm loại, không được suy đoán.
    expect(docMaTem('V:gid://shopify/Order/123')).toBeNull();
    // gid nói rõ đây là Product (không phải LineItem) nhưng tiền tố là L:.
    expect(docMaTem('L:gid://shopify/Product/9')).toBeNull();
  });
  it('sinh mã in vào tem', () => {
    expect(maTemBienThe('gid://shopify/ProductVariant/222')).toBe('V:222');
    expect(maTemDon('gid://shopify/Order/999')).toBe('O:999');
    expect(maTemDong('gid://shopify/LineItem/111')).toBe('L:111');
  });
  it('sinh mã từ số trần (không chỉ gid)', () => {
    expect(maTemBienThe('222333444')).toBe('V:222333444');
    expect(maTemDon('555666777')).toBe('O:555666777');
  });
  it('id không có chữ số → không sinh được mã đọc lại được, trả về null', () => {
    expect(maTemDong('abc')).toBeNull();
    expect(maTemBienThe('abc')).toBeNull();
    expect(maTemDon('abc')).toBeNull();
  });
});

describe('soIdShopify — nguồn rút số DUY NHẤT để so id DB với khoá trên tem', () => {
  it('rút số cuối của gid đầy đủ như DB đang lưu', () => {
    // Dạng thật trong DB (đo 23/09/2026: 6225/6225 dòng lark_mon_don là gid).
    expect(soIdShopify('gid://shopify/LineItem/14593977155752')).toBe('14593977155752');
    expect(soIdShopify('gid://shopify/ProductVariant/45163940544678')).toBe('45163940544678');
    expect(soIdShopify('gid://shopify/Order/6789012345678')).toBe('6789012345678');
  });
  it('số trần giữ nguyên — rút hai lần vẫn ra cùng kết quả', () => {
    expect(soIdShopify('14593977155752')).toBe('14593977155752');
    expect(soIdShopify(soIdShopify('gid://shopify/LineItem/14593977155752')!)).toBe('14593977155752');
  });
  it('id DB (gid) và khoá đọc từ tem (số trần) rút ra bằng nhau — bất biến cả hệ dựa vào', () => {
    // Đi trọn vòng thật: id trong DB → chuỗi in lên tem → đọc lại từ tem → rút số của id DB.
    const idTrongDb = 'gid://shopify/LineItem/14593977155752';
    const maTem = maTemDong(idTrongDb);
    expect(maTem).toBe('L:14593977155752');
    const doc = docMaTem(maTem!);
    expect(doc).toEqual({ loai: 'dong', shopifyLineId: '14593977155752' });
    expect(soIdShopify(idTrongDb)).toBe(doc && 'shopifyLineId' in doc ? doc.shopifyLineId : null);
  });
  it('id không chứa chữ số → null, KHÔNG bịa', () => {
    expect(soIdShopify('abc')).toBeNull();
    expect(soIdShopify('')).toBeNull();
  });
});
