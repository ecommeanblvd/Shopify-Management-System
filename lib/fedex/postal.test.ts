import { describe, expect, it } from 'vitest';
import { effectivePostcode } from './postal';

describe('effectivePostcode', () => {
  it('ưu tiên postcode thật', () => {
    expect(effectivePostcode('SA', '12345')).toBe('12345');
    expect(effectivePostcode('US', '11228')).toBe('11228');
  });
  it('rỗng/null → fallback theo nước (Vùng Vịnh…)', () => {
    expect(effectivePostcode('AE', null)).toBe('00000');
    expect(effectivePostcode('QA', '')).toBe('00974');
    expect(effectivePostcode('SA', '   ')).toBe('11564');
  });
  it('nước không có fallback + không postcode → null (bỏ quote)', () => {
    expect(effectivePostcode('ZZ', null)).toBeNull();
  });
});
