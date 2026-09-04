import { describe, it, expect } from 'vitest';
import { khopBienThe, sanPhamCha } from './noi-shopify';

const sp = (id: string, sku: string, productId = 'P1') => ({ id, sku, productId });

describe('khopBienThe', () => {
  it('mã trùng khít → khớp chính xác', () => {
    const r = khopBienThe([{ id: 'a', sku: 'BSSDL035-Pink-L' }], [sp('v1', 'BSSDL035-Pink-L')]);
    expect(r[0]).toMatchObject({ shopifyVariantId: 'v1', kieu: 'chinh_xac' });
  });

  it('ca THẬT Calista: Shopify có tiền tố brand, MMP không', () => {
    const r = khopBienThe([{ id: 'a', sku: 'VECLAT13-L-GRA' }], [sp('v1', 'Calista-VECLAT13-L-GRA')]);
    expect(r[0]).toMatchObject({ shopifyVariantId: 'v1', kieu: 'bo_tien_to' });
  });

  it('ngược lại: MMP có tiền tố, Shopify không', () => {
    const r = khopBienThe([{ id: 'a', sku: 'Montsand-a113-L' }], [sp('v1', 'a113-L')]);
    expect(r[0]).toMatchObject({ shopifyVariantId: 'v1', kieu: 'bo_tien_to' });
  });

  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    const r = khopBienThe([{ id: 'a', sku: ' veclat13-l-gra ' }], [sp('v1', 'VECLAT13-L-GRA')]);
    expect(r[0].kieu).toBe('chinh_xac');
  });

  it('HAI biến thể Shopify cùng khớp đuôi → nhập nhằng, KHÔNG nối', () => {
    const r = khopBienThe([{ id: 'a', sku: 'A13-L' }], [sp('v1', 'Calista-A13-L'), sp('v2', 'Montsand-A13-L')]);
    expect(r[0]).toMatchObject({ shopifyVariantId: null, kieu: 'nhap_nhang' });
  });

  it('trùng mã tuyệt đối ở hai biến thể → cũng nhập nhằng', () => {
    const r = khopBienThe([{ id: 'a', sku: 'X-1' }], [sp('v1', 'X-1'), sp('v2', 'X-1')]);
    expect(r[0].kieu).toBe('nhap_nhang');
  });

  it('khớp CHÍNH XÁC được ưu tiên hơn khớp đuôi', () => {
    const r = khopBienThe([{ id: 'a', sku: 'A13-L' }], [sp('v1', 'A13-L'), sp('v2', 'Calista-A13-L')]);
    expect(r[0]).toMatchObject({ shopifyVariantId: 'v1', kieu: 'chinh_xac' });
  });

  it('không có gì khớp → khong_khop', () => {
    const r = khopBienThe([{ id: 'a', sku: 'ZZZ' }], [sp('v1', 'A13-L')]);
    expect(r[0].kieu).toBe('khong_khop');
  });

  it('đuôi phải đứng sau dấu gạch — không khớp trùng đuôi ngẫu nhiên', () => {
    // "XA13-L" KHÔNG được coi là có đuôi "A13-L"
    const r = khopBienThe([{ id: 'a', sku: 'A13-L' }], [sp('v1', 'XA13-L')]);
    expect(r[0].kieu).toBe('khong_khop');
  });
});

describe('sanPhamCha', () => {
  it('mọi biến thể về cùng một sản phẩm → lấy sản phẩm đó', () => {
    expect(sanPhamCha(khopBienThe(
      [{ id: 'a', sku: 'X-S' }, { id: 'b', sku: 'X-M' }],
      [sp('v1', 'X-S', 'P9'), sp('v2', 'X-M', 'P9')],
    ))).toBe('P9');
  });

  it('biến thể về HAI sản phẩm khác nhau → null, cần người xem', () => {
    expect(sanPhamCha(khopBienThe(
      [{ id: 'a', sku: 'X-S' }, { id: 'b', sku: 'X-M' }],
      [sp('v1', 'X-S', 'P1'), sp('v2', 'X-M', 'P2')],
    ))).toBeNull();
  });

  it('không biến thể nào khớp → null', () => {
    expect(sanPhamCha([])).toBeNull();
  });
});
