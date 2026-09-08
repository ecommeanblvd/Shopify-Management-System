import { describe, it, expect } from 'vitest';
import { laHangTuSanXuat } from './vendor-tu-san-xuat';

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
