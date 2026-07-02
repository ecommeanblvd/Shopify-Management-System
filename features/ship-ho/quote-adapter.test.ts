import { describe, it, expect } from 'vitest';
import { pickCarrierCostVnd } from './quote-adapter';

describe('pickCarrierCostVnd', () => {
  it('costCurrency VND → lấy carrierCost', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'VND', displayCurrency: 'USD' },
      { carrierCost: 123456, carrierCostDisplay: 4.75 },
    );
    expect(r).toEqual({ ok: true, vnd: 123456 });
  });

  it('displayCurrency VND (cost khác) → lấy carrierCostDisplay', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'USD', displayCurrency: 'VND' },
      { carrierCost: 4.75, carrierCostDisplay: 124000 },
    );
    expect(r).toEqual({ ok: true, vnd: 124000 });
  });

  it('không có VND ở đâu → fail có reason', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'USD', displayCurrency: 'EUR' },
      { carrierCost: 4.75, carrierCostDisplay: 4.4 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('non_vnd');
  });
});
