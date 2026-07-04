import { describe, it, expect } from 'vitest';
import { buildRateCard, type RateCardSnapshot } from './offer-ratecard-logic';

function snap(): RateCardSnapshot {
  const zoneA = { label: 'Zone A', rateByTierUpper: new Map([[0.5, 100000], [1, 180000]]) };
  const zoneB = { label: 'Zone B', rateByTierUpper: new Map([[0.5, 120000], [1, 200000]]) };
  return {
    costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000,
    weightTiers: [{ upperKg: 0.5 }, { upperKg: 1 }],
    zonesByCountry: new Map([['US', zoneA], ['CA', zoneA], ['GB', zoneB]]),
    surcharges: [{ kind: 'fuel_percent' }, { kind: 'remote_fixed' }, { kind: 'fuel_percent' }],
  };
}

describe('buildRateCard', () => {
  it('tiers tăng dần, gồm mọi upperKg', () => {
    const c = buildRateCard(snap(), 30);
    expect(c.tiers).toEqual([0.5, 1]);
  });
  it('gom zone distinct theo label + danh sách nước', () => {
    const c = buildRateCard(snap(), 30);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    expect(zoneA.countries.sort()).toEqual(['CA', 'US']);
    expect(c.zones).toHaveLength(2);
  });
  it('offer = round(baseVnd × (1+markup))', () => {
    const c = buildRateCard(snap(), 30);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    const cell05 = zoneA.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell05.baseVnd).toBe(100000);
    expect(cell05.offerVnd).toBe(130000);
  });
  it('displayCurrency VND → base chia fx', () => {
    const s = snap();
    s.costCurrency = 'USD'; s.displayCurrency = 'VND'; s.fxCostPerDisplay = 0.25;
    // zoneA 0.5 base 100000 (đơn vị cost USD giả) → /0.25 = 400000 → ×1.3 = 520000
    const c = buildRateCard(s, 30);
    const cell = c.zones.find((z) => z.label === 'Zone A')!.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell.baseVnd).toBe(400000);
    expect(cell.offerVnd).toBe(520000);
  });
  it('surchargeNotes distinct + nhãn VN, bỏ kind lạ', () => {
    const c = buildRateCard(snap(), 30);
    expect(c.surchargeNotes).toContain('Phụ phí xăng dầu (theo tuần FedEx)');
    expect(c.surchargeNotes).toContain('Phụ phí vùng xa');
    expect(c.surchargeNotes.filter((n) => n.includes('xăng dầu'))).toHaveLength(1);
  });
});
