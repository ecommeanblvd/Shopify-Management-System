import { describe, it, expect } from 'vitest';
import { buildParticipant, isVnZone } from './plan';
import { loTenHang } from '@/features/carrier-rates/hai-muc-giao';

describe('buildParticipant', () => {
  it('đúng 2 service Standard / Express, adapt off, không lộ tên hãng', () => {
    const p = buildParticipant('gid://CS/1');
    expect(p.carrierServiceId).toBe('gid://CS/1');
    expect(p.adaptToNewServices).toBe(false);
    expect(p.participantServices).toEqual([
      { name: 'Standard Shipping', active: true },
      { name: 'Express Shipping', active: true },
    ]);
    expect(p.participantServices.some((s) => loTenHang(s.name))).toBe(false);
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
