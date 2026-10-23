import { describe, expect, it } from 'vitest';
import { docCheDoTonKho } from './che-do-ton-kho';

describe('docCheDoTonKho', () => {
  it('chỉ đúng "ghi-that" mới ghi thật', () => {
    expect(docCheDoTonKho('ghi-that')).toBe('ghi');
    expect(docCheDoTonKho(' GHI-THAT ')).toBe('ghi');
  });
  it('trống / sai / gần đúng → chạy thử', () => {
    for (const v of [undefined, '', '1', 'true', 'ghi', 'ghi-that-toan-bo', 'dry']) {
      expect(docCheDoTonKho(v)).toBe('dry');
    }
  });
});
