import { describe, it, expect } from 'vitest';
import { pickRateCardForDate, type RateCardWindow } from './rate-cards';

const cards: RateCardWindow[] = [
  { id: 'c2025', effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2026-01-04') },
  { id: 'c2026', effectiveFrom: new Date('2026-01-05'), effectiveTo: null },
];

describe('pickRateCardForDate', () => {
  it('picks the 2025 card for a ship date inside its window', () => {
    expect(pickRateCardForDate(cards, new Date('2025-07-09'))?.id).toBe('c2025');
  });
  it('includes the inclusive upper bound (04/01/2026 → 2025 card)', () => {
    expect(pickRateCardForDate(cards, new Date('2026-01-04'))?.id).toBe('c2025');
  });
  it('picks the open 2026 card for the day after cutover', () => {
    expect(pickRateCardForDate(cards, new Date('2026-01-05'))?.id).toBe('c2026');
  });
  it('picks the open card for a future date', () => {
    expect(pickRateCardForDate(cards, new Date('2030-01-01'))?.id).toBe('c2026');
  });
  it('returns null when no card covers the date', () => {
    expect(pickRateCardForDate(cards, new Date('2024-06-01'))).toBeNull();
  });
});
