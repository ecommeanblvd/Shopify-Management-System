import { describe, it, expect } from 'vitest';
import { canDienBu } from './dien-bu';

describe('canDienBu', () => {
  it('có tracking + có record Lark + chưa ghi giá → cần', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: null })).toBe(true);
  });
  it('chưa có tracking → chưa tới lượt', () => {
    expect(canDienBu({ trackingNumber: null, larkRecordId: 'rec', daGhiGiaLuc: null })).toBe(false);
  });
  it('chưa có record Lark → chưa ghi được', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: null, daGhiGiaLuc: null })).toBe(false);
  });
  it('đã ghi rồi → thôi', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: new Date() })).toBe(false);
  });
});
