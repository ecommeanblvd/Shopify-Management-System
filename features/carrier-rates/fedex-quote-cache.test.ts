import { describe, expect, it } from 'vitest';
import { pickQuote } from './fedex-quote-cache';
import type { RateQuoteResult } from '@/lib/fedex/rate';

const q = (over: Partial<RateQuoteResult>): RateQuoteResult => ({
  serviceType: 'X', rateType: 'ACCOUNT', currency: 'VND', totalNetCharge: 0,
  baseCharge: null, totalSurcharges: null, surcharges: [],
  components: { fuel: 0, residential: 0, remote: 0, demand: 0, ancillary: 0, other: 0 },
  fuelPercent: null, vat: 0, discount: 0, billingWeightKg: null, rateZone: null, ...over,
});

describe('pickQuote', () => {
  it('ưu tiên ACCOUNT đúng dịch vụ mặc định', () => {
    const r = pickQuote([
      q({ serviceType: 'FEDEX_INTERNATIONAL_PRIORITY', rateType: 'LIST' }),
      q({ serviceType: 'INTERNATIONAL_ECONOMY', rateType: 'ACCOUNT' }),
      q({ serviceType: 'FEDEX_INTERNATIONAL_PRIORITY', rateType: 'ACCOUNT' }),
    ], 'FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.serviceType).toBe('FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.rateType).toBe('ACCOUNT');
  });
  it('thiếu dịch vụ mặc định → ACCOUNT đầu tiên', () => {
    const r = pickQuote([q({ serviceType: 'INTERNATIONAL_ECONOMY', rateType: 'ACCOUNT' })], 'FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.serviceType).toBe('INTERNATIONAL_ECONOMY');
  });
  it('không có ACCOUNT → null', () => {
    expect(pickQuote([q({ rateType: 'LIST' })], 'X')).toBeNull();
  });
});
