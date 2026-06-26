import { describe, it, expect } from 'vitest';
import { quote, type CarrierAccountSnapshot, type QuoteInput } from '@/features/carrier-rates/engine/quote';

/** fx = số cost-unit (USD) cho 1 display-unit (VND) = 1/26000 ≈ 0.0000384615.
 *  Engine: display = cost / fx → USD × 26000 = VND. Chứng minh precision (20,10)
 *  cho ra VND đúng cho rate card Aramex USD. */
const FX = 1 / 26000;

function aramexSnap(): CarrierAccountSnapshot {
  return {
    id: 'aramex-test',
    name: 'Aramex HN',
    costCurrency: 'USD',
    displayCurrency: 'VND',
    fxCostPerDisplay: FX,
    dimDivisorCm3PerKg: 5000,
    chargeableRoundingKg: null,
    chargeableRoundingMode: null,
    totalsRoundingMode: null,
    zonesByCountry: new Map([
      ['JP', { label: 'Japan', rateByTierUpper: new Map([[0.5, 17.85], [1.0, 19.72]]), pakRateByTierUpper: new Map() }],
    ]),
    weightTiers: [{ upperKg: 0.5 }, { upperKg: 1.0 }],
    surcharges: [],
    remotePostcodes: new Map(),
  };
}

describe('aramex quote (USD cost → VND display)', () => {
  it('1.0kg đi Japan → cost 19.72 USD, display ≈ 512720 VND', () => {
    const input: QuoteInput = { weightKg: 1.0, destinationCountry: 'JP' };
    const r = quote(aramexSnap(), input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.breakdown.carrierCost).toBe(19.72);
      expect(Math.round(r.breakdown.carrierCostDisplay)).toBe(512720); // 19.72 × 26000
    }
  });

  it('0.7kg ceil lên tier 1.0 (bậc 0.5)', () => {
    const r = quote(aramexSnap(), { weightKg: 0.7, destinationCountry: 'JP' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tier.upperKg).toBe(1.0);
      expect(r.breakdown.carrierCost).toBe(19.72); // tier (0.5, 1.0] = 19.72
    }
  });

  it('0.4kg → tier 0.5 = 17.85 USD', () => {
    const r = quote(aramexSnap(), { weightKg: 0.4, destinationCountry: 'JP' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tier.upperKg).toBe(0.5);
      expect(r.breakdown.carrierCost).toBe(17.85);
    }
  });
});
