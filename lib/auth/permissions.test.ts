import { describe, expect, it } from 'vitest';
import { CATALOG, ACTIONS, allPermissionKeys, isValidKey } from './permissions';

describe('permission catalog', () => {
  it('every scope key is unique', () => {
    const keys = CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every action used is in ACTIONS', () => {
    for (const s of CATALOG) for (const a of s.actions) expect(ACTIONS).toContain(a);
  });
  it('allPermissionKeys returns scope:action for each pair, unique', () => {
    const all = allPermissionKeys();
    expect(all).toContain('fulfillment.logistics:create');
    expect(all).toContain('carrier_rates:view');
    expect(new Set(all).size).toBe(all.length);
  });
  it('isValidKey accepts catalog keys and rejects others', () => {
    expect(isValidKey('carrier_rates.invoices:create')).toBe(true);
    expect(isValidKey('carrier_rates:teleport')).toBe(false);
    expect(isValidKey('nonsense')).toBe(false);
  });
});
