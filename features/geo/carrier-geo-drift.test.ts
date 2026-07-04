import { describe, it, expect } from 'vitest';
import { isPostcodePattern } from './carrier-geo';

describe('isPostcodePattern', () => {
  it('wildcard * → false', () => { expect(isPostcodePattern('*')).toBe(false); });
  it('city UPPERCASE chữ → false', () => { expect(isPostcodePattern('JEDDAH')).toBe(false); });
  it('có chữ số → postcode true', () => {
    expect(isPostcodePattern('98077')).toBe(true);
    expect(isPostcodePattern('SW1A 1AA')).toBe(true); // alnum có số
  });
});
