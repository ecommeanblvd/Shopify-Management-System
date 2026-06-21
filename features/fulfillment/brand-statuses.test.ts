import { describe, it, expect } from 'vitest';
import { BRAND_STATUSES, isBrandStatus } from './brand-statuses';

describe('BRAND_STATUSES / isBrandStatus', () => {
  it('gồm đúng 4 status brand', () => {
    expect([...BRAND_STATUSES]).toEqual(['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected']);
  });
  it('isBrandStatus true cho mọi status brand', () => {
    for (const s of BRAND_STATUSES) expect(isBrandStatus(s)).toBe(true);
  });
  it('false cho status khác / null / undefined', () => {
    expect(isBrandStatus('in_stock')).toBe(false);
    expect(isBrandStatus('pending_check')).toBe(false);
    expect(isBrandStatus(null)).toBe(false);
    expect(isBrandStatus(undefined)).toBe(false);
  });
});
