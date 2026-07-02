import { describe, expect, it } from 'vitest';
import { OLD_TO_NEW, SYSTEM_ROLE_SEEDS } from './permission-map';
import { isValidKey, allPermissionKeys } from './permissions';

// Regression — Finding 1: ship_ho must be wired end-to-end so pages/actions
// are not Forbidden for admin/operator.
describe('ship_ho RBAC wiring (regression — Finding 1)', () => {
  it('allPermissionKeys() includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const keys = allPermissionKeys();
    expect(keys).toContain('ship_ho:view');
    expect(keys).toContain('ship_ho:create');
    expect(keys).toContain('ship_ho:edit');
  });

  it('OLD_TO_NEW[view_ship_ho] maps to ship_ho:view', () => {
    expect(OLD_TO_NEW['view_ship_ho']).toBeDefined();
    expect(OLD_TO_NEW['view_ship_ho']).toContain('ship_ho:view');
  });

  it('OLD_TO_NEW[manage_ship_ho] maps to all ship_ho keys', () => {
    expect(OLD_TO_NEW['manage_ship_ho']).toBeDefined();
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:view');
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:create');
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:edit');
  });

  it('admin seed includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const adminKeys = new Set(SYSTEM_ROLE_SEEDS.admin.keys);
    expect(adminKeys.has('ship_ho:view')).toBe(true);
    expect(adminKeys.has('ship_ho:create')).toBe(true);
    expect(adminKeys.has('ship_ho:edit')).toBe(true);
  });

  it('operator seed includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const opKeys = new Set(SYSTEM_ROLE_SEEDS.operator.keys);
    expect(opKeys.has('ship_ho:view')).toBe(true);
    expect(opKeys.has('ship_ho:create')).toBe(true);
    expect(opKeys.has('ship_ho:edit')).toBe(true);
  });
});

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
