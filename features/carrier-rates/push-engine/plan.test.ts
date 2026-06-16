import { describe, it, expect } from 'vitest';
import { buildParticipant, isVnZone, standardBackupDefs } from './plan';

describe('buildParticipant', () => {
  it('cả 2 carrier → 2 service, adapt off', () => {
    const p = buildParticipant('gid://CS/1', ['fedex', 'dhl']);
    expect(p.adaptToNewServices).toBe(false);
    expect(p.participantServices).toEqual([
      { name: 'FedEx International Priority', active: true },
      { name: 'DHL Express', active: true },
    ]);
  });
  it('chỉ FedEx (pause DHL) → 1 service FedEx', () => {
    const p = buildParticipant('gid://CS/1', ['fedex']);
    expect(p.participantServices).toEqual([{ name: 'FedEx International Priority', active: true }]);
  });
});

describe('isVnZone', () => {
  it('chỉ VN → true; có nước khác / ROW → false', () => {
    expect(isVnZone([{ countryCode: 'VN' }])).toBe(true);
    expect(isVnZone([{ countryCode: 'VN' }, { countryCode: 'HK' }])).toBe(false);
    expect(isVnZone([{ restOfWorld: true }])).toBe(false);
    expect(isVnZone([{ countryCode: 'US' }])).toBe(false);
  });
});

describe('standardBackupDefs', () => {
  it('chỉ lấy FedEx, tên "Standard shipping", gate theo cân', () => {
    const defs = standardBackupDefs({
      'FedEx IP (0–0.5 kg)': { price: 54.5, currency: 'USD' },
      'FedEx IP (0.5–1 kg)': { price: 64, currency: 'USD' },
      'DHL Express (0–0.5 kg)': { price: 56.5, currency: 'USD' },
    });
    expect(defs).toHaveLength(2); // DHL bị loại
    expect(defs.every((d) => d.name === 'Standard shipping')).toBe(true);
    expect(defs[0].rateDefinition.price).toEqual({ amount: '54.5', currencyCode: 'USD' });
    expect(defs[0].weightConditionsToCreate).toEqual([
      { criteria: { value: 0.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
    expect(defs[1].weightConditionsToCreate).toEqual([
      { criteria: { value: 0.5, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
      { criteria: { value: 1, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
  });
});
