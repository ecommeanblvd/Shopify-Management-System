import { describe, it, expect } from 'vitest';
import { buildUpdateMutationProfile } from '../push-step';

describe('buildUpdateMutationProfile', () => {
  it('builds zonesToUpdate with methodDefinitionsToUpdate (price) + create (with weight condition)', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [{ name: 'Standard shipping', price: 80, currency: 'USD', upperKg: 2 }] }],
      ['gid://md/X']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lg = (profile.locationGroupsToUpdate as any[])[0];
    expect(lg.id).toBe('gid://lg/1');
    expect(lg.zonesToUpdate[0].id).toBe('gid://z/NA2');
    expect(lg.zonesToUpdate[0].methodDefinitionsToUpdate[0]).toEqual({ id: 'gid://md/A', rateDefinition: { price: { amount: '60', currencyCode: 'USD' } } });
    const created = lg.zonesToUpdate[0].methodDefinitionsToCreate[0];
    expect(created.name).toBe('Standard shipping');
    expect(created.rateDefinition).toEqual({ price: { amount: '80', currencyCode: 'USD' } });
    expect(created.weightConditionsToCreate).toBeTruthy(); // upper 2kg → has a condition
    expect(profile.methodDefinitionsToDelete).toEqual(['gid://md/X']);
  });

  it('omits methodDefinitionsToDelete when no rate deletes', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [] }], []);
    expect(profile.methodDefinitionsToDelete).toBeUndefined();
  });
});
