import { describe, it, expect } from 'vitest';
import { locThuocTinh, type MetafieldTho } from './thuoc-tinh-shopify';

const mf = (namespace: string, key: string, value: string, extra: Partial<MetafieldTho> = {}): MetafieldTho =>
  ({ namespace, key, value, reference: null, references: null, ...extra });

describe('locThuocTinh', () => {
  it('chỉ nhận namespace custom và shopify', () => {
    const r = locThuocTinh([
      mf('custom', 'pattern', 'Plain'),
      mf('theme', 'estimateEndDate', '14'),
      mf('swym_wishlist', 'wishlist_social_count', '3'),
      mf('mm-google-shopping', 'google_product_category', '1604'),
    ]);
    expect(r.hien.map((x) => x.giaTri)).toEqual(['Plain']);
    expect(r.soBiCat).toBe(3);
  });

  it('quy tham chiếu metaobject về chữ đọc được', () => {
    const r = locThuocTinh([
      mf('custom', 'materials_v2', '["gid://shopify/Metaobject/1"]',
         { references: [{ displayName: 'Crepe' }] }),
      mf('custom', 'fitting_type_v2', 'gid://shopify/Metaobject/2',
         { reference: { displayName: 'Slim' } }),
    ]);
    expect(r.hien.map((x) => x.giaTri).sort()).toEqual(['Crepe', 'Slim']);
  });

  it('còn là gid chưa quy đổi được thì BỎ, không hiện mã cho người kiểm', () => {
    const r = locThuocTinh([mf('custom', 'pattern', 'gid://shopify/Metaobject/9')]);
    expect(r.hien).toHaveLength(0);
    expect(r.soBiCat).toBe(1);
  });

  it('bỏ blob dài quá 200 ký tự (widget review, JSON cấu hình app)', () => {
    const r = locThuocTinh([mf('custom', 'badge', '<div class="jdgm">' + 'x'.repeat(300) + '</div>')]);
    expect(r.hien).toHaveLength(0);
    expect(r.soBiCat).toBe(1);
  });

  it('gộp hai thế hệ: _v2 THẮNG bản cũ, chỉ hiện MỘT dòng', () => {
    const r = locThuocTinh([
      mf('custom', 'fitting_type', 'Regular'),
      mf('custom', 'fitting_type_v2', 'x', { reference: { displayName: 'Slim' } }),
    ]);
    expect(r.hien).toMatchObject([{ nhan: 'Kiểu dáng', giaTri: 'Slim' }]);
  });

  it('_v2 đứng TRƯỚC bản cũ trong mảng thì vẫn thắng', () => {
    const r = locThuocTinh([
      mf('custom', 'fitting_type_v2', 'x', { reference: { displayName: 'Slim' } }),
      mf('custom', 'fitting_type', 'Regular'),
    ]);
    expect(r.hien).toMatchObject([{ nhan: 'Kiểu dáng', giaTri: 'Slim' }]);
  });

  it('chỉ có bản cũ thì vẫn hiện bản cũ', () => {
    const r = locThuocTinh([mf('custom', 'fitting_type', 'Regular')]);
    expect(r.hien).toMatchObject([{ nhan: 'Kiểu dáng', giaTri: 'Regular' }]);
  });

  it('loại khoá không phục vụ kiểm hàng', () => {
    const r = locThuocTinh([
      mf('custom', 'return_refund_policy_v2', 'x', { reference: { displayName: '30 days' } }),
      mf('custom', 'seasonal', 'x', { reference: { displayName: 'Summer' } }),
    ]);
    expect(r.hien).toHaveLength(0);
  });

  it('mảng JSON chuỗi quy về chữ: ["156cm"] → 156cm', () => {
    const r = locThuocTinh([mf('custom', 'length', '["156cm"]')]);
    expect(r.hien).toMatchObject([{ nhan: 'Chiều dài', giaTri: '156cm' }]);
  });

  it('đếm đúng số bị cắt để người sửa sau biết bộ lọc đang cắt bao nhiêu', () => {
    const r = locThuocTinh([mf('custom', 'pattern', 'Plain'), mf('theme', 'a', '1'), mf('theme', 'b', '2')]);
    expect(r.soBiCat).toBe(2);
  });
});

