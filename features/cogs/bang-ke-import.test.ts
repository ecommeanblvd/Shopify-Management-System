import { describe, it, expect } from 'vitest';
import { sheetIdTuUrl, urlXuatXlsx } from './bang-ke-import';

describe('URL Google Sheet', () => {
  it('lấy id từ link chia sẻ', () => {
    expect(sheetIdTuUrl('https://docs.google.com/spreadsheets/d/1HNqRWYk_yoYQe6c1tj8eQbSEGp1_zeO3EKbpTgoAVvg/edit?usp=sharing')).toBe('1HNqRWYk_yoYQe6c1tj8eQbSEGp1_zeO3EKbpTgoAVvg');
    expect(sheetIdTuUrl('https://example.com/x')).toBeNull();
  });
  it('dựng URL xuất xlsx', () => {
    expect(urlXuatXlsx('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=xlsx');
  });
});
