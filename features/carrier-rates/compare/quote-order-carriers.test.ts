import { describe, it, expect } from 'vitest';
import { rankCarrierQuotes, type AccountSnap } from './quote-order-carriers';
import type { CarrierAccountSnapshot } from '../engine/quote';

function snap(id: string, thRate: number | null): CarrierAccountSnapshot {
  return {
    id, name: `Acc ${id}`, costCurrency: 'VND', displayCurrency: 'VND', fxCostPerDisplay: 1,
    weightTiers: [{ upperKg: 1 }, { upperKg: 2 }],
    zonesByCountry: thRate === null
      ? new Map()
      : new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, thRate], [2, thRate + 100_000]]) }]]),
    surcharges: [], remotePostcodes: new Map(),
  };
}

function entry(carrierKey: string, s: CarrierAccountSnapshot): AccountSnap {
  return { carrierKey, carrierName: s.name, accountId: s.id, snap: s };
}

describe('rankCarrierQuotes', () => {
  it('quotes every carrier and sorts by carrier cost ascending', () => {
    const rows = rankCarrierQuotes([
      entry('dhl', snap('b', 360_000)),
      entry('fedex', snap('a', 280_000)),
      entry('ups', snap('c', 420_000)),
    ], { country: 'TH', weightKg: 1 });

    expect(rows.map((r) => r.carrierKey)).toEqual(['fedex', 'dhl', 'ups']); // cheapest first
    expect(rows[0].carrierCostDisplay).toBe(280_000);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows[0].breakdown).toBeTruthy(); // full breakdown attached for the UI
  });

  it('puts carriers that cannot quote (no zone) last, marked not-ok', () => {
    const rows = rankCarrierQuotes([
      entry('sf-express', snap('nozone', null)), // no TH zone → fails
      entry('fedex', snap('a', 280_000)),
    ], { country: 'TH', weightKg: 1 });

    expect(rows[0].carrierKey).toBe('fedex');
    expect(rows[0].ok).toBe(true);
    expect(rows[1].ok).toBe(false);
    expect(rows[1].error).toBe('no_zone');
  });

  it('normalizes cross-currency: sorts by VND cost, not by mixed display currency', () => {
    // FedEx-like: rate sheet VND (real), display USD (small number ~42)
    const fedex = snap('fx', 1_100_000); fedex.costCurrency = 'VND'; fedex.displayCurrency = 'USD'; fedex.fxCostPerDisplay = 26_000;
    // UPS-like: cost + display both VND
    const ups = snap('ups', 1_500_000);
    const rows = rankCarrierQuotes([entry('ups', ups), entry('fedex', fedex)], { country: 'TH', weightKg: 1 });
    // FedEx 1.1M VND < UPS 1.5M VND — must NOT be fooled by FedEx's 42-USD display
    expect(rows[0].carrierKey).toBe('fedex');
    expect(rows[0].vndCost).toBe(1_100_000);
    expect(rows[1].vndCost).toBe(1_500_000);
  });

  it('Aramex-like (cost USD, display VND) → vndCost uses the VND display', () => {
    const aramex = snap('arm', 50); aramex.costCurrency = 'USD'; aramex.displayCurrency = 'VND'; aramex.fxCostPerDisplay = 1 / 26_000;
    const rows = rankCarrierQuotes([entry('aramex', aramex)], { country: 'TH', weightKg: 1 });
    expect(rows[0].vndCost).toBe(1_300_000); // 50 USD × 26,000
  });

  it('passes carrier suspension info through to the row (shown but flagged)', () => {
    const susp = new Date('2026-06-01T00:00:00Z');
    const rows = rankCarrierQuotes([
      { carrierKey: 'dhl', carrierName: 'DHL', accountId: 'd', snap: snap('a', 280_000), suspendedAt: susp, suspendReason: 'Tạm ngưng dịch vụ' },
    ], { country: 'TH', weightKg: 1 });
    expect(rows[0].ok).toBe(true); // vẫn báo giá
    expect(rows[0].suspendedAt).toBe(susp.toISOString());
    expect(rows[0].suspendReason).toBe('Tạm ngưng dịch vụ');
  });

  it('MẶC ĐỊNH không cộng addon when_billed (phụ phí theo-ca Aramex / ký nhận FedEx)', () => {
    // Bug 09/07: default optIn theo nước → 5 phụ phí theo-ca Aramex ($766) bị cộng
    // chồng vào mọi quote đi US. Baseline so sánh phải bỏ addon tùy chọn.
    const withAddon = snap('a', 100_000);
    withAddon.surcharges = [{ kind: 'addon_fixed', value: 442_000, active: true, applyMode: 'when_billed' }];
    const def = rankCarrierQuotes([entry('aramex', withAddon)], { country: 'TH', weightKg: 1 });
    expect(def[0].carrierCostDisplay).toBe(100_000); // không dính addon
    const opted = rankCarrierQuotes([entry('aramex', withAddon)], { country: 'TH', weightKg: 1, signatureOptIn: true });
    expect(opted[0].carrierCostDisplay).toBe(542_000); // opt-in tường minh mới cộng
  });

  it('applies fuel + VAT surcharges into the compared carrier cost', () => {
    const withFuel = snap('f', 100_000);
    withFuel.surcharges = [
      { kind: 'fuel_percent', value: 30, active: true },
      { kind: 'vat_percent', value: 8, active: true },
    ];
    const rows = rankCarrierQuotes([entry('sf-express', withFuel)], { country: 'TH', weightKg: 1 });
    // 100k × 1.30 × 1.08 = 140,400
    expect(rows[0].carrierCostDisplay).toBe(140_400);
  });
});
