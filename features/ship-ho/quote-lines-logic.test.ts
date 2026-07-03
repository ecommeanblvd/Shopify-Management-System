import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine', () => {
  it('charged = cost + markup%, margin = charged − cost', () => {
    expect(summarizeLine(100000, 20)).toEqual({ chargedVnd: 120000, marginVnd: 20000 });
  });
  it('markup 0 → charged = cost, margin 0', () => {
    expect(summarizeLine(150000, 0)).toEqual({ chargedVnd: 150000, marginVnd: 0 });
  });
  it('làm tròn VND (theo applyMarkup)', () => {
    // 100000 * 1.155 = 115500
    expect(summarizeLine(100000, 15.5)).toEqual({ chargedVnd: 115500, marginVnd: 15500 });
  });
});
