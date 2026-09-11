import { describe, it, expect } from 'vitest';
import { laStoreThuBrand, brandCuaStore, giaThuBrand, laiKienStoreBrand, STORE_THU_BRAND, PHI_XU_LY_VND } from './gia-thu-brand';

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
  it('cước bill cộng 5 USD (130.000đ) cho kiện đầu của đơn — đúng số đang gửi MMP', () => {
    expect(giaThuBrand({ cuocBillVnd: 1_100_000, laKienDauCuaDon: true })).toBe(1_230_000);
  });
  it('đơn nhiều kiện chỉ cộng phí xử lý MỘT lần', () => {
    expect(giaThuBrand({ cuocBillVnd: 900_000, laKienDauCuaDon: false })).toBe(900_000);
  });
  it('chưa có bill → null, không quy về 0 rồi thành lỗ', () => {
    expect(giaThuBrand({ cuocBillVnd: null, laKienDauCuaDon: true })).toBeNull();
    expect(giaThuBrand({ cuocBillVnd: 0, laKienDauCuaDon: true })).toBeNull();
  });
  it('đổi được mức phí xử lý khi cần', () => {
    expect(giaThuBrand({ cuocBillVnd: 1_000_000, laKienDauCuaDon: true }, 0)).toBe(1_000_000);
  });
  it('hằng số khớp cấu hình gửi MMP: 5 USD × 26.000', () => {
    expect(PHI_XU_LY_VND).toBe(130_000);
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
