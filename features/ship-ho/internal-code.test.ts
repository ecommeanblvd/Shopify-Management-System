import { describe, it, expect } from 'vitest';
import { nextInternalCode, internalCodePrefix } from './internal-code';

describe('nextInternalCode', () => {
  const now = new Date('2026-07-20T12:00:00Z');
  it('chưa có mã năm nay → 0001', () => {
    expect(nextInternalCode(now, null)).toBe('26-INSMS-SV-0001');
  });
  it('tăng từ mã lớn nhất, pad 4 số', () => {
    expect(nextInternalCode(now, '26-INSMS-SV-0009')).toBe('26-INSMS-SV-0010');
    expect(nextInternalCode(now, '26-INSMS-SV-0999')).toBe('26-INSMS-SV-1000');
  });
  it('mã năm cũ không tính (reset theo năm)', () => {
    expect(nextInternalCode(now, '25-INSMS-SV-0500')).toBe('26-INSMS-SV-0001');
  });
  it('prefix INSMS khác INSLG của MMP — không đụng khoá', () => {
    expect(internalCodePrefix(now)).toBe('26-INSMS-SV-');
    expect(internalCodePrefix(now)).not.toContain('INSLG');
  });
});