describe('locThuocTinh — dạng connection của Shopify', () => {
  it('references dạng { nodes: [...] } — ĐÚNG thứ Shopify trả về thật', () => {
    const r = locThuocTinh([{
      namespace: 'custom', key: 'materials_v2', value: '["gid://shopify/Metaobject/1"]',
      reference: null, references: { nodes: [{ displayName: 'Chiffon' }] },
    }]);
    expect(r.hien).toMatchObject([{ nhan: 'Chất liệu', giaTri: 'Chiffon' }]);
  });

  it('references là mảng trần vẫn chạy — không phá test cũ', () => {
    const r = locThuocTinh([{
      namespace: 'custom', key: 'materials_v2', value: 'x',
      reference: null, references: [{ displayName: 'Crepe' }],
    }]);
    expect(r.hien).toMatchObject([{ nhan: 'Chất liệu', giaTri: 'Crepe' }]);
  });

  it('references là { nodes: null } → không nổ', () => {
    const r = locThuocTinh([{
      namespace: 'custom', key: 'pattern', value: 'Plain',
      reference: null, references: { nodes: null },
    }]);
    expect(r.hien).toMatchObject([{ nhan: 'Hoạ tiết', giaTri: 'Plain' }]);
  });
});


describe('locThuocTinh — đặc điểm nổi bật của SẢN PHẨM', () => {
  it('custom.special_features lên ĐẦU danh sách — thứ QC soi trước tiên', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'pattern', value: 'Plain', reference: null, references: null },
      { namespace: 'custom', key: 'special_features',
        value: '["Open back","Attached bow at waist"]', reference: null, references: null },
    ]);
    expect(r.hien[0]).toMatchObject({ nhan: 'Đặc điểm nổi bật', giaTri: 'Open back, Attached bow at waist' });
  });

  it('hai thuộc tính độ dài KHÔNG còn trùng nhãn', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'product_length_v2_multi', value: 'x', reference: null,
        references: { nodes: [{ displayName: 'Maxi' }] } },
      { namespace: 'custom', key: 'length', value: '["155cm"]', reference: null, references: null },
    ]);
    const nhan = r.hien.map((x) => x.nhan);
    expect(new Set(nhan).size).toBe(nhan.length);
    expect(nhan).toContain('Dáng dài');
    expect(nhan).toContain('Chiều dài');
  });

  it('loại văn marketing không giúp kiểm hàng', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'occasion', value: 'Wedding Guest, Prom', reference: null, references: null },
      { namespace: 'shopify', key: 'target-gender', value: 'x', reference: { displayName: 'Female' }, references: null },
    ]);
    expect(r.hien).toHaveLength(0);
  });
});

describe('locThuocTinh — không bao giờ trùng nhãn', () => {
  it('material / materials / fabric đều là "Chất liệu" → gộp về MỘT dòng', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'material', value: 'Silk', reference: null, references: null },
      { namespace: 'custom', key: 'materials', value: 'Silk', reference: null, references: null },
      { namespace: 'shopify', key: 'fabric', value: 'x', reference: { displayName: 'Chiffon' }, references: null },
    ]);
    const chatLieu = r.hien.filter((x) => x.nhan === 'Chất liệu');
    expect(chatLieu).toHaveLength(1);
    expect(chatLieu[0]!.giaTri).toBe('Silk, Chiffon');
  });

  it('neck_style / neckline_type / neckline đều là "Cổ" → một dòng, không lặp giá trị', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'neck_style', value: 'Round Neck', reference: null, references: null },
      { namespace: 'custom', key: 'neckline_type_v2', value: 'x', reference: { displayName: 'Round Neck' }, references: null },
    ]);
    const co = r.hien.filter((x) => x.nhan === 'Cổ');
    expect(co).toHaveLength(1);
    expect(co[0]!.giaTri).toBe('Round Neck');
  });

  it('bất biến: danh sách hiển thị KHÔNG có hai dòng cùng nhãn', () => {
    const r = locThuocTinh([
      { namespace: 'custom', key: 'material', value: 'Silk', reference: null, references: null },
      { namespace: 'custom', key: 'materials', value: 'Cotton', reference: null, references: null },
      { namespace: 'custom', key: 'neck_style', value: 'V', reference: null, references: null },
      { namespace: 'custom', key: 'neckline', value: 'U', reference: null, references: null },
      { namespace: 'custom', key: 'product_length', value: 'Maxi', reference: null, references: null },
      { namespace: 'custom', key: 'length', value: '155cm', reference: null, references: null },
    ]);
    const nhan = r.hien.map((x) => x.nhan);
    expect(new Set(nhan).size).toBe(nhan.length);
  });
});
