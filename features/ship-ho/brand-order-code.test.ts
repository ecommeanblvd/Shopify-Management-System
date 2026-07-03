import { describe, it, expect } from 'vitest';
import { formatBrandOrderCode } from './brand-order-code';

describe('formatBrandOrderCode (tạm — dãy số)', () => {
  it('prefix SH + số', () => {
    expect(formatBrandOrderCode(1000)).toBe('SH1000');
    expect(formatBrandOrderCode(1234)).toBe('SH1234');
  });
});
