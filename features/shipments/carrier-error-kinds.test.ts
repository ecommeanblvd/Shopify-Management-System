import { describe, it, expect } from 'vitest';
import { isCarrierErrorKind, carrierErrorKindLabel, CARRIER_ERROR_KINDS } from './carrier-error-kinds';

describe('carrier-error-kinds', () => {
  it('có đủ 6 loại, value duy nhất', () => {
    expect(CARRIER_ERROR_KINDS).toHaveLength(6);
    expect(new Set(CARRIER_ERROR_KINDS.map((k) => k.value)).size).toBe(6);
  });
  it('isCarrierErrorKind nhận value hợp lệ, loại value lạ', () => {
    expect(isCarrierErrorKind('weight')).toBe(true);
    expect(isCarrierErrorKind('zone')).toBe(true);
    expect(isCarrierErrorKind('bogus')).toBe(false);
    expect(isCarrierErrorKind('')).toBe(false);
  });
  it('carrierErrorKindLabel trả label, fallback chính value khi lạ', () => {
    expect(carrierErrorKindLabel('weight')).toBe('Sai cân');
    expect(carrierErrorKindLabel('bogus')).toBe('bogus');
  });
});
