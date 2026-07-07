import { describe, it, expect } from 'vitest';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { isDefaultResidential } from '@/features/carrier-rates/residential-default';

/**
 * estimateForBrand() (features/ship-ho/brand-estimate.ts) đọc DB thật (partner +
 * snapshot FedEx qua loadAccountSnapshot) nên khó unit-test trực tiếp mà không
 * dựng DB giả phức tạp. Test này khóa hành vi ở tầng engine mà brand-estimate
 * phụ thuộc: quote() với isResidential = isDefaultResidential(country) phải
 * cộng đúng phí residential_fixed (US/CA) — đây chính là field bị thiếu trước
 * khi sửa brand-estimate.ts (Task 1).
 */
function makeFedexSnap(): CarrierAccountSnapshot {
  return {
    id: 'acc-fedex',
    name: 'FedEx',
    costCurrency: 'VND',
    displayCurrency: 'USD',
    fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 1 }],
    zonesByCountry: new Map([
      ['US', { label: 'Zone US', rateByTierUpper: new Map([[1, 280_000]]) }],
    ]),
    surcharges: [
      { kind: 'residential_fixed', value: 84_400, active: true, countryCodes: ['US', 'CA'] },
    ],
    remotePostcodes: new Map(),
  };
}

describe('brand-estimate residential default (khớp checkout-rates.ts / push/recalc.ts)', () => {
  it('US với isDefaultResidential → engine cộng đúng phụ phí residential_fixed 84.400₫', () => {
    const snap = makeFedexSnap();
    const country = 'US';
    const r = quote(snap, { weightKg: 1, destinationCountry: country, isResidential: isDefaultResidential(country) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown.residential).toBe(84_400);
  });

  it('nước ngoài US/CA (VD SG) → isDefaultResidential=false, engine không cộng phí residential', () => {
    const snap = makeFedexSnap();
    // Thêm zone SG để quote không fail do zone thiếu.
    snap.zonesByCountry.set('SG', { label: 'Zone SG', rateByTierUpper: new Map([[1, 280_000]]) });
    const country = 'SG';
    const r = quote(snap, { weightKg: 1, destinationCountry: country, isResidential: isDefaultResidential(country) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown.residential).toBe(0);
  });
});
