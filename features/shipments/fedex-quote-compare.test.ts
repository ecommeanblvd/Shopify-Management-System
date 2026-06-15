import { describe, expect, it } from 'vitest';
import { compareBilledVsFedexQuote, type BilledSnap, type FedexQuoteSnap } from './fedex-quote-compare';

const billed = (o: Partial<BilledSnap> = {}): BilledSnap => ({
  total: 1_800_000, fuel: 480_000, remote: 0, demand: 0, signature: 0, vat: 130_000, ...o,
});
const quote = (o: Partial<FedexQuoteSnap> = {}): FedexQuoteSnap => ({
  service: 'FEDEX_INTERNATIONAL_PRIORITY', totalNetCharge: 1_800_000, fuel: 480_000,
  fuelPercent: 42.5, remote: 0, demand: 0, residential: 0, signature: 0, countryFixed: 0, vat: 130_000, discount: 0, rateZone: 'H', ...o,
});

describe('compareBilledVsFedexQuote', () => {
  it('khớp giá HĐ → không overcharged', () => {
    const r = compareBilledVsFedexQuote(billed(), quote());
    expect(r.overcharged).toBe(false);
    expect(r.totalDelta).toBe(0);
    expect(r.verdict).toContain('Khớp giá hợp đồng');
  });

  it('billed cao hơn quote >2% → overcharged + nêu dòng phụ phí lệch nhất', () => {
    // remote bill thừa 100k → total cao hơn
    const r = compareBilledVsFedexQuote(billed({ total: 1_950_000, remote: 150_000 }), quote());
    expect(r.overcharged).toBe(true);
    expect(r.totalDelta).toBe(150_000);
    expect(r.verdict).toContain('FedEx thu cao hơn');
    expect(r.verdict).toContain('Phí vùng xa');
    expect(r.lines.find((l) => l.key === 'remote')!.delta).toBe(150_000);
  });

  it('billed thấp hơn quote → không overcharged (có lợi)', () => {
    const r = compareBilledVsFedexQuote(billed({ total: 1_700_000 }), quote());
    expect(r.overcharged).toBe(false);
    expect(r.totalDelta).toBe(-100_000);
    expect(r.verdict).toContain('THẤP hơn');
  });

  it('so signature billed vs signature quote (không phải countryFixed)', () => {
    const r = compareBilledVsFedexQuote(billed({ signature: 92_700 }), quote({ signature: 92_700 }));
    expect(r.lines.find((l) => l.key === 'signature')!.delta).toBe(0);
  });

  it('quote total null → quote=0, delta=billed (không chia 0)', () => {
    const r = compareBilledVsFedexQuote(billed(), quote({ totalNetCharge: null }));
    expect(r.lines.find((l) => l.key === 'total')!.quote).toBe(0);
    expect(r.totalDeltaPct).toBe(0);
  });
});
