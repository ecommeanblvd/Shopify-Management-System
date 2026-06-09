import { describe, it, expect, beforeAll } from 'vitest';
import { refreshRoleCache } from './access';
import { hasPermission, canChangeRole } from './rbac';

// Warm the DB-backed role cache once for the entire suite.
beforeAll(async () => { await refreshRoleCache(); });

describe('hasPermission', () => {
  it('admin has every permission', () => {
    expect(hasPermission('admin', 'manage_stores')).toBe(true);
    expect(hasPermission('admin', 'manage_settings_template')).toBe(true);
    expect(hasPermission('admin', 'apply_settings')).toBe(true);
    expect(hasPermission('admin', 'reconcile_store')).toBe(true);
    expect(hasPermission('admin', 'view_settings_history')).toBe(true);
  });

  it('operator can apply + reconcile but NOT manage templates or stores', () => {
    expect(hasPermission('operator', 'apply_settings')).toBe(true);
    expect(hasPermission('operator', 'reconcile_store')).toBe(true);
    expect(hasPermission('operator', 'view_settings_history')).toBe(true);
    // Parity with old MATRIX: operator had run_feature (view) but NOT template edit.
    expect(hasPermission('operator', 'manage_settings_template')).toBe(false);
    expect(hasPermission('operator', 'manage_stores')).toBe(false);
  });

  it('viewer can view but not act', () => {
    expect(hasPermission('viewer', 'view')).toBe(true);
    expect(hasPermission('viewer', 'view_settings_history')).toBe(true);
    expect(hasPermission('viewer', 'apply_settings')).toBe(false);
    expect(hasPermission('viewer', 'reconcile_store')).toBe(false);
    expect(hasPermission('viewer', 'manage_settings_template')).toBe(false);
  });
});

describe('hasPermission — manage_users', () => {
  it('admin has manage_users', () => {
    expect(hasPermission('admin', 'manage_users')).toBe(true);
  });
  it('operator and viewer do not have manage_users', () => {
    expect(hasPermission('operator', 'manage_users')).toBe(false);
    expect(hasPermission('viewer', 'manage_users')).toBe(false);
  });
});

describe('markets permissions', () => {
  it('grants admin manage_markets_template, apply_markets, view_markets_history', () => {
    expect(hasPermission('admin', 'manage_markets_template')).toBe(true);
    expect(hasPermission('admin', 'apply_markets')).toBe(true);
    expect(hasPermission('admin', 'view_markets_history')).toBe(true);
  });

  it('grants operator apply_markets and view_markets_history (no template edit)', () => {
    expect(hasPermission('operator', 'manage_markets_template')).toBe(false);
    expect(hasPermission('operator', 'apply_markets')).toBe(true);
    expect(hasPermission('operator', 'view_markets_history')).toBe(true);
  });

  it('grants viewer view_markets_history only', () => {
    expect(hasPermission('viewer', 'manage_markets_template')).toBe(false);
    expect(hasPermission('viewer', 'apply_markets')).toBe(false);
    expect(hasPermission('viewer', 'view_markets_history')).toBe(true);
  });
});

describe('carrier-rates permissions', () => {
  it('grants admin both manage_carrier_rates and view_carrier_rates', () => {
    expect(hasPermission('admin', 'manage_carrier_rates')).toBe(true);
    expect(hasPermission('admin', 'view_carrier_rates')).toBe(true);
  });
  it('grants operator manage + view (carrier rates are ops-day work)', () => {
    expect(hasPermission('operator', 'manage_carrier_rates')).toBe(true);
    expect(hasPermission('operator', 'view_carrier_rates')).toBe(true);
  });
  it('grants viewer view-only', () => {
    expect(hasPermission('viewer', 'manage_carrier_rates')).toBe(false);
    expect(hasPermission('viewer', 'view_carrier_rates')).toBe(true);
  });
});

describe('canChangeRole', () => {
  it('admin can change another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: 'operator',
    })).toBe(true);
  });
  it('admin can remove another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: null,
    })).toBe(true);
  });
  it('admin cannot demote themselves', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'operator',
    })).toBe(false);
  });
  it('admin cannot remove their own role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: null,
    })).toBe(false);
  });
  it('admin can re-assert themselves as admin (no-op self change)', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'admin',
    })).toBe(true);
  });
  it('non-admin cannot change any role', () => {
    expect(canChangeRole({
      callerUserId: 'op-id', callerRole: 'operator',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
    expect(canChangeRole({
      callerUserId: 'v-id', callerRole: 'viewer',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
  });
});

describe('orders permissions', () => {
  it('admin can do everything', () => {
    expect(hasPermission('admin', 'view_orders')).toBe(true);
    expect(hasPermission('admin', 'manage_sku_costs')).toBe(true);
    expect(hasPermission('admin', 'manage_shipping_invoices')).toBe(true);
  });
  it('operator can view + manage', () => {
    expect(hasPermission('operator', 'view_orders')).toBe(true);
    expect(hasPermission('operator', 'manage_sku_costs')).toBe(true);
    expect(hasPermission('operator', 'manage_shipping_invoices')).toBe(true);
  });
  it('viewer can only view orders', () => {
    expect(hasPermission('viewer', 'view_orders')).toBe(true);
    expect(hasPermission('viewer', 'manage_sku_costs')).toBe(false);
    expect(hasPermission('viewer', 'manage_shipping_invoices')).toBe(false);
  });
});

describe('hasPermission shim (DB-backed)', () => {
  it('admin has manage_carrier_rates', () => expect(hasPermission('admin', 'manage_carrier_rates')).toBe(true));
  it('viewer lacks manage_carrier_rates', () => expect(hasPermission('viewer', 'manage_carrier_rates')).toBe(false));
  it('viewer has view_orders', () => expect(hasPermission('viewer', 'view_orders')).toBe(true));
  it('logistics has view_fulfillment but not manage_fulfillment', () => {
    expect(hasPermission('logistics', 'view_fulfillment')).toBe(true);
    expect(hasPermission('logistics', 'manage_fulfillment')).toBe(false);
  });
  it('everyone has base view', () => expect(hasPermission('viewer', 'view')).toBe(true));
});
