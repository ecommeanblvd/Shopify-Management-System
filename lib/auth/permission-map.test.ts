import { describe, expect, it } from 'vitest';
import { OLD_TO_NEW, SYSTEM_ROLE_SEEDS } from './permission-map';
import { isValidKey, allPermissionKeys } from './permissions';

describe('OLD_TO_NEW', () => {
  it('every mapped key is a valid catalog key', () => {
    for (const keys of Object.values(OLD_TO_NEW)) for (const k of keys) expect(isValidKey(k)).toBe(true);
  });
  it('maps representative legacy perms', () => {
    expect(OLD_TO_NEW['view_orders']).toEqual(['orders:view']);
    expect(OLD_TO_NEW['manage_warehouse']).toContain('fulfillment.warehouse:edit');
  });
});

describe('SYSTEM_ROLE_SEEDS', () => {
  it('admin gets every permission key', () => {
    expect(new Set(SYSTEM_ROLE_SEEDS.admin.keys)).toEqual(new Set(allPermissionKeys()));
  });
  it('every seeded key is valid', () => {
    for (const r of Object.values(SYSTEM_ROLE_SEEDS)) for (const k of r.keys) expect(isValidKey(k)).toBe(true);
  });
  it('logistics has the expected scoped keys and NOT operations:edit/warehouse', () => {
    const l = new Set(SYSTEM_ROLE_SEEDS.logistics.keys);
    expect(l.has('fulfillment.operations:view')).toBe(true);
    expect(l.has('fulfillment.logistics:create')).toBe(true);
    expect(l.has('fulfillment.logistics:delete')).toBe(true);
    expect(l.has('carrier_rates:view')).toBe(true);
    expect(l.has('carrier_rates:create')).toBe(true);
    expect(l.has('carrier_rates.invoices:create')).toBe(true);
    expect(l.has('fulfillment.operations:edit')).toBe(false);
    expect(l.has('fulfillment.warehouse:edit')).toBe(false);
  });
  it('viewer is read-only (no create/edit/delete/apply/push)', () => {
    for (const k of SYSTEM_ROLE_SEEDS.viewer.keys) expect(k.endsWith(':view')).toBe(true);
  });
});
