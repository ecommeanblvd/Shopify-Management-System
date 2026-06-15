import { describe, expect, it } from 'vitest';
import { buildResolveRequest, parseClassification } from './address';

describe('buildResolveRequest', () => {
  it('gói địa chỉ + bỏ dòng phố rỗng', () => {
    const req = buildResolveRequest({
      streetLines: ['1522 82ND STREET', '', '  '],
      city: 'BROOKLYN', stateOrProvinceCode: 'NY', postalCode: '11228', countryCode: 'US',
    }) as { addressesToValidate: Array<{ address: Record<string, unknown> }> };
    const a = req.addressesToValidate[0].address;
    expect(a.streetLines).toEqual(['1522 82ND STREET']);
    expect(a.city).toBe('BROOKLYN');
    expect(a.postalCode).toBe('11228');
    expect(a.countryCode).toBe('US');
  });
});

describe('parseClassification', () => {
  const wrap = (classification: string, attributes?: Record<string, unknown>) =>
    ({ output: { resolvedAddresses: [{ classification, attributes }] } });

  it('RESIDENTIAL / BUSINESS / MIXED giữ nguyên', () => {
    expect(parseClassification(wrap('RESIDENTIAL'))).toBe('RESIDENTIAL');
    expect(parseClassification(wrap('BUSINESS'))).toBe('BUSINESS');
    expect(parseClassification(wrap('MIXED'))).toBe('MIXED');
  });

  it('classification trống → suy từ attributes.Residential', () => {
    expect(parseClassification(wrap('', { Residential: 'true' }))).toBe('RESIDENTIAL');
    expect(parseClassification(wrap('', { Residential: false }))).toBe('BUSINESS');
  });

  it('không xác định → UNKNOWN', () => {
    expect(parseClassification(wrap('UNKNOWN'))).toBe('UNKNOWN');
    expect(parseClassification({})).toBe('UNKNOWN');
    expect(parseClassification(null)).toBe('UNKNOWN');
  });
});
