import { describe, expect, it, beforeAll } from 'vitest';
import { primeRoleCache } from './auth/access';
import { SYSTEM_ROLE_SEEDS } from './auth/permission-map';
import { NAV, SETTINGS_ITEMS, SETTINGS_GROUPS, canSeeSettings, canSeeNavItem } from './nav';

// canSeeSettings → hasPermission reads the role cache; prime it from seeds (no DB).
beforeAll(() => {
  primeRoleCache(Object.fromEntries(
    Object.entries(SYSTEM_ROLE_SEEDS).map(([k, v]) => [k, v.keys]),
  ));
});

describe('NAV structure', () => {
  const hrefs = NAV.map((n) => n.href);

  it('keeps the five core modules + Settings at top level', () => {
    for (const h of ['/', '/f/orders', '/f/carrier-rates', '/f/mmp', '/f/functions', '/settings']) {
      expect(hrefs).toContain(h);
    }
  });

  it('does not keep any moved module at top level', () => {
    for (const item of SETTINGS_ITEMS) {
      expect(hrefs).not.toContain(item.href);
    }
  });

  it('includes the shipping-reconcile module gated by view_carrier_rates', () => {
    const item = NAV.find((n) => n.href === '/f/shipping-reconcile');
    expect(item).toBeDefined();
    expect(item!.requires).toBe('view_carrier_rates');
  });

  it('includes fulfillment gated by view_fulfillment', () => {
    const item = NAV.find((n) => n.href === '/f/fulfillment');
    expect(item).toBeDefined();
    expect(item!.requires).toBe('view_fulfillment');
  });

  it('includes warehouse module OR-gated, and receiving no longer at top level', () => {
    const item = NAV.find((n) => n.href === '/f/warehouse');
    expect(item).toBeDefined();
    expect(item!.requires).toEqual(['view_fulfillment', 'view_receiving']);
    expect(hrefs).not.toContain('/f/fulfillment/receiving');
  });
});

describe('canSeeNavItem', () => {
  it('null requires is visible to everyone', () => {
    expect(canSeeNavItem('viewer', null)).toBe(true);
  });

  it('scalar requires checks that single permission', () => {
    expect(canSeeNavItem('admin', 'view_fulfillment')).toBe(true);
  });

  it('array requires is an OR — one matching permission is enough', () => {
    // admin has both; the OR must also hold when only one side matches,
    // so pair a real permission with one no role has.
    expect(canSeeNavItem('admin', ['view_fulfillment', 'view_receiving'])).toBe(true);
    expect(canSeeNavItem('admin', ['manage_users', 'view_fulfillment'])).toBe(true);
  });

  it('array requires is false when no permission matches', () => {
    expect(canSeeNavItem('viewer', ['manage_users'])).toBe(false);
  });
});

describe('SETTINGS_ITEMS', () => {
  it('has nine permission-gated, grouped, described items', () => {
    expect(SETTINGS_ITEMS).toHaveLength(9);
    for (const item of SETTINGS_ITEMS) {
      expect(item.requires).toBeTruthy();
      expect(item.description.length).toBeGreaterThan(0);
      expect(SETTINGS_GROUPS).toContain(item.group);
    }
  });
});

describe('canSeeSettings', () => {
  it('is true for every role that has at least one settings permission', () => {
    // admin/operator have run_feature; viewer has view_settings_history.
    expect(canSeeSettings('admin')).toBe(true);
    expect(canSeeSettings('operator')).toBe(true);
    expect(canSeeSettings('viewer')).toBe(true);
  });
});
