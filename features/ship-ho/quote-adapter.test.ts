import { describe, it, expect } from 'vitest';
import { pickCarrierCostVnd, pickBaseVnd } from './quote-adapter';

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

describe('pickBaseVnd', () => {
  it('costCurrency VND → base nguyên', () => {
    const r = pickBaseVnd(
      { costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000 },
      { base: 90000 },
    );
    expect(r).toEqual({ ok: true, vnd: 90000 });
  });
  it('displayCurrency VND → base / fxCostPerDisplay, làm tròn', () => {
    const r = pickBaseVnd(
      { costCurrency: 'USD', displayCurrency: 'VND', fxCostPerDisplay: 0.25 },
      { base: 4.75 },
    );
    // 4.75 / 0.25 = 19 → 19
    expect(r).toEqual({ ok: true, vnd: 19 });
  });
  it('không có VND → fail reason non_vnd', () => {
    const r = pickBaseVnd(
      { costCurrency: 'USD', displayCurrency: 'EUR', fxCostPerDisplay: 1.1 },
      { base: 4.75 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('non_vnd');
  });
});
