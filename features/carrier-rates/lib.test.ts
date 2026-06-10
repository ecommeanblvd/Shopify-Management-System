import { describe, expect, it } from 'vitest';
import { formatExclusiveEndVN } from './lib';

describe('formatExclusiveEndVN', () => {
  it('renders the last applicable day (exclusive bound minus one)', () => {
    expect(formatExclusiveEndVN(new Date(Date.UTC(2026, 5, 15)))).toBe('14-06-2026');
    expect(formatExclusiveEndVN('2026-06-15T00:00:00.000Z')).toBe('14-06-2026');
  });
  it('falls back for null (open-ended)', () => {
    expect(formatExclusiveEndVN(null)).toBe('nay');
    expect(formatExclusiveEndVN(undefined, 'open')).toBe('open');
  });
});
