import { describe, it, expect } from 'vitest';
import { mergeEffective, type OverrideRow } from './merge';

describe('mergeEffective', () => {
  const template = {
    zones: {
      Domestic: { countries: ['VN'], rates: { Standard: { price: 30000 } } },
    },
  };

  it('returns the template unchanged when there are no overrides', () => {
    expect(mergeEffective(template, [])).toEqual(template);
  });

  it('applies a leaf override', () => {
    const overrides: OverrideRow[] = [{ path: 'zones.Domestic.rates.Standard.price', value: 35000 }];
    const result = mergeEffective(template, overrides);
    expect(result.zones.Domestic.rates.Standard.price).toBe(35000);
    expect(template.zones.Domestic.rates.Standard.price).toBe(30000); // immutable
  });

  it('creates intermediate objects when the path is new', () => {
    const overrides: OverrideRow[] = [{ path: 'zones.International.countries', value: ['US', 'JP'] }];
    const result = mergeEffective(template, overrides);
    expect((result.zones as Record<string, unknown>).International).toEqual({ countries: ['US', 'JP'] });
    expect(result.zones.Domestic).toEqual(template.zones.Domestic); // untouched
  });

  it('applies multiple overrides in order', () => {
    const overrides: OverrideRow[] = [
      { path: 'zones.Domestic.rates.Standard.price', value: 35000 },
      { path: 'zones.Domestic.rates.Express', value: { price: 70000 } },
    ];
    const result = mergeEffective(template, overrides);
    expect(result.zones.Domestic.rates.Standard.price).toBe(35000);
    expect((result.zones.Domestic.rates as Record<string, unknown>).Express).toEqual({ price: 70000 });
  });

  it('rejects an empty path', () => {
    expect(() => mergeEffective(template, [{ path: '', value: 1 }])).toThrow(/empty path/i);
  });
});
