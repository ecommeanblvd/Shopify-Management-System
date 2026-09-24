import { describe, it, expect } from 'vitest';
import { dungDongQc } from './qc-dong';

describe('dungDongQc', () => {
  it('ảnh BIẾN THỂ đứng đầu — đúng màu khách đặt, người QC thấy trước tiên', () => {
    const r = dungDongQc([{
      sku: 'A-1',
      variant: { id: 'gid://v/1', title: 'Black / S', image: { url: 'bien-the.jpg' } },
      product: { id: 'gid://p/1', title: 'Váy', images: { nodes: [{ url: 'sp1.jpg' }, { url: 'sp2.jpg' }] } },
    }]);
    expect(r[0]!.anh).toEqual(['bien-the.jpg', 'sp1.jpg', 'sp2.jpg']);
  });

  it('ảnh biến thể trùng một ảnh sản phẩm thì KHÔNG hiện hai lần', () => {
    const r = dungDongQc([{
      sku: 'A-1',
      variant: { id: 'v', title: 'S', image: { url: 'x.jpg' } },
      product: { id: 'p', title: 'Váy', images: { nodes: [{ url: 'x.jpg' }, { url: 'y.jpg' }] } },
    }]);
    expect(r[0]!.anh).toEqual(['x.jpg', 'y.jpg']);
  });

  it('không có ảnh biến thể → chỉ ảnh sản phẩm', () => {
    const r = dungDongQc([{
      sku: 'A', variant: { id: 'v', title: 'S', image: null },
      product: { id: 'p', title: 'Váy', images: { nodes: [{ url: 'a.jpg' }] } },
    }]);
    expect(r[0]!.anh).toEqual(['a.jpg']);
  });

  it('dòng thiếu hẳn variant/product → KHÔNG nổ, trả null và mảng rỗng', () => {
    const r = dungDongQc([{ sku: 'A', variant: null, product: null }]);
    expect(r[0]).toMatchObject({ sku: 'A', variantId: null, productId: null, anh: [], thuocTinh: [] });
  });

  it('chuyển tiếp ID sản phẩm và biến thể — khoá định danh hệ thống đang chuyển sang dùng', () => {
    const r = dungDongQc([{
      sku: 'A', variant: { id: 'gid://shopify/ProductVariant/9', title: 'S', image: null },
      product: { id: 'gid://shopify/Product/8', title: 'Váy' },
    }]);
    expect(r[0]).toMatchObject({
      variantId: 'gid://shopify/ProductVariant/9', productId: 'gid://shopify/Product/8',
    });
  });

  it('thuộc tính đi qua bộ lọc — rác app không lọt vào màn QC', () => {
    const r = dungDongQc([{
      sku: 'A', variant: null,
      product: { id: 'p', title: 'Váy', metafields: { nodes: [
        { namespace: 'custom', key: 'pattern', value: 'Plain', reference: null, references: null },
        { namespace: 'theme', key: 'estimateEndDate', value: '14', reference: null, references: null },
      ] } },
    }]);
    expect(r[0]!.thuocTinh).toMatchObject([{ nhan: 'Hoạ tiết', giaTri: 'Plain' }]);
    expect(r[0]!.soBiCat).toBe(1);
  });
});
