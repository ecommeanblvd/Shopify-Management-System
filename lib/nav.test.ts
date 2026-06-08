import { describe, expect, it } from 'vitest';
import { NAV, SETTINGS_ITEMS, SETTINGS_GROUPS, canSeeSettings } from './nav';

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
});

describe('SETTINGS_ITEMS', () => {
  it('has eight permission-gated, grouped, described items', () => {
    expect(SETTINGS_ITEMS).toHaveLength(8);
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
