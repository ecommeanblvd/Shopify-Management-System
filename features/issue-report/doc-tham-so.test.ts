import { describe, expect, it } from 'vitest';
import { docThamSoBaoLoi } from './doc-tham-so';

const doc = (q: string) => docThamSoBaoLoi(new URLSearchParams(q));

describe('docThamSoBaoLoi', () => {
  it('?bl= không phải số nguyên dương thì trả null, không trả NaN', () => {
    for (const v of ['abc', '-1', '0', '', '1.5', '1e9', ' 7 ', '7a', '٧']) {
      const so = doc(`bl=${encodeURIComponent(v)}`).so;
      expect(so, `bl=${JSON.stringify(v)}`).toBeNull();
      expect(Number.isNaN(so as unknown as number)).toBe(false);
    }
  });

  it('?bl=7 trả 7', () => {
    expect(doc('bl=7').so).toBe(7);
    expect(doc('bl=00012').so).toBe(12);
  });

  it('trangThai lạ thì bỏ qua, không lọc', () => {
    expect(doc('trangThai=khong-ton-tai').trangThai).toBeNull();
    expect(doc('trangThai=da_xong').trangThai).toBe('da_xong');
  });

  it('module lạ thì bỏ qua', () => {
    expect(doc('module=khong-ton-tai').module).toBeNull();
    expect(doc('module=ship-ho').module).toBe('ship-ho');
  });

  it('không tham số nào thì cả ba đều null', () => {
    expect(doc('')).toEqual({ so: null, trangThai: null, module: null });
  });
});
