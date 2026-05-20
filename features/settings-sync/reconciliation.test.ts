import { describe, it, expect } from 'vitest';
import { listUnreconciledPaths } from './reconciliation';

describe('listUnreconciledPaths', () => {
  it('returns empty when current is a subset of template', () => {
    const template = { zones: { Domestic: { rates: { Standard: { price: 30000 } } } } };
    const current  = { zones: { Domestic: { rates: { Standard: { price: 30000 } } } } };
    expect(listUnreconciledPaths(current, template)).toEqual([]);
  });

  it('returns paths that exist on the store but not in template', () => {
    const template = { zones: { Domestic: { rates: { Standard: { price: 30000 } } } } };
    const current  = {
      zones: {
        Domestic: { rates: { Standard: { price: 30000 }, Express: { price: 60000 } } },
        Legacy: { rates: { Old: { price: 1 } } },
      },
    };
    const out = listUnreconciledPaths(current, template).sort();
    expect(out).toEqual([
      'zones.Domestic.rates.Express',
      'zones.Legacy',
    ]);
  });
});
