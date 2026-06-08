import { describe, expect, it } from 'vitest';
import { fedexIpParser } from './fedex-ip';

describe('fedexIpParser.extractEffectiveFrom', () => {
  it('parses "Net rates are effective as of 28 October 2025."', () => {
    const text = 'FedEx International Priority Export\nNet rates are effective as of 28 October 2025.\n';
    expect(fedexIpParser.extractEffectiveFrom(text)).toBe('2025-10-28');
  });

  it('parses a single-digit day "effective as of 4 January 2026"', () => {
    expect(fedexIpParser.extractEffectiveFrom('effective as of 4 January 2026')).toBe('2026-01-04');
  });

  it('returns null when no effective-date line is present', () => {
    expect(fedexIpParser.extractEffectiveFrom('no date here')).toBeNull();
  });
});
