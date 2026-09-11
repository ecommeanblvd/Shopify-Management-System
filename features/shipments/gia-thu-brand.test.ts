import { describe, it, expect } from 'vitest';
import { laStoreThuBrand, brandCuaStore, giaThuBrand, laiKienStoreBrand, STORE_THU_BRAND } from './gia-thu-brand';

describe('store thu brand', () => {
  it('chỉ TINH Atelier và Mirer, không phải MEAN BLVD hay Cici', () => {
    expect(laStoreThuBrand('tinhatelier.myshopify.com')).toBe(true);
    expect(laStoreThuBrand('mirermirer-official.myshopify.com')).toBe(true);
    expect(laStoreThuBrand('meanblvd.myshopify.com')).toBe(false);
    expect(laStoreThuBrand('cici-mean.myshopify.com')).toBe(false);
    expect(laStoreThuBrand(null)).toBe(false);
  });
  it('mỗi store map đúng một brand slug', () => {
    expect(brandCuaStore('tinhatelier.myshopify.com')).toBe('tinh');
    expect(brandCuaStore('mirermirer-official.myshopify.com')).toBe('mirer');
    expect(brandCuaStore('meanblvd.myshopify.com')).toBeNull();
    expect(Object.keys(STORE_THU_BRAND)).toHaveLength(2);
  });
});

describe('giaThuBrand', () => {
  it('dựng lại đúng ca TA1420 CEO đã duyệt: 745.629 + 226.349 + 92.700 + VAT 85.174', () => {
    expect(giaThuBrand({ carrierCost: 1_149_852 })).toBe(1_149_852);
  });
  it('KHÔNG cộng phí đóng gói và markup của bảng giá', () => {
    expect(giaThuBrand({ carrierCost: 1_149_852, markup: 191_978, packaging: 130_000 })).toBe(1_149_852);
  });
  it('cộng thêm % khi CEO muốn có biên', () => {
    expect(giaThuBrand({ carrierCost: 1_000_000 }, 10)).toBe(1_100_000);
    expect(giaThuBrand({ carrierCost: 1_000_000 }, -5)).toBe(1_000_000);
  });
  it('cước âm hoặc 0 → 0, không ra số âm', () => {
    expect(giaThuBrand({ carrierCost: -5 })).toBe(0);
  });
});

describe('laiKienStoreBrand', () => {
  it('lãi = thu brand − cước thực trả', () => {
    expect(laiKienStoreBrand(1_149_852, 1_100_000)).toBe(49_852);
  });
  it('thiếu một trong hai vế → null, không đoán thành 0', () => {
    expect(laiKienStoreBrand(null, 1_000)).toBeNull();
    expect(laiKienStoreBrand(1_000, null)).toBeNull();
  });
});
