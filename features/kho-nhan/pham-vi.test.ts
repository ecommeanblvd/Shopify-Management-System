import { describe, expect, it } from 'vitest';
import { STORE_NHAN_HANG, nhanHangDuoc } from './pham-vi';

describe('nhanHangDuoc', () => {
  it('ba store vận hành thật thì nhận được', () => {
    expect(nhanHangDuoc('meanblvd.myshopify.com')).toBe(true);
    expect(nhanHangDuoc('tinhatelier.myshopify.com')).toBe(true);
    expect(nhanHangDuoc('mirermirer-official.myshopify.com')).toBe(true);
  });

  it('cici-mean BỊ CHẶN (CEO 29/09/2026)', () => {
    expect(nhanHangDuoc('cici-mean.myshopify.com')).toBe(false);
    expect(STORE_NHAN_HANG).not.toContain('cici-mean.myshopify.com');
  });

  it('store LẠ chưa từng khai → không nhận, không đoán', () => {
    expect(nhanHangDuoc('store-moi.myshopify.com')).toBe(false);
  });

  it('không phân biệt hoa thường và khoảng trắng', () => {
    expect(nhanHangDuoc('  MEANBLVD.myshopify.com ')).toBe(true);
  });

  it('rỗng / null → không nhận', () => {
    expect(nhanHangDuoc(null)).toBe(false);
    expect(nhanHangDuoc('')).toBe(false);
    expect(nhanHangDuoc('   ')).toBe(false);
  });

  it('là danh sách CHO PHÉP: đúng ba domain, thêm store mới phải sửa code có chủ đích', () => {
    expect(STORE_NHAN_HANG).toHaveLength(3);
  });
});
