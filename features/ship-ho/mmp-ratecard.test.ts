import { describe, it, expect } from 'vitest';
import { shapeRateCardForMmp } from './mmp-ratecard';
import type { RateCard } from './offer-ratecard-logic';

function card(overrides: Partial<RateCard> = {}): RateCard {
  return {
    markupPercent: 30,
    tiers: [0.5, 1],
    zones: [
      { label: 'Zone A', countries: ['TH', 'SG'], cells: [
        { tierUpperKg: 0.5, baseVnd: 400000, offerVnd: 520000 },
        { tierUpperKg: 1, baseVnd: 450000, offerVnd: 585000 },
      ] },
    ],
    countryZones: [
      { code: 'TH', name: 'Thailand', zone: 'Zone A' },
      { code: 'SG', name: 'Singapore', zone: 'Zone A' },
    ],
    surcharges: [
      { kind: 'processing_fixed', label: 'Phí xử lý đơn hàng', detail: '50.000₫' },
      { kind: 'vat_percent', label: 'VAT', detail: '8%' },
    ],
    ...overrides,
  };
}

const GEN = new Date('2026-07-06T10:00:00.000Z');

describe('shapeRateCardForMmp', () => {
  it('bỏ baseVnd — mỗi ô CHỈ có tierUpperKg + offerVnd', () => {
    const p = shapeRateCardForMmp(card(), { brandSlug: 'tinh-atelier', generatedAt: GEN });
    expect(p.zones[0].cells).toEqual([
      { tierUpperKg: 0.5, offerVnd: 520000 },
      { tierUpperKg: 1, offerVnd: 585000 },
    ]);
    // không rò rỉ baseVnd ở bất kỳ đâu
    expect(JSON.stringify(p)).not.toContain('baseVnd');
    expect(JSON.stringify(p)).not.toContain('400000');
  });

  it('giữ zones/countryZones/surcharges + metadata brand-facing', () => {
    const p = shapeRateCardForMmp(card(), { brandSlug: 'tinh-atelier', generatedAt: GEN });
    expect(p.brandSlug).toBe('tinh-atelier');
    expect(p.service).toBe('express');
    expect(p.currency).toBe('VND');
    expect(p.markupPercent).toBe(30);
    expect(p.tiers).toEqual([0.5, 1]);
    expect(p.zones[0].countries).toEqual(['TH', 'SG']);
    expect(p.countryZones).toHaveLength(2);
    expect(p.processingFeeVnd).toBe(50000);
    expect(p.fuelUrl).toMatch(/fedex\.com.*fuel/);
    expect(p.notes.length).toBeGreaterThan(0);
    expect(p.surcharges).toContainEqual({ kind: 'processing_fixed', label: 'Phí xử lý đơn hàng', detail: '50.000₫' });
    expect(p.generatedAt).toBe('2026-07-06T10:00:00.000Z');
    expect(p.effectiveDate).toBe('2026-07-06');
  });

  it('version = 12 hex, ỔN ĐỊNH giữa các lần gọi (độc lập generatedAt)', () => {
    const a = shapeRateCardForMmp(card(), { brandSlug: 'b', generatedAt: new Date('2026-07-06T10:00:00Z') });
    const b = shapeRateCardForMmp(card(), { brandSlug: 'b', generatedAt: new Date('2026-08-01T23:59:00Z') });
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(a.version).toBe(b.version); // generatedAt khác nhưng nội dung như nhau → cùng version
  });

  it('version ĐỔI khi nội dung đổi (markup / giá / brand)', () => {
    const base = shapeRateCardForMmp(card(), { brandSlug: 'b', generatedAt: GEN }).version;
    expect(shapeRateCardForMmp(card({ markupPercent: 35 }), { brandSlug: 'b', generatedAt: GEN }).version).not.toBe(base);
    expect(shapeRateCardForMmp(card(), { brandSlug: 'other', generatedAt: GEN }).version).not.toBe(base);
    const bumped = card();
    bumped.zones[0].cells[0].offerVnd = 999999;
    expect(shapeRateCardForMmp(bumped, { brandSlug: 'b', generatedAt: GEN }).version).not.toBe(base);
  });
});
