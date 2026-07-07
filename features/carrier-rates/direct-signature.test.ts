import { describe, it, expect } from 'vitest';
import {
  countrySupportsDirectSignature, FEDEX_DIRECT_SIGNATURE_COUNTRIES, DIRECT_SIGNATURE_FEE_VND,
  shouldChargeDirectSignature,
} from './direct-signature';

describe('direct-signature config', () => {
  it('fee = 92.700đ', () => expect(DIRECT_SIGNATURE_FEE_VND).toBe(92700));
  it('US/GB/DE/AU/JP có DS', () => {
    for (const c of ['US', 'GB', 'DE', 'AU', 'JP']) expect(countrySupportsDirectSignature(c)).toBe(true);
  });
  it('case-insensitive + nước không có DS → false', () => {
    expect(countrySupportsDirectSignature('us')).toBe(true);
    expect(countrySupportsDirectSignature('VN')).toBe(false); // origin, không phải đích DS
    expect(countrySupportsDirectSignature('')).toBe(false);
  });
  it('list không rỗng và toàn ISO-2 upper', () => {
    expect(FEDEX_DIRECT_SIGNATURE_COUNTRIES.length).toBeGreaterThan(20);
    for (const c of FEDEX_DIRECT_SIGNATURE_COUNTRIES) expect(c).toMatch(/^[A-Z]{2}$/);
  });
});

describe('shouldChargeDirectSignature (ship-hộ opt-in gate)', () => {
  it('muốn DS + nước hỗ trợ (US) → true', () => {
    expect(shouldChargeDirectSignature(true, 'US')).toBe(true);
  });
  it('không muốn DS + nước hỗ trợ (US) → false', () => {
    expect(shouldChargeDirectSignature(false, 'US')).toBe(false);
  });
  it('muốn DS + nước KHÔNG hỗ trợ (CD) → false', () => {
    expect(shouldChargeDirectSignature(true, 'CD')).toBe(false);
  });
  it('không muốn DS + nước không hỗ trợ (CD) → false', () => {
    expect(shouldChargeDirectSignature(false, 'CD')).toBe(false);
  });
});
