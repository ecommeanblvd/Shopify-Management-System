import { describe, it, expect } from 'vitest';
import { classifyCharge } from './charge-classify';

describe('classifyCharge', () => {
  it('no prior charge → new', () => {
    expect(classifyCharge(undefined, 'abc')).toBe('new');
    expect(classifyCharge(null, 'abc')).toBe('new');
  });
  it('same hash → unchanged (idempotent re-import)', () => {
    expect(classifyCharge('abc', 'abc')).toBe('unchanged');
  });
  it('different hash → updated (operator corrected the row)', () => {
    expect(classifyCharge('abc', 'xyz')).toBe('updated');
  });
});
