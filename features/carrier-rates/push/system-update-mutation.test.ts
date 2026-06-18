import { describe, it, expect } from 'vitest';
import { buildUpdateMutationProfile } from './system-update-diff';

describe('buildUpdateMutationProfile', () => {
  it('builds zonesToUpdate with methodDefinitionsToUpdate (price) + create (with weight condition)', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [{ name: 'Standard shipping', price: 80, currency: 'USD', upperKg: 2, lowerKg: 1 }] }],
      ['gid://md/X']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lg = (profile.locationGroupsToUpdate as any[])[0];
    expect(lg.id).toBe('gid://lg/1');
    expect(lg.zonesToUpdate[0].id).toBe('gid://z/NA2');
    expect(lg.zonesToUpdate[0].methodDefinitionsToUpdate[0]).toEqual({ id: 'gid://md/A', rateDefinition: { price: { amount: '60', currencyCode: 'USD' } } });
    const created = lg.zonesToUpdate[0].methodDefinitionsToCreate[0];
    expect(created.name).toBe('Standard shipping');
    expect(created.rateDefinition).toEqual({ price: { amount: '80', currencyCode: 'USD' } });
    // lowerKg=1 → BOTH a GTE 1.01 condition AND a LTE 2 condition.
    const wc = created.weightConditionsToCreate as Array<{ criteria: { value: number; unit: string }; operator: string }>;
    expect(wc).toHaveLength(2);
    expect(wc).toContainEqual({ criteria: { value: 1.01, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' });
    expect(wc).toContainEqual({ criteria: { value: 2, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' });
    expect(profile.methodDefinitionsToDelete).toEqual(['gid://md/X']);
  });

  it('first band (lowerKg=0) creates ONLY the LTE condition, no GTE', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [], creates: [{ name: 'Standard shipping', price: 50, currency: 'USD', upperKg: 0.5, lowerKg: 0 }] }],
      []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lg = (profile.locationGroupsToUpdate as any[])[0];
    const created = lg.zonesToUpdate[0].methodDefinitionsToCreate[0];
    const wc = created.weightConditionsToCreate as Array<{ criteria: { value: number; unit: string }; operator: string }>;
    expect(wc).toHaveLength(1);
    expect(wc[0]).toEqual({ criteria: { value: 0.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' });
  });

  it('omits methodDefinitionsToDelete when no rate deletes', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [] }], []);
    expect(profile.methodDefinitionsToDelete).toBeUndefined();
  });

  it('empty zoneChunk with rateDeletes → top-level methodDefinitionsToDelete, no locationGroupsToUpdate', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1', [], ['gid://md/X', 'gid://md/Y']);
    expect(profile.methodDefinitionsToDelete).toEqual(['gid://md/X', 'gid://md/Y']);
    expect(profile.locationGroupsToUpdate).toBeUndefined();
  });

  it('empty zoneChunk and empty rateDeletes → empty profile', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1', [], []);
    expect(profile.locationGroupsToUpdate).toBeUndefined();
    expect(profile.methodDefinitionsToDelete).toBeUndefined();
  });
});
