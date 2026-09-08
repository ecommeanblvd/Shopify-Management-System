import { describe, it, expect } from 'vitest';
import { BRAND_SLUG_MEANBLVD, brandSlugTuSanXuat, laHangTuSanXuat } from './vendor-tu-san-xuat';

describe('laHangTuSanXuat', () => {
  it('store riêng brand (BRAND_OWNED_STORES) → mọi line là tự sản xuất, không cần xét vendor', () => {
    expect(laHangTuSanXuat('tinhatelier', 'bất kỳ')).toBe(true);
  });

  it('store riêng brand, vendor null → vẫn true', () => {
    expect(laHangTuSanXuat('tinhatelier', null)).toBe(true);
  });

  it('meanblvd (đa-brand), vendor MEAN BLVD → true', () => {
    expect(laHangTuSanXuat('meanblvd', 'MEAN BLVD')).toBe(true);
  });

  it('meanblvd, vendor lệch hoa/thường + khoảng trắng thừa → vẫn true', () => {
    expect(laHangTuSanXuat('meanblvd', 'mean blvd ')).toBe(true);
  });

  it('meanblvd, vendor brand outsource khác → false', () => {
    expect(laHangTuSanXuat('meanblvd', 'DeNio')).toBe(false);
  });

  it('store khác — không thuộc BRAND_OWNED_STORES và không phải meanblvd → false', () => {
    expect(laHangTuSanXuat('cici-mean', 'Cici')).toBe(false);
  });
});

describe('brandSlugTuSanXuat', () => {
  it('store riêng brand → đúng slug của brand đó', () => {
    expect(brandSlugTuSanXuat('tinhatelier')).toBe('tinh');
    expect(brandSlugTuSanXuat('mirermirer-official')).toBe('mirer');
  });

  it('meanblvd (đa-brand, tự sản xuất) → slug thật của MEAN trong mmp_brands, KHÔNG phải tên store', () => {
    expect(brandSlugTuSanXuat('meanblvd')).toBe('mean-blvd');
  });
});

// Guard: BRAND_SLUG_MEANBLVD PHẢI khớp đúng `mmp_brands.slug` thật của MEAN
// trong DB — sai giá trị này thì mọi dòng order_line_cogs của hàng MEAN tự
// sản xuất ghi brand_slug không tồn tại, báo cáo/lọc theo brand của MEAN sẽ
// không bao giờ khớp được dòng nào (bug đã xảy ra: hằng cũ ghi 'meanblvd').
it("BRAND_SLUG_MEANBLVD === 'mean-blvd' — phải khớp mmp_brands.slug thật của MEAN", () => {
  expect(BRAND_SLUG_MEANBLVD).toBe('mean-blvd');
});
