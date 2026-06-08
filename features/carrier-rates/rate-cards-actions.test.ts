import { describe, it, expect } from 'vitest';
import { windowsOverlap } from './rate-cards-windows';

describe('windowsOverlap', () => {
  const existing = [
    { effectiveFrom: '2025-01-01', effectiveTo: '2026-01-04' },
    { effectiveFrom: '2026-01-05', effectiveTo: null },
  ];
  it('rejects a new window overlapping the 2025 card', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2025-12-01', effectiveTo: '2026-02-01' })).toBe(true);
  });
  it('rejects a second open-ended card', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2027-01-01', effectiveTo: null })).toBe(true);
  });
  it('accepts a non-overlapping past window', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' })).toBe(false);
  });
});
