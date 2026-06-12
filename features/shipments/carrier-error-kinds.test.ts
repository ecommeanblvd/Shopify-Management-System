import { describe, it, expect } from 'vitest';
import { CARRIER_ERROR_KINDS, isCarrierErrorKind, carrierErrorKindLabel, carrierErrorKindRemediation } from './carrier-error-kinds';

describe('carrier-error-kinds', () => {
  it('9 loại theo khoản, value duy nhất', () => {
    expect(CARRIER_ERROR_KINDS).toHaveLength(9);
    expect(new Set(CARRIER_ERROR_KINDS.map((k) => k.value)).size).toBe(9);
    for (const v of ['weight','zone','fuel','remote','demand','signature','vat','ratecard','other'])
      expect(isCarrierErrorKind(v)).toBe(true);
  });
  it('mỗi loại có biện pháp', () => {
    for (const k of CARRIER_ERROR_KINDS) expect(carrierErrorKindRemediation(k.value).length).toBeGreaterThan(0);
  });
  it('label: loại mới + legacy surcharge', () => {
    expect(carrierErrorKindLabel('zone')).toBe('Sai zone');
    expect(carrierErrorKindLabel('surcharge')).toBe('Phụ phí sai');
    expect(carrierErrorKindLabel('bogus')).toBe('bogus');
  });
});
