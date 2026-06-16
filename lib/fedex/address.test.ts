import { describe, expect, it } from 'vitest';
import { buildResolveRequest, parseClassification, parseAddressVerification } from './address';

describe('parseAddressVerification', () => {
  const wrap = (o: object) => ({ output: { resolvedAddresses: [o] } });
  it('địa chỉ tốt: residential + giao được + chuẩn hoá', () => {
    const v = parseAddressVerification(wrap({
      classification: 'RESIDENTIAL', attributes: { DPV: 'true', Matched: 'true' },
      streetLines: ['1522 82ND ST'], city: 'BROOKLYN', stateOrProvinceCode: 'NY', postalCode: '11228',
    }));
    expect(v.classification).toBe('RESIDENTIAL');
    expect(v.deliverable).toBe(true);
    expect(v.standardized).toBe('1522 82ND ST, BROOKLYN, NY, 11228');
    expect(v.issue).toBeNull();
  });
  it('địa chỉ thiếu/sai: không giao được + nêu vấn đề', () => {
    const v = parseAddressVerification(wrap({
      classification: 'UNKNOWN', attributes: { DPV: 'false', Matched: 'false' },
      customerMessages: [{ code: 'STANDARDIZED.ADDRESS.NOTFOUND' }],
    }));
    expect(v.deliverable).toBe(false);
    expect(v.issue).toBe('STANDARDIZED.ADDRESS.NOTFOUND');
  });
  it('thiếu số phòng → issue SuiteRequiredButMissing', () => {
    const v = parseAddressVerification(wrap({ classification: 'BUSINESS', attributes: { Resolved: 'true', SuiteRequiredButMissing: 'true' } }));
    expect(v.deliverable).toBe(true);
    expect(v.issue).toBe('SuiteRequiredButMissing');
  });
});

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

  const prov = (input: Parameters<typeof buildResolveRequest>[0]) =>
    (buildResolveRequest(input) as { addressesToValidate: Array<{ address: Record<string, unknown> }> })
      .addressesToValidate[0].address.stateOrProvinceCode;

  it('US/CA: bỏ tiền tố nước ISO 3166-2 ("US-CA" → "CA")', () => {
    expect(prov({ streetLines: ['x'], stateOrProvinceCode: 'US-CA', countryCode: 'US' })).toBe('CA');
    expect(prov({ streetLines: ['x'], stateOrProvinceCode: 'CA-ON', countryCode: 'CA' })).toBe('ON');
  });

  it('US: mã 2 ký tự sẵn giữ nguyên', () => {
    expect(prov({ streetLines: ['x'], stateOrProvinceCode: 'NY', countryCode: 'US' })).toBe('NY');
  });

  it('nước khác (KW): BỎ mã tỉnh để tránh FedEx 400 STATEORPROVINCECODE.TOO.LONG', () => {
    expect(prov({ streetLines: ['x'], stateOrProvinceCode: 'KW-KU', countryCode: 'KW' })).toBeUndefined();
    expect(prov({ streetLines: ['x'], stateOrProvinceCode: 'GB-ENG', countryCode: 'GB' })).toBeUndefined();
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
