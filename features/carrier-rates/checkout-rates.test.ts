import { describe, it, expect } from 'vitest';
import { computeCheckoutRates } from './checkout-rates';
import type { CarrierAccountSnapshot } from './engine/quote';

function snap(label: string, name: string): CarrierAccountSnapshot {
  return {
    id: 'a', name, costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 1 }, { upperKg: 5 }],
    zonesByCountry: new Map([['US', { label, rateByTierUpper: new Map([[1, 1_300_000], [5, 2_600_000]]) }]]),
    surcharges: [{ kind: 'markup_percent', value: 15, active: true }],
    remotePostcodes: new Map(),
  };
}

describe('computeCheckoutRates', () => {
  it('quote mỗi carrier phục vụ đích → rate Shopify (total_price cents)', () => {
    const rates = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [
        { serviceCode: 'fedex', serviceName: 'FedEx IP', snapshot: snap('Zone US', 'FedEx') },
        { serviceCode: 'dhl', serviceName: 'DHL Express', snapshot: snap('Zone US', 'DHL') },
      ],
    });
    expect(rates).toHaveLength(2);
    expect(rates[0].service_code).toBe('fedex');
    expect(rates[0].currency).toBe('USD');
    // finalDisplay = (1.3M base ×1.15 markup)/26000 ≈ 57.5 USD → 5750 cents
    expect(Number(rates[0].total_price)).toBeGreaterThan(5000);
    expect(rates[0].total_price).toMatch(/^\d+$/);
  });

  it('carrier không phục vụ đích (no zone) → bỏ qua', () => {
    const s = snap('Zone US', 'FedEx');
    const rates = computeCheckoutRates({ country: 'ZZ', weightKg: 1, carriers: [{ serviceCode: 'fedex', serviceName: 'FedEx', snapshot: s }] });
    expect(rates).toHaveLength(0);
  });

  it('giỏ không cân (0) → tối thiểu 0,5kg, vẫn ra rate', () => {
    const rates = computeCheckoutRates({ country: 'US', weightKg: 0, carriers: [{ serviceCode: 'f', serviceName: 'F', snapshot: snap('Zone US', 'F') }] });
    expect(rates).toHaveLength(1);
  });
});
