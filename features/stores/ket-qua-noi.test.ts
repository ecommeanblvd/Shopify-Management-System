import { describe, it, expect } from 'vitest';
import { maLoiTuLoi, laMaLoi, tenGon, THONG_DIEP_LOI } from './ket-qua-noi';

describe('maLoiTuLoi', () => {
  it('quy đúng từng lỗi callback ném ra', () => {
    expect(maLoiTuLoi(new Error('Invalid shop domain: abc'))).toBe('ten-store-sai');
    expect(maLoiTuLoi(new Error('Missing state cookie — possible CSRF or expired nonce'))).toBe('het-han');
    expect(maLoiTuLoi(new Error('State mismatch — possible CSRF attack'))).toBe('het-han');
    expect(maLoiTuLoi(new Error('HMAC validation failed'))).toBe('chu-ky-sai');
    expect(maLoiTuLoi(new Error('Token exchange failed with status 401'))).toBe('doi-ma-hong');
    expect(maLoiTuLoi(new Error('No access_token in Shopify token exchange response'))).toBe('doi-ma-hong');
  });

  it('lỗi lạ về "khac" chứ KHÔNG đoán — đoán sai là chỉ người dùng đi sửa nhầm chỗ', () => {
    expect(maLoiTuLoi(new Error('ECONNRESET'))).toBe('khac');
    expect(maLoiTuLoi(null)).toBe('khac');
  });

  it('mọi mã đều có câu hướng dẫn, không mã nào rỗng', () => {
    for (const [ma, cau] of Object.entries(THONG_DIEP_LOI)) {
      expect(cau.length, ma).toBeGreaterThan(20);
    }
  });
});

describe('laMaLoi — không tin thẳng thứ trên thanh địa chỉ', () => {
  it('chỉ nhận mã có thật', () => {
    expect(laMaLoi('het-han')).toBe(true);
    expect(laMaLoi('linh-tinh')).toBe(false);
    expect(laMaLoi(null)).toBe(false);
    expect(laMaLoi('')).toBe(false);
  });

  it('không nhận thứ trỏ tới thuộc tính có sẵn của Object', () => {
    // 'constructor' in {} là true — dùng `in` trần sẽ lọt.
    expect(laMaLoi('constructor')).toBe(false);
    expect(laMaLoi('toString')).toBe(false);
  });
});

describe('tenGon', () => {
  it('bỏ đuôi myshopify.com', () => {
    expect(tenGon('hc-store.myshopify.com')).toBe('hc-store');
    expect(tenGon('meanblvd')).toBe('meanblvd');
  });
});
