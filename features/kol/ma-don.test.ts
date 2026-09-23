import { describe, it, expect } from 'vitest';
import { maDonKol } from './ma-don';

describe('maDonKol', () => {
  it('dựng mã theo năm-tháng và số thứ tự đệm 4 chữ số', () => {
    expect(maDonKol(7, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-0007');
  });
  it('số vượt 4 chữ số thì KHÔNG cắt, để mã vẫn duy nhất', () => {
    expect(maDonKol(12345, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-12345');
  });
  it('sang tháng mới thì phần tháng đổi, số vẫn chạy tiếp không reset', () => {
    expect(maDonKol(8, new Date('2026-10-01T00:00:00Z'))).toBe('KOL-2610-0008');
  });
});
