import { describe, expect, it } from 'vitest';
import { laMaNoiBo, maDonBrand } from './ma-don-brand';

describe('laMaNoiBo', () => {
  it('nhận ra mã vận hành của LOG/MMP và của SMS', () => {
    expect(laMaNoiBo('26-INSLG-SV-0992')).toBe(true);
    expect(laMaNoiBo('26-INSMS-SV-0007')).toBe(true);
    expect(laMaNoiBo('26-inslg-sv-0992')).toBe(true);   // không phân biệt hoa thường
  });

  it('mã brand thật thì không phải mã nội bộ', () => {
    expect(laMaNoiBo('#KLS2101')).toBe(false);
    expect(laMaNoiBo('TA1999')).toBe(false);
    expect(laMaNoiBo(null)).toBe(false);
    expect(laMaNoiBo(undefined)).toBe(false);
  });
});

describe('maDonBrand', () => {
  it('ưu tiên brandReference — cột Brand Reference trên Lark', () => {
    expect(maDonBrand({ brandReference: '#KLS2101', customerRef: '#KHAC' })).toBe('#KLS2101');
  });

  it('thiếu brandReference thì dùng customerRef', () => {
    expect(maDonBrand({ brandReference: null, customerRef: '#KLS2101' })).toBe('#KLS2101');
  });

  /* 29 đơn source='lark' có customerRef là bản sao mã Lark (đo 05/10/2026). Hiện nó ra là gọi
     mã vận hành của LOG là mã của brand — brand đối soát theo đó sẽ không tìm ra đơn nào. */
  it('KHÔNG BAO GIỜ trả mã nội bộ, dù dữ liệu cũ còn bẩn', () => {
    expect(maDonBrand({ brandReference: null, customerRef: '26-INSLG-SV-0992' })).toBeNull();
    expect(maDonBrand({ brandReference: '26-INSLG-SV-0992', customerRef: null })).toBeNull();
  });

  it('mã nội bộ ở vế đầu thì vẫn lấy được mã thật ở vế sau', () => {
    expect(maDonBrand({ brandReference: '26-INSLG-SV-0992', customerRef: '#KLS2101' })).toBe('#KLS2101');
  });

  it('chưa biết mã brand thì trả null, không trả chuỗi rỗng', () => {
    expect(maDonBrand({ brandReference: null, customerRef: null })).toBeNull();
    expect(maDonBrand({ brandReference: '  ', customerRef: '' })).toBeNull();
  });
});
